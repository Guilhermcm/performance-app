import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, event, makeUser, setClock, sql, withoutEventWindow } from './helpers/game'
import { befriend } from './helpers/social'
import { enableNutrition, setTarget } from './helpers/nutrition'

let db: PGlite
const T = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }

// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')

const progress = async (uid = A) =>
  (await asUser(db, uid, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p
const card = async (uid = A) => (await sql(db, 'select public.progress_card($1) as c', [uid]))[0].c

// A ledger row straight into the table (as the owner); a bonus without an event needs its own reason.
let n = 0
const xpRow = (uid: string, pillar: string | null, amount: number, week: string) =>
  sql(db,
    `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
     values ($1, $2, $3, $4, null, $5)`,
    [uid, pillar, amount, `test_${++n}`, week])

const item = (uid: string, day: string, meal: string, kcal: number, protein = 0, carbs = 0, fat = 0) =>
  sql(db,
    `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
     values ($1, $2, $3, $4, 'Item', 'quick', $5, $6, $7, $8)`,
    [randomUUID(), uid, day, meal, kcal, protein, carbs, fat])

// Two meals that add up to the target exactly: logged, on target and balanced.
const onTarget = async (uid: string, day: string) => {
  await item(uid, day, 'lunch', 1000, 75, 100, 30)
  await item(uid, day, 'dinner', 1000, 75, 100, 30)
}

const createdOn = (uid: string, day: string) =>
  sql(db, 'update public.profiles set created_at = $2 where id = $1', [uid, day + 'T15:00:00Z'])

const period = (uid: string, from: string, to: string | null) =>
  sql(db, 'insert into public.nutrition_periods (user_id, started_on, ended_on) values ($1, $2, $3)', [uid, from, to])

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await at('2026-10-05')                       // Monday
  await makeUser(db, A, { nutrition_days_per_week: 3 })
  await makeUser(db, B)
})

describe('progress card', () => {
  it('sets the week max by active pillars', async () => {
    expect((await card()).week.max).toBe(960)
    expect((await progress()).week.max).toBe(960)
    await at('2026-10-08')
    await enableNutrition(db, A)
    expect((await card()).week.max).toBe(1920)
    // Off from today: the period still touched this week.
    await at('2026-10-09')
    await enableNutrition(db, A, false)
    expect((await card()).week.max).toBe(1920)
    // Next week nothing touches a period.
    await at('2026-10-12')
    expect((await card()).week.max).toBe(960)
    expect((await progress()).week.max).toBe(960)
    // A period turned on and off the same day covers no day.
    await period(B, '2026-10-13', '2026-10-12')
    expect((await card(B)).week.max).toBe(960)
  })

  it('splits the week XP by pillar and bonus', async () => {
    await event(db, A, 'workout_completed', '2026-10-05', 'w1')   // 200 + first_workout 50 (bonus)
    await xpRow(A, 'nutrition', 70, '2026-10-05')
    await xpRow(A, null, 25, '2026-10-05')
    await xpRow(A, 'strength', 30, '2026-09-28')                // last week: not in this one
    const c = await card()
    expect(c.week.pillars).toEqual({ strength: 200, nutrition: 70, bonus: 75 })
    expect(c.week.xp).toBe(345)
    expect(Object.keys(c).sort()).toEqual(['achievements', 'level', 'pillars', 'streak', 'total_xp', 'week'])
    expect((await card(B)).week.pillars).toEqual({ strength: 0, nutrition: 0, bonus: 0 })
  })

  it('hides private badges and nutrition from friends', async () => {
    await enableNutrition(db, A)
    await setTarget(db, A, '2026-10-05', T)
    await event(db, A, 'workout_completed', '2026-10-05', 'w1')
    await sql(db, `insert into public.user_achievements (user_id, code) values ($1, 'nutrition_days_10')`, [A])
    await befriend(db, A, B)

    const friends = (await asUser(db, B, () => db.query<{ f: any }>('select public.get_friends() as f'))).rows[0].f
    const a = friends.find((f: { id: string }) => f.id === A).card
    const text = JSON.stringify(friends)
    expect(text).not.toContain('nutrition_days_10')
    expect(a.nutrition).toBeUndefined()
    expect(a.radar).toBeUndefined()
    expect(a.achievements.map((x: { code: string }) => x.code)).toEqual(['first_workout'])

    const own = await card()
    expect(JSON.stringify(own)).not.toContain('nutrition_days_10')
    expect(own.nutrition).toBeUndefined()
    expect(own.radar).toBeUndefined()

    const p = await progress()
    expect(p.achievements.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(['first_workout', 'nutrition_days_10']))
    expect(p.nutrition).toBeTruthy()
    expect(p.radar).toBeTruthy()
  })
})

describe('my progress extras', () => {
  it('reports the last closed day and week', async () => {
    // Before the pillar is turned on there is no nutrition block.
    expect((await progress()).nutrition).toBeUndefined()

    await enableNutrition(db, A)
    await setTarget(db, A, '2026-10-05', T)
    let p = await progress()
    expect(p.nutrition).toEqual({
      target: 3, on_target: 0, logged: 0, streak: { current: 0, best: 0, shields: 0 },
      confirms_on: '2026-10-07', last_closed: null, last_week: null
    })

    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) await onTarget(A, d)
    await item(A, '2026-10-08', 'lunch', 2000, 0)       // one meal: not logged
    // Friday: Wednesday closes, the third day on target. get_my_progress closes it on its own.
    await at('2026-10-09')
    p = await progress()
    // 200 (third day of 3) + 150 (weekly goal) + 30 (balanced) + 10 (logged).
    expect(p.nutrition).toMatchObject({
      target: 3, on_target: 3, logged: 3, confirms_on: '2026-10-11',
      last_closed: { day: '2026-10-07', logged: true, on_target: true, balanced: true, xp: 390 },
      last_week: null
    })
    await at('2026-10-10')
    expect((await progress()).nutrition.last_closed)
      .toEqual({ day: '2026-10-08', logged: false, on_target: false, balanced: false, xp: 0 })

    // Monday: the week of 05/10 still has Sunday open.
    await at('2026-10-12')
    p = await progress()
    expect(p.nutrition).toMatchObject({ on_target: 0, logged: 0, last_closed: { day: '2026-10-10' }, last_week: null })
    // Tuesday: Sunday closes and the week is judged.
    await at('2026-10-13')
    p = await progress()
    expect(p.nutrition).toMatchObject({
      last_closed: { day: '2026-10-11' }, last_week: { start: '2026-10-05', target_hit: true },
      streak: { current: 1, best: 1, shields: 0 }
    })
    // A week missed.
    await at('2026-10-20')
    expect((await progress()).nutrition.last_week).toEqual({ start: '2026-10-12', target_hit: false })
  })

  it('computes the radar over closed weeks', async () => {
    // Wednesday 04/11. Closed strength weeks: 26/10 back to 05/10 (current), 28/09 back to 07/09
    // (previous). Closed nutrition weeks: the same, since Sunday 01/11 closed on Tuesday.
    await at('2026-11-04')
    // A: created on 19/10, two active strength weeks in the window: (960 + 480) / 1920.
    await createdOn(A, '2026-10-19')
    await xpRow(A, 'strength', 960, '2026-10-19')
    await xpRow(A, 'strength', 480, '2026-10-26')
    await xpRow(A, 'strength', 900, '2026-11-02')                // running week: not closed
    await xpRow(A, null, 500, '2026-10-26')                      // bonus never counts
    // Nutrition on from Thursday 29/10: one week, partly active, counted whole.
    await period(A, '2026-10-29', null)
    await xpRow(A, 'nutrition', 480, '2026-10-26')
    expect((await progress()).radar).toEqual({
      strength: { current: 0.75, previous: null },
      nutrition: { current: 0.5, previous: null }
    })

    // B: created on 07/09, four active weeks in each window.
    await createdOn(B, '2026-09-07')
    await xpRow(B, 'strength', 960, '2026-09-07')
    await xpRow(B, 'strength', 960, '2026-10-05')
    await xpRow(B, 'strength', 960, '2026-10-12')
    // Nutrition on for one day in the previous window and off since; a same-day toggle covers nothing.
    await period(B, '2026-09-30', '2026-09-30')
    await period(B, '2026-10-20', '2026-10-19')
    await xpRow(B, 'nutrition', 2000, '2026-09-28')              // capped at 1
    expect((await progress(B)).radar).toEqual({
      strength: { current: 0.5, previous: 0.25 },
      nutrition: { current: null, previous: 1 }
    })
    // Nutrition weeks close two days later than strength ones: on Monday 09/11 the week of 02/11
    // counts for strength and not yet for nutrition.
    await at('2026-11-09')
    const [{ s, x }] = await sql(db,
      `select public.pillar_consistency($1, 'strength', 0) as s, public.pillar_consistency($1, 'nutrition', 0) as x`, [A])
    expect(Number(s)).toBe(0.8125)       // (960 + 480 + 900) / (3 * 960)
    expect(Number(x)).toBe(0.5)
  })

  it('keeps a single progress_card closed to clients', async () => {
    expect(await sql(db, `select count(*)::int as n from pg_proc where proname = 'progress_card'`)).toEqual([{ n: 1 }])
    for (const q of [
      `select public.progress_card('${B}')`,
      `select public.my_progress_extras('${B}')`,
      `select public.pillar_consistency('${B}', 'strength', 0)`
    ]) await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, () => db.query('select public.get_my_progress()'))).rejects.toThrow(/permission denied/)
  })
})
