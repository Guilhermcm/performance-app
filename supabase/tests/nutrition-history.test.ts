import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { enableNutrition, setTarget } from './helpers/nutrition'

let db: PGlite
const T = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }

const at = (day: string) => setClock(db, day + 'T15:00:00Z')

const item = (uid: string, day: string, meal: string, kcal: number, protein: number, carbs: number, fat: number) =>
  sql(db,
    `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
     values ($1, $2, $3, $4, 'Item', 'quick', $5, $6, $7, $8)`,
    [randomUUID(), uid, day, meal, kcal, protein, carbs, fat])

// On target but not balanced (carbs 50% over): pays the day and the logged bonus, no balanced one.
const loose = async (uid: string, day: string) => {
  await item(uid, day, 'lunch', 1000, 75, 150, 30)
  await item(uid, day, 'dinner', 1000, 75, 150, 30)
}
// On target and balanced: the same plus 30.
const balanced = async (uid: string, day: string) => {
  await item(uid, day, 'lunch', 1000, 75, 100, 30)
  await item(uid, day, 'dinner', 1000, 75, 100, 30)
}

type Week = { start: string; target: number; on_target: number; target_hit: boolean }
type Result = { target: unknown; days: Array<{ day: string; xp: number; on_target: boolean }>; weeks: Week[] }

const call = (uid: string | null, from: string, to: string) => asUser(db, uid, async () =>
  (await db.query<{ r: Result }>('select public.get_nutrition_days($1, $2) as r', [from, to])).rows[0].r)

const xpOf = (r: Result) => Object.fromEntries(r.days.map(d => [d.day, d.xp]))

beforeEach(async () => {
  db = await freshDb()
  await at('2026-10-05')                                 // Monday
  await makeUser(db, A, { nutrition_days_per_week: 5 })
  await enableNutrition(db, A)
  await setTarget(db, A, '2026-10-05', T)
})

describe('get_nutrition_days: xp and weeks', () => {
  it('sums the day xp from the ledger', async () => {
    await loose(A, '2026-10-05')                         // 120 + 10
    await balanced(A, '2026-10-06')                      // 120 + 10 + 30
    await item(A, '2026-10-07', 'lunch', 500, 20, 50, 10) // not logged: nothing
    await at('2026-10-09')
    const r = await call(A, '2026-10-05', '2026-10-09')
    expect(xpOf(r)).toEqual({ '2026-10-05': 130, '2026-10-06': 160, '2026-10-07': 0 })
    // Bonuses without an event (achievements) never land on a day.
    const [x] = await sql(db,
      `select coalesce(sum(amount), 0)::int as n from public.xp_ledger where user_id = $1 and event_id is null`, [A])
    expect(x.n).toBeGreaterThan(0)
    expect(r.days.reduce((s, d) => s + d.xp, 0)).toBe(290)
  })

  it('includes the weekly goal bonus on the day that hit it', async () => {
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) await loose(A, d)
    await loose(A, '2026-10-10')                         // sixth day: an extra, +25
    await at('2026-10-13')
    const r = await call(A, '2026-10-05', '2026-10-11')
    expect(xpOf(r)).toEqual({
      '2026-10-05': 130, '2026-10-06': 130, '2026-10-07': 130, '2026-10-08': 130,
      '2026-10-09': 120 + 150 + 10, '2026-10-10': 25 + 10, '2026-10-11': 0,
    })
  })

  it('returns the weeks the range touches with the frozen target and the goal', async () => {
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) await loose(A, d)
    await loose(A, '2026-10-12')
    await loose(A, '2026-10-13')
    await at('2026-10-20')
    // Changing the days per week freezes the running week; closed weeks keep what they had.
    await asUser(db, A, () => db.query('update public.profiles set nutrition_days_per_week = 3 where id = $1', [A]))

    // A range that starts and ends mid-week still reports whole weeks.
    const r = await call(A, '2026-10-07', '2026-10-13')
    expect(r.weeks).toEqual([
      { start: '2026-10-05', target: 5, on_target: 5, target_hit: true },
      { start: '2026-10-12', target: 5, on_target: 2, target_hit: false },
    ])
    expect(xpOf(r)['2026-10-09']).toBe(280)

    // A week nothing touched takes the value in force on the profile.
    const w = await call(A, '2026-10-26', '2026-10-30')
    expect(w.days).toEqual([])
    expect(w.weeks).toEqual([{ start: '2026-10-26', target: 3, on_target: 0, target_hit: false }])
    const month = await call(A, '2026-09-28', '2026-11-01')
    expect(month.weeks.map(x => x.start)).toEqual(
      ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
  })

  it('leaves imported days out of the week on-target count', async () => {
    await loose(A, '2026-10-05')
    // The server stores an imported on-target day; it shows in days but never counts in the week.
    await sql(db,
      `insert into public.nutrition_days
         (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, target, logged, on_target, balanced, imported)
       values ($1, '2026-10-06', 2000, 150, 200, 60, 2, null, true, true, true, true)`, [A])
    await at('2026-10-09')
    const r = await call(A, '2026-10-05', '2026-10-11')
    expect(r.days.find(d => d.day === '2026-10-06')?.on_target).toBe(true)
    expect(r.weeks[0].on_target).toBe(1)
  })

  it('keeps one person from seeing another', async () => {
    await loose(A, '2026-10-05')
    await at('2026-10-09')
    await makeUser(db, B, { nutrition_days_per_week: 4 })
    const b = await call(B, '2026-10-05', '2026-10-11')
    expect(b.days).toEqual([])
    expect(b.weeks).toEqual([{ start: '2026-10-05', target: 4, on_target: 0, target_hit: false }])
    expect((await call(A, '2026-10-05', '2026-10-11')).days).toHaveLength(3)           // closed up to 07/10
  })

  it('keeps the 62 day limit', async () => {
    await at('2026-10-09')
    expect((await call(A, '2026-10-01', '2026-12-01')).weeks).toHaveLength(10)
    await expect(call(A, '2026-10-01', '2026-12-02')).rejects.toThrow(/invalid_range/)
    await expect(call(A, '2026-10-10', '2026-10-01')).rejects.toThrow(/invalid_range/)
    await expect(call(null, '2026-10-01', '2026-10-10')).rejects.toThrow(/permission denied/)
  })
})
