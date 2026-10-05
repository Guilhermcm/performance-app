import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'

let db: PGlite
const pinned = async () => {
  await withoutEventWindow(db)
  await setClock(db, '2026-09-16T15:00:00Z')
}
// Achievement bonuses (Task 4) land in the same ledger; these tests look at the event rules only.
const paid = async (uid = A) => (await ledger(db, uid)).filter(r => !r.reason.startsWith('achievement:'))
const pairs = async (uid = A) => (await paid(uid)).map(r => [r.reason, r.amount])
const week = (i: number) => `2026-09-${String(7 + i).padStart(2, '0')}`   // 0 = Monday 07 … 6 = Sunday 13

beforeEach(async () => {
  db = await freshDb()
  await makeUser(db, A)
})

describe('award_xp', () => {
  it('pays a client insert in the week of its own day', async () => {
    const [{ d }] = await sql<{ d: string }>(db, `select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)
    await asUser(db, A, () => db.query(
      `insert into public.activity_events (pillar, kind, occurred_on, source_ref) values ('strength', 'workout_completed', $1, 's1')`, [d]))
    const rows = await paid()
    const [{ w }] = await sql<{ w: string }>(db, `select to_char(public.week_start_of($1::date), 'YYYY-MM-DD') as w`, [d])
    expect(rows).toEqual([{ reason: 'workout', amount: 200, week_start: w, pillar: 'strength' }])
  })

  it('pays round(600/T) per planned session and 150 when the T-th lands', async () => {
    await pinned()
    for (const i of [0, 2, 4]) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect(await pairs()).toEqual([['workout', 200], ['workout', 200], ['workout', 200], ['week_target', 150]])
  })

  it('lets the last planned session take the remainder', async () => {
    await pinned()
    // Frozen directly: changing the profile now would freeze the running week, and an untouched
    // past week takes the value frozen after it (Task 1).
    await sql(db, `insert into public.weekly_targets values ($1, '2026-09-07', 7)`, [A])
    for (let i = 0; i < 7; i++) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect(await pairs()).toEqual([...Array(6).fill(['workout', 86]), ['workout', 84], ['week_target', 150]])
  })

  it('pays 25 for at most two sessions beyond the target', async () => {
    await pinned()
    for (let i = 0; i < 6; i++) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect((await pairs()).slice(4)).toEqual([['workout_extra', 25], ['workout_extra', 25]])
  })

  it('pays 30 for at most three PRs a week', async () => {
    await pinned()
    for (let i = 0; i < 4; i++) await event(db, A, 'pr', week(i), 'p' + i)
    await event(db, A, 'pr', '2026-09-14', 'next-week')
    expect(await pairs()).toEqual([['pr', 30], ['pr', 30], ['pr', 30], ['pr', 30]])
    expect((await paid()).map(r => r.week_start)).toEqual(['2026-09-07', '2026-09-07', '2026-09-07', '2026-09-14'])
  })

  it('pays 10 for the first weigh-in of a day, whatever its reference', async () => {
    await pinned()
    await event(db, A, 'weight_logged', week(0), week(0))
    await event(db, A, 'weight_logged', week(0), week(0) + '-again')
    await event(db, A, 'weight_logged', week(1), week(1))
    expect(await pairs()).toEqual([['weight', 10], ['weight', 10]])
  })

  it('never pays more than 960 in a week, for any target', async () => {
    await pinned()
    for (let t = 1; t <= 7; t++) {
      const uid = `00000000-0000-0000-0000-0000000001${String(t).padStart(2, '0')}`
      await makeUser(db, uid, { days_per_week: t })
      for (let i = 0; i < t + 3; i++) await event(db, uid, 'workout_completed', week(i % 7), 'w' + i)
      for (let i = 0; i < 4; i++) await event(db, uid, 'pr', week(i), 'p' + i)
      for (let i = 0; i < 7; i++) await event(db, uid, 'weight_logged', week(i), week(i))
      await event(db, uid, 'weight_logged', week(0), 'twice')
      const total = (await paid(uid)).reduce((n, r) => n + r.amount, 0)
      expect(total, `T=${t}`).toBe(960)
    }
  })

  it('uses the target frozen for the event week, not the profile', async () => {
    await pinned()
    await sql(db, `insert into public.weekly_targets values ($1, '2026-09-07', 2)`, [A])
    for (let i = 0; i < 3; i++) await event(db, A, 'workout_completed', week(i), 'w' + i)
    expect(await pairs()).toEqual([['workout', 300], ['workout', 300], ['week_target', 150], ['workout_extra', 25]])
  })

  it('counts a session logged into the past in its own week', async () => {
    await pinned()
    await event(db, A, 'workout_completed', '2026-09-15', 'now')
    await event(db, A, 'workout_completed', '2026-09-08', 'backfill')
    expect((await paid()).map(r => r.week_start)).toEqual(['2026-09-14', '2026-09-07'])
  })

  it('pays a repeated event once', async () => {
    await pinned()
    await event(db, A, 'workout_completed', week(0), 'w1')
    await expect(event(db, A, 'workout_completed', week(0), 'w1')).rejects.toThrow(/duplicate key/)
    expect(await pairs()).toEqual([['workout', 200]])
  })
})
