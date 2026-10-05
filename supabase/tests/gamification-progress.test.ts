import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'

let db: PGlite
const progress = async (uid = A) => (await asUser(db, uid, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-09-16T15:00:00Z')   // Wednesday, week of 2026-09-14
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('get_my_progress', () => {
  it('refuses callers without a session', async () => {
    await expect(asUser(db, null, () => db.query('select public.get_my_progress()'))).rejects.toThrow(/permission denied/)
  })

  it('answers with the shape the app reads', async () => {
    await event(db, A, 'workout_completed', '2026-09-14', 'w1', { hour: 18 })
    await event(db, A, 'pr', '2026-09-14', 'w1:0025')
    await event(db, A, 'weight_logged', '2026-09-16', '2026-09-16')
    const { achievements, ...rest } = await progress()
    // Ledger: 200 workout + 30 PR + 10 weigh-in + 50 first_workout + 50 first_pr = 340 (level 3, 90/200).
    // Strength pillar: 240 (level 2, 140/150); the badges are general bonuses.
    expect(rest).toEqual({
      today: '2026-09-16',
      total_xp: 340,
      level: { level: 3, into: 90, need: 200 },
      pillars: { strength: { level: 2, into: 140, need: 150, xp: 240 } },
      week: { start: '2026-09-14', xp: 340, max: 960, target: 3, workouts: 1, extras: 0, prs: 1, target_hit: false, weighed_today: true },
      streak: { current: 0, best: 0, shields: 0 },
      stats: { workouts: 1, prs: 1, week_targets: 0, best_streak: 0, weigh_in_run: 1, early_workouts: 0, friends: 0, challenges_won: 0, level: 3,
               nutrition_logged_days: 0, nutrition_on_target_days: 0, nutrition_week_targets: 0,
               nutrition_best_streak: 0, protein_best_run: 0 }
    })
    expect(achievements.map((a: { code: string }) => a.code).sort()).toEqual(['first_pr', 'first_workout'])
    expect(achievements.every((a: { unlocked_at: unknown }) => typeof a.unlocked_at === 'string')).toBe(true)
  })

  it('freezes the running week target on the first read', async () => {
    await progress()
    await sql(db, 'update public.profiles set days_per_week = 5 where id = $1', [A])
    expect((await progress()).week.target).toBe(3)
  })

  it('closes finished weeks before answering', async () => {
    const C = '00000000-0000-0000-0000-00000000000c'
    await makeUser(db, C, { days_per_week: 1 })
    await sql(db, `update public.profiles set created_at = '2026-08-31T15:00:00Z' where id = $1`, [C])
    await event(db, C, 'workout_completed', '2026-08-31', 'a')
    await event(db, C, 'workout_completed', '2026-09-07', 'b')
    const p = await progress(C)
    expect(p.streak).toEqual({ current: 2, best: 2, shields: 0 })
    expect(p.stats.best_streak).toBe(2)
  })

  it('shows only the caller', async () => {
    await event(db, B, 'workout_completed', '2026-09-14', 'b1')
    expect((await progress(A)).total_xp).toBe(0)
  })
})

describe('internal progress functions', () => {
  it('stay away from clients', async () => {
    for (const q of [`select public.progress_card('${B}')`, `select public.close_all_weeks()`, `select public.week_xp('${B}', '2026-09-14')`])
      await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
  })

  it('progress_card leaves out private fields', async () => {
    const [{ c }] = await sql(db, 'select public.progress_card($1) as c', [A])
    expect(Object.keys(c).sort()).toEqual(['achievements', 'level', 'pillars', 'streak', 'total_xp', 'week'])
    expect(c.week.weighed_today).toBeUndefined()
  })

  it('close_all_weeks closes every profile', async () => {
    await sql(db, `update public.profiles set created_at = '2026-09-07T15:00:00Z'`)
    for (const uid of [A, B]) for (const d of ['2026-09-07', '2026-09-08', '2026-09-09']) await event(db, uid, 'workout_completed', d, d)
    expect(await sql(db, 'select public.close_all_weeks() as n')).toEqual([{ n: 2 }])
    expect(await sql(db, `select current from public.streaks order by user_id`)).toEqual([{ current: 1 }, { current: 1 }])
  })

  it('skips pg_cron where the extension does not exist', async () => {
    expect(await sql(db, `select count(*)::int as n from pg_extension where extname = 'pg_cron'`)).toEqual([{ n: 0 }])
  })
})
