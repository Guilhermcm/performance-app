import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { closeAs, enableNutrition, setTarget } from './helpers/nutrition'

let db: PGlite
const T = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }
const C = '00000000-0000-0000-0000-00000000000c'

const NUTRITION_CODES = [
  'nutrition_first_day', 'nutrition_days_10', 'nutrition_days_50', 'nutrition_days_100', 'nutrition_days_250',
  'nutrition_week_target_1', 'nutrition_streak_4', 'nutrition_streak_12', 'nutrition_streak_26', 'protein_7',
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => iso(new Date(Date.parse(day + 'T12:00:00Z') + n * 86_400_000))
// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')

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

// The first `days` days of each week from `monday` on target, for `weeks` weeks.
const hitWeeks = async (uid: string, monday: string, weeks: number, days = 3) => {
  for (let w = 0; w < weeks; w++) for (let d = 0; d < days; d++) await onTarget(uid, addDays(monday, 7 * w + d))
}

const streak = async (uid = A) => {
  const [r] = await sql(db,
    `select current, best, shields, to_char(last_period, 'YYYY-MM-DD') as last
       from public.streaks where user_id = $1 and kind = 'nutrition_week'`, [uid])
  return r ?? { current: 0, best: 0, shields: 0, last: null }
}

const codes = async (uid = A) =>
  (await sql<{ code: string }>(db,
    `select code from public.user_achievements where user_id = $1 and code = any($2) order by code`,
    [uid, NUTRITION_CODES])).map(r => r.code)

// Turns the pillar off on `off` and back on on `on` (the days in between are outside a period).
const pause = async (uid: string, off: string, on: string) => {
  await at(off)
  await enableNutrition(db, uid, false)
  await at(on)
  await enableNutrition(db, uid)
}

beforeEach(async () => {
  db = await freshDb()
  await at('2026-10-05')                         // Monday
  await makeUser(db, A, { nutrition_days_per_week: 3 })
  await enableNutrition(db, A)
  await setTarget(db, A, '2026-10-05', T)
})

describe('nutrition weekly streak', () => {
  it('counts a week once all seven days are closed', async () => {
    await hitWeeks(A, '2026-10-05', 1)
    await at('2026-10-12')                       // Monday: Saturday 10/10 is the last closed day
    await closeAs(db, A)
    expect(await streak()).toMatchObject({ current: 0, last: null })
    await at('2026-10-13')                       // Tuesday: Sunday 11/10 closes
    await closeAs(db, A)
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
    await closeAs(db, A)
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
  })

  it('builds the streak and gives shields every 4 weeks', async () => {
    await hitWeeks(A, '2026-10-05', 12)
    await at(addDays('2026-10-05', 7 * 3 + 8))   // four weeks judged
    await closeAs(db, A)
    expect(await streak()).toMatchObject({ current: 4, best: 4, shields: 1 })
    expect(await codes()).toContain('nutrition_streak_4')
    await at(addDays('2026-10-05', 7 * 11 + 8))  // twelve weeks judged
    await closeAs(db, A)
    expect(await streak()).toMatchObject({ current: 12, best: 12, shields: 2 })
    expect(await codes()).toContain('nutrition_streak_12')
    // Three missed weeks: two shields go, then the streak breaks.
    await at(addDays('2026-10-05', 7 * 13 + 8))
    await closeAs(db, A)
    expect(await streak()).toMatchObject({ current: 12, best: 12, shields: 0 })
    await at(addDays('2026-10-05', 7 * 14 + 8))
    await closeAs(db, A)
    expect(await streak()).toMatchObject({ current: 0, best: 12, shields: 0 })
    const [s] = await sql(db,
      `select public.achievement_stats($1) -> 'nutrition_best_streak' as best,
              public.achievement_stats($1) -> 'nutrition_week_targets' as targets`, [A])
    expect(s).toEqual({ best: 12, targets: 12 })
  })

  it('makes a week with a day off neutral', async () => {
    await hitWeeks(A, '2026-10-05', 4)                   // 05/10 to 01/11: four weeks, one shield
    await pause(A, '2026-11-04', '2026-11-05')           // Wednesday 04/11 is outside a period
    await onTarget(A, '2026-11-02')
    await onTarget(A, '2026-11-03')
    await onTarget(A, '2026-11-05')
    await pause(A, '2026-11-11', '2026-11-12')           // Wednesday 11/11 too, and no goal that week
    await at('2026-11-16')
    await closeAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 1, last: '2026-11-02' })
    await at('2026-11-17')                               // week of 09/11 judged: neutral and missed
    await closeAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 1, last: '2026-11-09' })
    await at('2026-11-24')                               // week of 16/11 is a full week, missed
    await closeAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 0, last: '2026-11-16' })
  })

  it('treats the activation week as neutral', async () => {
    // Activated on a Wednesday: Monday and Tuesday are outside a period, and the goal met counts.
    await makeUser(db, B, { nutrition_days_per_week: 3 })
    await at('2026-10-07')
    await enableNutrition(db, B)
    await setTarget(db, B, '2026-10-07', T)
    for (const day of ['2026-10-07', '2026-10-08', '2026-10-09']) await onTarget(B, day)
    await at('2026-10-13')
    await closeAs(db, B)
    expect(await streak(B)).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })

    // A, with a shield, turns the pillar off for weeks and back on mid-week without meeting the
    // goal: the weeks off and the week it comes back keep the streak and the shield.
    await hitWeeks(A, '2026-10-05', 4)
    await at('2026-11-02')
    await enableNutrition(db, A, false)                  // off from Sunday 01/11
    await at('2026-11-18')
    await enableNutrition(db, A)                         // back on Wednesday 18/11
    await at('2026-11-24')
    await closeAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-11-16' })
  })
})

describe('nutrition badges', () => {
  it('unlocks private nutrition badges', async () => {
    // Imported days (phase 2b) never count.
    await sql(db,
      `insert into public.nutrition_days
         (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, target, logged, on_target, balanced, imported)
       select $1, d::date, 2000, 150, 200, 60, 2, $2::jsonb, true, true, true, true
         from generate_series('2026-08-01'::date, '2026-09-30'::date, interval '1 day') d`,
      [A, JSON.stringify(T)])
    for (let d = 0; d < 5; d++) await onTarget(A, addDays('2026-10-05', d))
    await at('2026-10-11')
    await closeAs(db, A)
    expect(await codes()).toEqual(['nutrition_first_day', 'nutrition_week_target_1'])
    for (let d = 5; d < 10; d++) await onTarget(A, addDays('2026-10-05', d))
    await at('2026-10-16')
    await closeAs(db, A)
    expect(await codes()).toEqual(['nutrition_days_10', 'nutrition_first_day', 'nutrition_week_target_1', 'protein_7'])
    const [s] = await sql(db, `select public.achievement_stats($1) as s`, [A])
    expect(s.s).toMatchObject({
      nutrition_logged_days: 10, nutrition_on_target_days: 10, nutrition_week_targets: 2,
      nutrition_best_streak: 1, protein_best_run: 10,
    })
    const [x] = await sql(db,
      `select amount from public.xp_ledger where user_id = $1 and reason = 'achievement:nutrition_days_10'`, [A])
    expect(x.amount).toBe(100)

    const catalog = await sql<{ code: string; private: boolean }>(db,
      'select code, private from public.achievement_catalog order by sort')
    expect(catalog.filter(r => r.private).map(r => r.code)).toEqual(NUTRITION_CODES)
    expect(catalog.filter(r => !r.private)).toHaveLength(22)
  })

  it('counts the longest run of days with protein met', async () => {
    const day = (d: number, protein: number) => sql(db,
      `insert into public.nutrition_days
         (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, target, logged, on_target, balanced)
       values ($1, $2, 1000, $3, 0, 0, 1, $4::jsonb, false, false, false)`,
      [A, addDays('2026-09-01', d), protein, JSON.stringify(T)])
    for (const d of [0, 1, 2]) await day(d, 150)
    await day(3, 149.9)
    for (const d of [4, 5, 6, 7]) await day(d, 200)
    await day(9, 150)                              // a gap of a day breaks the run too
    const [s] = await sql(db, `select public.achievement_stats($1) -> 'protein_best_run' as v`, [A])
    expect(s.v).toBe(4)
  })
})

describe('get_nutrition_days', () => {
  it('returns closed days and the target in force', async () => {
    await onTarget(A, '2026-10-05')
    await item(A, '2026-10-06', 'lunch', 500, 20, 50, 10)
    await setTarget(db, A, '2026-10-09', { kcal: 2200, protein_g: 160, carbs_g: 230, fat_g: 65 }, 'manual')
    await at('2026-10-09')
    const call = (uid: string | null, from: string, to: string) => asUser(db, uid, async () =>
      (await db.query<{ r: any }>('select public.get_nutrition_days($1, $2) as r', [from, to])).rows[0].r)

    const r = await call(A, '2026-10-01', '2026-10-10')
    expect(r.target).toEqual({ valid_from: '2026-10-09', mode: 'manual', kcal: 2200, protein_g: 160, carbs_g: 230, fat_g: 65 })
    expect(r.days).toEqual([
      { day: '2026-10-05', kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, meals: 2, target: T,
        logged: true, on_target: true, balanced: true, imported: false, xp: 240 },
      { day: '2026-10-06', kcal: 500, protein_g: 20, carbs_g: 50, fat_g: 10, meals: 1, target: T,
        logged: false, on_target: false, balanced: false, imported: false, xp: 0 },
      { day: '2026-10-07', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals: 0, target: T,
        logged: false, on_target: false, balanced: false, imported: false, xp: 0 },
    ])
    // It closed the pending days on the way and paid them.
    const [x] = await sql(db, `select count(*)::int as n from public.xp_ledger where user_id = $1 and reason = 'nutrition_day'`, [A])
    expect(x.n).toBe(1)

    expect((await call(A, '2026-10-06', '2026-10-06')).days).toHaveLength(1)
    expect((await call(A, '2026-10-01', '2026-12-01')).days).toHaveLength(3)   // 62 days
    await expect(call(A, '2026-10-01', '2026-12-02')).rejects.toThrow(/invalid_range/)
    await expect(call(A, '2026-10-10', '2026-10-01')).rejects.toThrow(/invalid_range/)
    await expect(call(A, '2026-10-01', null as unknown as string)).rejects.toThrow(/invalid_range/)

    await makeUser(db, B)
    expect(await call(B, '2026-10-01', '2026-10-10')).toMatchObject({ target: null, days: [] })
    await expect(call(null, '2026-10-01', '2026-10-10')).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_nutrition_weeks($1)', [A])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_all_nutrition_days()')))
      .rejects.toThrow(/permission denied/)
  })
})

describe('close_all_nutrition_days', () => {
  it('closes everyone with an open period in the safety net', async () => {
    await makeUser(db, B, { nutrition_days_per_week: 3 })
    await enableNutrition(db, B)
    await setTarget(db, B, '2026-10-05', T)
    await makeUser(db, C)                                  // never turned the pillar on
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      await onTarget(A, day)
      await onTarget(B, day)
    }
    await at('2026-10-08')
    await enableNutrition(db, B, false)                    // B's period ends on 07/10
    const all = async () => (await sql<{ n: number }>(db, 'select public.close_all_nutrition_days() as n'))[0].n
    const days = async (uid: string) =>
      (await sql<{ n: number }>(db, 'select count(*)::int as n from public.nutrition_days where user_id = $1', [uid]))[0].n

    expect(await all()).toBe(2)
    expect(await days(A)).toBe(2)
    expect(await days(B)).toBe(2)
    await at('2026-10-13')
    expect(await all()).toBe(2)                            // B's last week still had to be judged
    expect(await days(A)).toBe(7)
    expect(await days(B)).toBe(3)
    expect(await streak(A)).toMatchObject({ current: 1, last: '2026-10-05' })
    expect(await streak(B)).toMatchObject({ current: 1, last: '2026-10-05' })
    await at('2026-10-14')
    expect(await all()).toBe(1)                            // B is done
  })
})

describe('closing from the last closed day', () => {
  it('does not rescan days already passed', async () => {
    await onTarget(A, '2026-10-05')
    await at('2026-10-09')
    expect(await closeAs(db, A)).toBe(3)
    const before = await sql(db, `select to_char(day, 'YYYY-MM-DD') as day, closed_at from public.nutrition_days where user_id = $1 order by day`, [A])
    // A row older than the last closed day goes missing: the scan starts after the last one, so
    // a second call does not come back for it.
    await sql(db, `delete from public.nutrition_days where user_id = $1 and day = '2026-10-06'`, [A])
    expect(await closeAs(db, A)).toBe(0)
    const after = await sql(db, `select to_char(day, 'YYYY-MM-DD') as day, closed_at from public.nutrition_days where user_id = $1 order by day`, [A])
    expect(after).toEqual(before.filter(r => r.day !== '2026-10-06'))
    await at('2026-10-10')
    expect(await closeAs(db, A)).toBe(1)
  })
})
