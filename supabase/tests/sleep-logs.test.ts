import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { enableSleep, logNight, setSleepTarget } from './helpers/sleep'

let db: PGlite
const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))
const night = async (day: string) =>
  (await sql(db,
    `select to_char(bed_time, 'HH24:MI') as bed, to_char(wake_time, 'HH24:MI') as wake, duration_min, quality, note
       from public.sleep_logs where user_id = $1 and night = $2`, [A, day]))[0]

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('sleep log window', () => {
  it('accepts today and yesterday only', async () => {
    await logNight(db, A, '2026-10-07', '23:00', '07:00')
    await logNight(db, A, '2026-10-06', '23:00', '07:00')
    await expect(logNight(db, A, '2026-10-05', '23:00', '07:00')).rejects.toThrow(/night_closed/)
    await expect(logNight(db, A, '2026-10-08', '23:00', '07:00')).rejects.toThrow(/night_closed/)
    await logNight(db, A, '2026-10-05', '23:00', '07:00', { asOwner: true })
    await expect(asA(`update public.sleep_logs set quality = 3 where night = '2026-10-05'`)).rejects.toThrow(/night_closed/)
    await expect(asA(`delete from public.sleep_logs where night = '2026-10-05'`)).rejects.toThrow(/night_closed/)
    expect(await night('2026-10-05')).toMatchObject({ quality: null })
  })

  it('uses the profile time zone', async () => {
    await sql(db, `update public.profiles set timezone = 'Asia/Tokyo' where id = $1`, [A])
    await setClock(db, '2026-10-07T16:00:00Z')   // already 08/10 in Tokyo
    await logNight(db, A, '2026-10-08', '23:30', '07:10')
    await expect(logNight(db, A, '2026-10-06', '23:30', '07:10')).rejects.toThrow(/night_closed/)
  })

  it('refuses moving a night to another date or person', async () => {
    await logNight(db, A, '2026-10-07', '23:00', '07:00')
    await expect(asA(`update public.sleep_logs set night = '2026-10-06' where night = '2026-10-07'`))
      .rejects.toThrow(/item_immutable/)
    // The BEFORE trigger runs ahead of the RLS with check, so this reaches the trigger.
    await expect(asA(`update public.sleep_logs set user_id = $1 where night = '2026-10-07'`, [B]))
      .rejects.toThrow(/item_immutable/)
  })

  it('lets server functions write any night', async () => {
    await db.exec(`
      create function public.test_server_night(p uuid) returns void
      language plpgsql security definer set search_path = public as $$
      begin
        insert into public.sleep_logs (user_id, night, bed_time, wake_time) values (p, '2026-09-27', '23:00', '07:00');
      end $$;`)
    await asA('select public.test_server_night($1)', [A])
    expect(await night('2026-09-27')).toMatchObject({ duration_min: 480 })
  })
})

describe('sleep log values', () => {
  it('computes the duration across midnight', async () => {
    await logNight(db, A, '2026-10-07', '23:30', '07:10')
    await logNight(db, A, '2026-10-06', '01:00', '08:00')
    expect((await night('2026-10-07')).duration_min).toBe(460)
    expect((await night('2026-10-06')).duration_min).toBe(420)
  })

  it('refuses durations out of range', async () => {
    await logNight(db, A, '2026-10-07', '23:00', '00:00')    // 60 min
    await logNight(db, A, '2026-10-06', '20:00', '12:00')    // 960 min
    await sql(db, 'delete from public.sleep_logs')
    for (const [bed, wake] of [['23:00', '23:59'], ['20:00', '12:01'], ['23:00', '23:00']]) {
      await expect(logNight(db, A, '2026-10-07', bed, wake)).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('refuses seconds in the times', async () => {
    await expect(logNight(db, A, '2026-10-07', '23:30:15', '07:00')).rejects.toThrow(/check/)
    await expect(logNight(db, A, '2026-10-07', '23:30', '07:00:15')).rejects.toThrow(/check/)
  })

  it('edits by registering the same night again', async () => {
    await logNight(db, A, '2026-10-07', '23:00', '07:00')
    await asA(
      `insert into public.sleep_logs (night, bed_time, wake_time, quality) values ('2026-10-07', '22:30', '06:15', 4)
       on conflict (user_id, night) do update set bed_time = excluded.bed_time, wake_time = excluded.wake_time,
         quality = excluded.quality, updated_at = excluded.updated_at`)
    expect(await sql(db, 'select 1 from public.sleep_logs where user_id = $1', [A])).toHaveLength(1)
    expect(await night('2026-10-07')).toMatchObject({ bed: '22:30', wake: '06:15', duration_min: 465, quality: 4 })
  })

  it('keeps the newest write', async () => {
    await logNight(db, A, '2026-10-07', '23:00', '07:00')
    const upd = (q: number, at: string) =>
      asA(`update public.sleep_logs set quality = $1, updated_at = $2 where night = '2026-10-07'`, [q, at])
    await upd(1, '2000-01-01T00:00:00Z')
    expect((await night('2026-10-07')).quality).toBeNull()
    await upd(2, new Date(Date.now() + 60_000).toISOString())
    expect((await night('2026-10-07')).quality).toBe(2)
    const [r] = await sql(db, `select updated_at <= now() as ok from public.sleep_logs where user_id = $1`, [A])
    expect(r.ok).toBe(true)
    await upd(3, new Date(Date.now() + 86_400_000 * 30).toISOString())
    expect((await night('2026-10-07')).quality).toBe(3)
    await logNight(db, A, '2026-10-06', '23:00', '07:00', { updatedAt: new Date(Date.now() + 86_400_000).toISOString() })
    const [r2] = await sql(db, `select bool_and(updated_at <= now()) as ok from public.sleep_logs where user_id = $1`, [A])
    expect(r2.ok).toBe(true)
  })

  it('checks quality and note', async () => {
    for (const quality of [0, 6]) {
      await expect(logNight(db, A, '2026-10-07', '23:00', '07:00', { quality })).rejects.toThrow(/check/)
    }
    await expect(logNight(db, A, '2026-10-07', '23:00', '07:00', { note: 'x'.repeat(141) })).rejects.toThrow(/check/)
    await logNight(db, A, '2026-10-07', '23:00', '07:00', { quality: 5, note: 'x'.repeat(140) })
    expect(await night('2026-10-07')).toMatchObject({ quality: 5, note: 'x'.repeat(140) })
  })
})

describe('account deletion', () => {
  it('lets account deletion remove old nights', async () => {
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-07')
    await logNight(db, A, '2026-09-27', '23:00', '07:00', { asOwner: true })
    await logNight(db, A, '2026-10-07', '23:00', '07:00')
    await logNight(db, B, '2026-10-07', '23:00', '07:00')
    await asA('select public.delete_my_account()')
    for (const t of ['sleep_logs', 'sleep_targets', 'sleep_periods']) {
      expect(await sql(db, `select 1 from public.${t} where user_id = $1`, [A])).toHaveLength(0)
    }
    expect(await sql(db, 'select 1 from public.sleep_logs where user_id = $1', [B])).toHaveLength(1)
  })
})
