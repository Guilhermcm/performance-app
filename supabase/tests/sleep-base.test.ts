import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { rows } from './helpers/social'
import { enableSleep, logNight, setSleepTarget } from './helpers/sleep'

let db: PGlite
const periods = (uid: string) =>
  sql(db, `select to_char(started_on, 'YYYY-MM-DD') as started_on, to_char(ended_on, 'YYYY-MM-DD') as ended_on
             from public.sleep_periods where user_id = $1 order by started_on`, [uid])
const activeOn = async (uid: string, day: string) =>
  (await sql<{ v: boolean }>(db, 'select public.sleep_active_on($1, $2) as v', [uid, day]))[0].v
const target = async (uid: string, week: string, pillar: string) =>
  (await sql<{ v: number }>(db, 'select public.week_target_for($1, $2, $3) as v', [uid, week, pillar]))[0].v
// The 14-day window (and, for clients, the order of BEFORE trigger and RLS check) reads the real
// clock, so the client cases use the real local today rather than the pinned one.
const realToday = async () =>
  (await sql<{ d: string }>(db, `select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`))[0].d
const insertKind = (kind: string, on: string) =>
  db.query(
    `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
     values ($1, 'sleep', $2, $3, $4)`, [A, kind, on, `sleep:${on}`])
const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A)
})

describe('sleep periods', () => {
  it('opens a period on the day the pillar is turned on', async () => {
    await enableSleep(db, A)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
  })

  it('closes it the day before it is turned off', async () => {
    await enableSleep(db, A)
    await setClock(db, '2026-10-09T15:00:00Z')   // Friday
    await enableSleep(db, A, false)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: '2026-10-08' }])
    expect(await activeOn(A, '2026-10-08')).toBe(true)
    expect(await activeOn(A, '2026-10-09')).toBe(false)
  })

  it('reopens the same period when turned back on the same day', async () => {
    await enableSleep(db, A)
    await setClock(db, '2026-10-09T15:00:00Z')
    await enableSleep(db, A, false)
    await enableSleep(db, A)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
  })

  it('covers no night when turned on and off on the same day', async () => {
    await enableSleep(db, A)
    await enableSleep(db, A, false)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: '2026-10-06' }])
    expect(await activeOn(A, '2026-10-07')).toBe(false)
  })

  it('refuses sleep server-only kinds from clients, whatever they set', async () => {
    const today = await realToday()
    for (const kind of ['night_logged', 'night_on_target', 'night_rested']) {
      await expect(asUser(db, A, () => insertKind(kind, today))).rejects.toThrow(/row-level security/)
      await expect(asUser(db, A, async () => {
        await db.exec('begin')
        try {
          await db.query(`select set_config('perf.server_write', 'on', true)`)
          await insertKind(kind, today)
        } finally {
          await db.exec('rollback')
        }
      })).rejects.toThrow(/row-level security/)
    }
  })

  it('lets clients read but not write periods', async () => {
    await enableSleep(db, A)
    await expect(asA(`insert into public.sleep_periods (user_id, started_on) values ('${A}', '2026-01-01')`))
      .rejects.toThrow(/permission denied/)
    await expect(asA('update public.sleep_periods set ended_on = null')).rejects.toThrow(/permission denied/)
    await expect(asA('delete from public.sleep_periods')).rejects.toThrow(/permission denied/)
    await makeUser(db, B)
    expect(await rows(db, B, 'select * from public.sleep_periods')).toEqual([])
    expect(await rows(db, A, 'select * from public.sleep_periods')).toHaveLength(1)
  })
})

describe('sleep profile', () => {
  it('freezes the sleep T on its own', async () => {
    expect(await target(A, '2026-10-05', 'sleep')).toBe(5)
    await sql(db, 'update public.profiles set sleep_nights_per_week = 7 where id = $1', [A])
    expect(await target(A, '2026-10-05', 'sleep')).toBe(5)
    expect(await target(A, '2026-10-12', 'sleep')).toBe(7)
    // Treino and Nutrição keep their own values in both weeks.
    expect(await target(A, '2026-10-05', 'strength')).toBe(3)
    expect(await target(A, '2026-10-12', 'strength')).toBe(3)
    expect(await target(A, '2026-10-05', 'nutrition')).toBe(5)
    expect(await target(A, '2026-10-12', 'nutrition')).toBe(5)
  })

  it('freezes only the sleep row when only the sleep T changes', async () => {
    await sql(db, 'update public.profiles set sleep_nights_per_week = 4 where id = $1', [A])
    const r = await sql(db, `select pillar::text as pillar, target from public.weekly_targets where user_id = $1`, [A])
    expect(r).toEqual([{ pillar: 'sleep', target: 5 }])
  })

  it('falls back to the profile column of the pillar', async () => {
    await sql(db, 'update public.profiles set sleep_nights_per_week = 6 where id = $1', [A])
    await sql(db, 'delete from public.weekly_targets where user_id = $1', [A])
    expect(await target(A, '2026-09-21', 'sleep')).toBe(6)
    expect(await target(A, '2026-09-21', 'nutrition')).toBe(5)
    expect(await target(A, '2026-09-21', 'strength')).toBe(3)
  })

  it('checks the new profile columns', async () => {
    await expect(sql(db, 'update public.profiles set sleep_nights_per_week = 2 where id = $1', [A])).rejects.toThrow(/check/)
    await expect(sql(db, 'update public.profiles set sleep_nights_per_week = 8 where id = $1', [A])).rejects.toThrow(/check/)
    const [p] = await sql(db, 'select sleep_enabled, sleep_nights_per_week from public.profiles where id = $1', [A])
    expect(p).toEqual({ sleep_enabled: false, sleep_nights_per_week: 5 })
  })
})

describe('sleep targets', () => {
  const insTarget = (day: string, goal = 480, bed = '23:00') =>
    asA('insert into public.sleep_targets (valid_from, goal_min, bed_target) values ($1, $2, $3)', [day, goal, bed])
  const count = async () =>
    (await sql<{ n: number }>(db, 'select count(*)::int as n from public.sleep_targets where user_id = $1', [A]))[0].n

  it('lets the first target start today and later ones tomorrow', async () => {
    await insTarget('2026-10-07')
    await expect(insTarget('2026-10-07')).rejects.toThrow()
    await insTarget('2026-10-08')
    expect(await rows(db, A,
      `update public.sleep_targets set goal_min = 450 where valid_from <= '2026-10-07' returning 1`)).toHaveLength(0)
    expect(await rows(db, A,
      `update public.sleep_targets set goal_min = 450 where valid_from = '2026-10-08' returning 1`)).toHaveLength(1)
    await expect(rows(db, A, 'delete from public.sleep_targets')).rejects.toThrow(/permission denied/)
    expect(await count()).toBe(2)
  })

  it('does not let a first target start in the past', async () => {
    await expect(insTarget('2026-10-06')).rejects.toThrow(/row-level security/)
  })

  it('checks target ranges', async () => {
    for (const goal of [345, 615, 490]) {
      await expect(insTarget('2026-10-08', goal)).rejects.toThrow(/check/)
    }
    await expect(insTarget('2026-10-08', 480, '23:00:30')).rejects.toThrow(/check/)
    await insTarget('2026-10-08', 360, '21:15')
    await insTarget('2026-10-09', 600, '00:45')
  })

  it('picks the target in force on a night', async () => {
    await setSleepTarget(db, A, '2026-10-05', 480)
    await setSleepTarget(db, A, '2026-10-08', 450)
    const goal = async (d: string) =>
      (await sql<{ goal_min: number | null }>(db, 'select (public.sleep_target_on($1, $2)).goal_min', [A, d]))[0].goal_min
    expect(await goal('2026-10-07')).toBe(480)
    expect(await goal('2026-10-08')).toBe(450)
    expect(await goal('2026-10-04')).toBeNull()
  })

  it('keeps the internal functions closed to clients', async () => {
    await expect(asA(`select public.sleep_active_on($1, '2026-10-07')`, [A])).rejects.toThrow(/permission denied/)
    await expect(asA(`select public.sleep_target_on($1, '2026-10-07')`, [A])).rejects.toThrow(/permission denied/)
  })

  it('keeps people apart', async () => {
    await makeUser(db, B)
    await setSleepTarget(db, A, '2026-10-07')
    await logNight(db, A, '2026-10-07', '23:00', '07:00')
    expect(await rows(db, B, 'select 1 from public.sleep_targets')).toHaveLength(0)
    expect(await rows(db, B, 'select 1 from public.sleep_logs')).toHaveLength(0)
    expect(await rows(db, B, 'update public.sleep_targets set goal_min = 450 returning 1')).toHaveLength(0)
    expect(await rows(db, B, `update public.sleep_logs set quality = 1 returning 1`)).toHaveLength(0)
    await expect(rows(db, B, 'delete from public.sleep_targets')).rejects.toThrow(/permission denied/)
    expect(await rows(db, B, 'delete from public.sleep_logs returning 1')).toHaveLength(0)
    expect(await rows(db, B, `insert into public.sleep_logs (user_id, night, bed_time, wake_time)
                              values ($1, '2026-10-06', '23:00', '07:00') returning 1`, [A]).catch(e => e.message))
      .toMatch(/row-level security/)
    expect(await count()).toBe(1)
    expect(await sql(db, 'select quality from public.sleep_logs')).toEqual([{ quality: null }])
    expect(await rows(db, null, 'select 1 from public.sleep_logs').catch(() => [])).toHaveLength(0)
  })
})
