import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { closeSleepAs, enableSleep, logNight, setSleepTarget } from './helpers/sleep'

let db: PGlite

const REASONS = ['sleep_night', 'sleep_night_extra', 'sleep_week_target', 'sleep_rested', 'sleep_logged']

// Nights straight into the table as the owner, so any past night can be filled.
const past = (uid: string, night: string, bed = '23:00', wake = '07:00', quality: number | null = null) =>
  logNight(db, uid, night, bed, wake, { asOwner: true, quality })

const closedNights = async (uid: string) =>
  (await sql<{ night: string }>(db,
    `select to_char(night, 'YYYY-MM-DD') as night from public.sleep_nights where user_id = $1 order by night`, [uid]))
    .map(r => r.night)
const closed = async (uid: string, night: string) =>
  (await sql(db,
    `select target, logged, duration_min, bed_diff_min, quality, on_target, rested
       from public.sleep_nights where user_id = $1 and night = $2`, [uid, night]))[0]
const events = (uid: string) => sql(db,
  `select kind, pillar::text as pillar, to_char(occurred_on, 'YYYY-MM-DD') as on, source_ref
     from public.activity_events where user_id = $1 order by id`, [uid])
const pillarRows = async (uid: string) => (await ledger(db, uid)).filter(r => !r.reason.startsWith('achievement:'))

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await enableSleep(db, A)
  await setSleepTarget(db, A, '2026-10-05', 480, '23:00')
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday
})

describe('closing a sleep night', () => {
  it('closes a night at the start of D+2', async () => {
    await past(A, '2026-10-05')
    await past(A, '2026-10-06')
    await setClock(db, '2026-10-07T02:59:00Z')   // 23:59 on Tuesday in Sao Paulo
    expect(await closeSleepAs(db, A)).toBe(0)
    await setClock(db, '2026-10-07T03:01:00Z')   // 00:01 on Wednesday
    expect(await closeSleepAs(db, A)).toBe(1)
    expect(await closedNights(A)).toEqual(['2026-10-05'])
  })

  it('stores the snapshot and the target in force', async () => {
    await past(A, '2026-10-05', '23:20', '07:05', 4)
    expect(await closeSleepAs(db, A)).toBe(1)
    expect(await closed(A, '2026-10-05')).toEqual({
      target: { goal_min: 480, bed_target: '23:00' }, logged: true, duration_min: 465, bed_diff_min: 20,
      quality: 4, on_target: true, rested: true,
    })
  })

  it('closes a night without a log as not logged', async () => {
    expect(await closeSleepAs(db, A)).toBe(1)
    expect(await closed(A, '2026-10-05')).toEqual({
      target: { goal_min: 480, bed_target: '23:00' }, logged: false, duration_min: null, bed_diff_min: null,
      quality: null, on_target: false, rested: false,
    })
    expect(await events(A)).toEqual([])
    expect(await ledger(db, A)).toEqual([])
  })

  it('closes a night without a target in force without paying', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    await makeUser(db, B)
    await enableSleep(db, B)                                  // no target is ever written
    await past(B, '2026-10-05', '23:00', '07:00', 5)
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeSleepAs(db, B)).toBe(1)
    expect(await closed(B, '2026-10-05')).toEqual({
      target: null, logged: true, duration_min: 480, bed_diff_min: null, quality: 5,
      on_target: false, rested: false,
    })
    expect(await events(B)).toEqual([])
    expect(await ledger(db, B)).toEqual([])
  })

  it('skips nights outside a period', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    await makeUser(db, B)
    await enableSleep(db, B)                                  // period from 05/10
    await setSleepTarget(db, B, '2026-10-05')
    await setClock(db, '2026-10-07T15:00:00Z')
    await enableSleep(db, B, false)                           // period ends on 06/10
    await setClock(db, '2026-10-09T15:00:00Z')
    await enableSleep(db, B)                                  // new period from 09/10
    for (const night of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) await past(B, night)
    await setClock(db, '2026-10-12T15:00:00Z')
    expect(await closeSleepAs(db, B)).toBe(4)
    expect(await closedNights(B)).toEqual(['2026-10-05', '2026-10-06', '2026-10-09', '2026-10-10'])
    expect(await closeSleepAs(db, B)).toBe(0)
  })

  it('skips nights before the pillar was ever on', async () => {
    await makeUser(db, B)
    await setSleepTarget(db, B, '2026-10-01')
    await past(B, '2026-10-03')
    await setClock(db, '2026-10-05T15:00:00Z')
    await enableSleep(db, B)
    await past(B, '2026-10-05')
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeSleepAs(db, B)).toBe(1)
    expect(await closedNights(B)).toEqual(['2026-10-05'])
  })

  it('counts the night of the activation day', async () => {
    await setClock(db, '2026-10-05T10:30:00Z')               // 07:30 on Monday in Sao Paulo
    await makeUser(db, B)
    await enableSleep(db, B)
    await setSleepTarget(db, B, '2026-10-05')
    await logNight(db, B, '2026-10-05', '23:00', '07:00')     // the night that just ended, from the app
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeSleepAs(db, B)).toBe(1)
    expect((await closed(B, '2026-10-05')).on_target).toBe(true)
    expect((await pillarRows(B)).map(r => r.reason)).toEqual(['sleep_logged', 'sleep_night'])
  })

  it('pays a night once', async () => {
    await past(A, '2026-10-05')
    expect(await closeSleepAs(db, A)).toBe(1)
    const first = await ledger(db, A)
    expect(await closeSleepAs(db, A)).toBe(0)
    expect(await ledger(db, A)).toEqual(first)
    expect(first.filter(r => !r.reason.startsWith('achievement:'))).toEqual([
      { reason: 'sleep_logged', amount: 10, week_start: '2026-10-05', pillar: 'sleep' },
      { reason: 'sleep_night', amount: 120, week_start: '2026-10-05', pillar: 'sleep' },
    ])
    expect(await events(A)).toEqual(['night_logged', 'night_on_target'].map(kind => (
      { kind, pillar: 'sleep', on: '2026-10-05', source_ref: 'sleep:2026-10-05' })))
  })

  it('keeps judging by the target in force that night', async () => {
    await past(A, '2026-10-05', '23:00', '06:30')             // 450 minutes: short of 480 - 15
    await setClock(db, '2026-10-06T15:00:00Z')                // Tuesday: a new target from tomorrow
    await asUser(db, A, () => db.query(
      `insert into public.sleep_targets (valid_from, goal_min, bed_target) values ('2026-10-07', 450, '23:00')`))
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeSleepAs(db, A)).toBe(1)
    expect(await closed(A, '2026-10-05')).toMatchObject({
      target: { goal_min: 480, bed_target: '23:00' }, duration_min: 450, on_target: false,
    })
    expect(await pillarRows(A)).toEqual([
      { reason: 'sleep_logged', amount: 10, week_start: '2026-10-05', pillar: 'sleep' },
    ])
  })

  it('closes nights in the profile time zone', async () => {
    await makeUser(db, B, { timezone: 'Asia/Tokyo' })
    await setClock(db, '2026-10-04T16:00:00Z')               // 01:00 on 05/10 in Tokyo
    await enableSleep(db, B)
    await setSleepTarget(db, B, '2026-10-05')
    await past(B, '2026-10-05', '23:30', '07:10')
    await past(B, '2026-10-06', '23:30', '07:10')
    await setClock(db, '2026-10-07T14:59:00Z')               // 23:59 on 07/10 in Tokyo
    expect(await closeSleepAs(db, B)).toBe(1)
    expect(await closedNights(B)).toEqual(['2026-10-05'])
    await setClock(db, '2026-10-07T15:01:00Z')               // 00:01 on 08/10 in Tokyo, 12:01 on 07/10 in Sao Paulo
    expect(await closeSleepAs(db, B)).toBe(1)
    expect(await closedNights(B)).toEqual(['2026-10-05', '2026-10-06'])
  })

  it('closes the Sunday on Tuesday in its own week', async () => {
    await past(A, '2026-10-11')
    await setClock(db, '2026-10-12T15:00:00Z')               // Monday of the next week
    expect(await closeSleepAs(db, A)).toBe(6)
    expect(await closedNights(A)).not.toContain('2026-10-11')
    await setClock(db, '2026-10-13T15:00:00Z')               // Tuesday
    expect(await closeSleepAs(db, A)).toBe(1)
    const weeks = await sql(db,
      `select distinct to_char(l.week_start, 'YYYY-MM-DD') as week
         from public.xp_ledger l join public.activity_events e on e.id = l.event_id
        where e.user_id = $1 and e.source_ref = 'sleep:2026-10-11'`, [A])
    expect(weeks).toEqual([{ week: '2026-10-05' }])
  })

  it('never touches Treino or Nutrition reasons', async () => {
    const streaks = () => sql(db,
      `select * from public.streaks where user_id = $1 and kind in ('training_week', 'nutrition_week') order by kind`, [A])
    const before = await streaks()
    for (let d = 5; d <= 11; d++) await past(A, `2026-10-${String(d).padStart(2, '0')}`, '23:00', '07:00', 5)
    await setClock(db, '2026-10-13T15:00:00Z')
    expect(await closeSleepAs(db, A)).toBe(7)
    const rows = await pillarRows(A)
    expect(rows.every(r => r.pillar === 'sleep' && REASONS.includes(r.reason))).toBe(true)
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(960)
    const [s] = await sql(db,
      `select public.achievement_stats($1) -> 'week_targets' as t, public.achievement_stats($1) -> 'nutrition_week_targets' as n`, [A])
    expect(s).toEqual({ t: 0, n: 0 })
    expect(await streaks()).toEqual(before)
  })
})

describe('sleep_nights access', () => {
  it('lets clients read but not write closed nights', async () => {
    await past(A, '2026-10-05')
    await closeSleepAs(db, A)
    await makeUser(db, B)
    const read = (uid: string) => asUser(db, uid, () => db.query('select night from public.sleep_nights'))
    expect((await read(A)).rows).toHaveLength(1)
    expect((await read(B)).rows).toHaveLength(0)
    await expect(asUser(db, A, () => db.query(
      `insert into public.sleep_nights (user_id, night, logged, on_target, rested)
       values ($1, '2026-10-06', true, true, true)`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      `update public.sleep_nights set rested = true where user_id = $1`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      `delete from public.sleep_nights where user_id = $1`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_sleep_nights($1)', [A])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      `select public.classify_sleep_night('23:00', 480, 5, '{"goal_min": 480, "bed_target": "23:00"}')`)))
      .rejects.toThrow(/permission denied/)
  })

  it('lets account deletion remove closed nights', async () => {
    await makeUser(db, B)
    await past(A, '2026-10-05')
    await closeSleepAs(db, A)
    await sql(db, `insert into public.sleep_periods (user_id, started_on) values ($1, '2026-10-05')`, [B])
    await closeSleepAs(db, B)
    await asUser(db, A, () => db.query('select public.delete_my_account()'))
    expect(await sql(db, 'select 1 from public.sleep_nights where user_id = $1', [A])).toHaveLength(0)
    expect(await sql(db, 'select 1 from public.sleep_nights where user_id = $1', [B])).toHaveLength(1)
  })
})
