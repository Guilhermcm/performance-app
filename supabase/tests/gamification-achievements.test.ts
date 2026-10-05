import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'

let db: PGlite
const codes = async (uid = A) =>
  (await sql<{ code: string }>(db, 'select code from public.user_achievements where user_id = $1 order by code', [uid])).map(r => r.code)
const evaluate = async (uid = A) =>
  (await sql<{ c: string[] }>(db, 'select to_jsonb(public.evaluate_achievements($1)) as c', [uid]))[0].c
const day = (d: number) => `2026-09-${String(d).padStart(2, '0')}`

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-09-16T15:00:00Z')   // week of Monday 2026-09-14
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('achievements', () => {
  it('has the 22 badges of the v1 catalogue, readable by clients', async () => {
    const rows = await asUser(db, A, () => db.query('select code from public.achievement_catalog'))
    expect(rows.rows).toHaveLength(22)
  })

  it('unlocks first_workout and pays its 50 XP as a general bonus this week', async () => {
    await event(db, A, 'workout_completed', day(8), 'w1')
    expect(await codes()).toEqual(['first_workout'])
    expect((await ledger(db, A)).find(r => r.reason === 'achievement:first_workout'))
      .toEqual({ reason: 'achievement:first_workout', amount: 50, week_start: '2026-09-14', pillar: null })
  })

  it('pays each badge once', async () => {
    await event(db, A, 'workout_completed', day(8), 'w1')
    expect(await evaluate()).toEqual([])
    expect((await ledger(db, A)).filter(r => r.reason === 'achievement:first_workout')).toHaveLength(1)
  })

  it('needs seven weigh-in days in a row for weigh_in_7', async () => {
    for (const d of [1, 2, 3, 4, 5, 6, 8]) await event(db, A, 'weight_logged', day(d), day(d))
    expect(await codes()).not.toContain('weigh_in_7')
    await event(db, A, 'weight_logged', day(7), day(7))
    expect(await codes()).toContain('weigh_in_7')
  })

  it('counts five live sessions started before 7 for early_bird', async () => {
    for (const [i, hour] of [6, 6, 5, 6, 7].entries()) await event(db, A, 'workout_completed', day(8), 'e' + i, { hour })
    await event(db, A, 'workout_completed', day(9), 'backfilled', { past: true })
    expect(await codes()).not.toContain('early_bird')
    await event(db, A, 'workout_completed', day(10), 'e5', { hour: 4 })
    expect(await codes()).toContain('early_bird')
  })

  it('unlocks streak badges once the weeks are closed', async () => {
    // A user created with T = 1 (changing A's target now would freeze the running week with 3,
    // and past weeks nobody touched take the value frozen after them).
    const C = '00000000-0000-0000-0000-00000000000c'
    await makeUser(db, C, { days_per_week: 1 })
    await sql(db, `update public.profiles set created_at = '2026-08-17T15:00:00Z' where id = $1`, [C])
    for (const d of ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']) await event(db, C, 'workout_completed', d, d)
    await sql(db, 'select public.close_weeks($1)', [C])
    expect(await evaluate(C)).toEqual(['streak_4'])
    // 4 × 750 + 50 + 75 = 3125 XP already reached level 10 during the fourth session.
    expect(await codes(C)).toEqual(['first_workout', 'level_10', 'streak_4', 'week_target_1'])
  })

  it('gives level badges from all XP, bonuses included, without paying XP', async () => {
    expect(await sql(db, `select public.award_bonus_xp($1, 2700, 'test:seed') as ok`, [A])).toEqual([{ ok: true }])
    expect(await evaluate()).toEqual(['level_10'])
    expect((await ledger(db, A)).some(r => r.reason === 'achievement:level_10')).toBe(false)
  })

  it('leaves social badges to award_achievement', async () => {
    for (let i = 0; i < 3; i++) await event(db, A, 'workout_completed', day(8 + i), 'w' + i)
    expect(await codes()).not.toContain('first_friend')
    expect(await sql(db, `select public.award_achievement($1, 'first_friend') as ok`, [A])).toEqual([{ ok: true }])
    expect(await sql(db, `select public.award_achievement($1, 'first_friend') as ok`, [A])).toEqual([{ ok: false }])
    expect((await ledger(db, A)).filter(r => r.reason === 'achievement:first_friend').map(r => r.amount)).toEqual([50])
    await expect(sql(db, `select public.award_achievement($1, 'nope')`, [A])).rejects.toThrow('unknown_achievement')
  })

  it('pays a bonus reason once and refuses odd amounts', async () => {
    expect(await sql(db, `select public.award_bonus_xp($1, 300, 'challenge:x') as ok`, [A])).toEqual([{ ok: true }])
    expect(await sql(db, `select public.award_bonus_xp($1, 300, 'challenge:x') as ok`, [A])).toEqual([{ ok: false }])
    await expect(sql(db, `select public.award_bonus_xp($1, 0, 'zero')`, [A])).rejects.toThrow('invalid_amount')
    await expect(sql(db, `select public.award_bonus_xp($1, 5001, 'huge')`, [A])).rejects.toThrow('invalid_amount')
  })

  it('keeps the award functions away from clients', async () => {
    for (const q of [
      `select public.award_bonus_xp('${A}', 100, 'cheat')`,
      `select public.award_achievement('${A}', 'first_friend')`,
      `select public.evaluate_achievements('${A}')`,
      `select public.achievement_stats('${A}')`
    ]) await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
  })

  it('shows each user only their own badges', async () => {
    await event(db, A, 'workout_completed', day(8), 'w1')
    expect((await asUser(db, A, () => db.query('select code from public.user_achievements'))).rows).toEqual([{ code: 'first_workout' }])
    expect((await asUser(db, B, () => db.query('select * from public.user_achievements'))).rows).toEqual([])
  })
})
