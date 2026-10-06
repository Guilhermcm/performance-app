import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { closeAs, enableNutrition, setTarget } from './helpers/nutrition'

let db: PGlite
const T = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }

// Diary items straight into the table as the owner, so any past day can be filled.
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

const closedDays = async (uid: string) =>
  (await sql<{ day: string }>(db,
    `select to_char(day, 'YYYY-MM-DD') as day from public.nutrition_days where user_id = $1 order by day`, [uid]))
    .map(r => r.day)

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await enableNutrition(db, A)
  await setTarget(db, A, '2026-10-05', T)
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday
})

describe('closing a nutrition day', () => {
  it('closes a day at the start of D+2', async () => {
    await onTarget(A, '2026-10-05')
    await onTarget(A, '2026-10-06')
    await setClock(db, '2026-10-07T02:59:00Z')   // 23:59 on Tuesday in Sao Paulo
    expect(await closeAs(db, A)).toBe(0)
    await setClock(db, '2026-10-07T03:01:00Z')   // 00:01 on Wednesday
    expect(await closeAs(db, A)).toBe(1)
    expect(await closedDays(A)).toEqual(['2026-10-05'])
  })

  it('stores the totals and the target in force', async () => {
    await item(A, '2026-10-05', 'breakfast', 300.5, 20.2, 40, 5.1)
    await item(A, '2026-10-05', 'lunch', 700, 50, 60, 20)
    await item(A, '2026-10-05', 'lunch', 100, 10, 0, 1)
    // A target from the next day on does not reach the day being closed.
    await setTarget(db, A, '2026-10-06', { kcal: 2500, protein_g: 180, carbs_g: 250, fat_g: 70 })
    await closeAs(db, A)
    const [r] = await sql(db,
      `select kcal::float8 as kcal, protein_g::float8 as protein_g, carbs_g::float8 as carbs_g,
              fat_g::float8 as fat_g, meals, target, logged, on_target, balanced, imported
         from public.nutrition_days where user_id = $1 and day = '2026-10-05'`, [A])
    expect(r).toEqual({
      kcal: 1100.5, protein_g: 80.2, carbs_g: 100, fat_g: 26.1, meals: 2, target: T,
      logged: true, on_target: false, balanced: false, imported: false,
    })
  })

  it('pays the day once', async () => {
    await onTarget(A, '2026-10-05')
    await closeAs(db, A)
    const first = await ledger(db, A)
    expect(await closeAs(db, A)).toBe(0)
    expect(await ledger(db, A)).toEqual(first)
    expect(first.filter(r => !r.reason.startsWith('achievement:'))).toEqual([
      { reason: 'nutrition_logged', amount: 10, week_start: '2026-10-05', pillar: 'nutrition' },
      { reason: 'nutrition_day', amount: 120, week_start: '2026-10-05', pillar: 'nutrition' },
      { reason: 'nutrition_balanced', amount: 30, week_start: '2026-10-05', pillar: 'nutrition' },
    ])
    const events = await sql(db,
      `select kind, pillar::text as pillar, to_char(occurred_on, 'YYYY-MM-DD') as on, source_ref
         from public.activity_events where user_id = $1 order by id`, [A])
    expect(events).toEqual(['day_logged', 'day_on_target', 'macros_balanced'].map(kind => (
      { kind, pillar: 'nutrition', on: '2026-10-05', source_ref: 'nutrition:2026-10-05' })))
  })

  it('pays nothing for a day that was not logged', async () => {
    await item(A, '2026-10-05', 'lunch', 2000, 150, 200, 60)   // one meal only
    expect(await closeAs(db, A)).toBe(1)
    expect(await ledger(db, A)).toEqual([])
    const [r] = await sql(db, `select logged, meals from public.nutrition_days where user_id = $1`, [A])
    expect(r).toEqual({ logged: false, meals: 1 })
  })

  it('skips days outside a period and days without a target', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    await makeUser(db, B)
    await enableNutrition(db, B)                             // period from 05/10
    await setTarget(db, B, '2026-10-06', T)                  // 05/10 has no target
    await setClock(db, '2026-10-07T15:00:00Z')
    await enableNutrition(db, B, false)                      // period ends on 06/10
    await setClock(db, '2026-10-08T15:00:00Z')
    await enableNutrition(db, B)                             // new period from 08/10
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) await onTarget(B, day)
    await setClock(db, '2026-10-11T15:00:00Z')
    expect(await closeAs(db, B)).toBe(3)
    expect(await closedDays(B)).toEqual(['2026-10-06', '2026-10-08', '2026-10-09'])
    expect(await closeAs(db, B)).toBe(0)
  })

  it('skips days before the pillar was ever on', async () => {
    await makeUser(db, B)
    await setTarget(db, B, '2026-10-01', T)
    await onTarget(B, '2026-10-03')
    await setClock(db, '2026-10-05T15:00:00Z')
    await enableNutrition(db, B)
    await onTarget(B, '2026-10-05')
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeAs(db, B)).toBe(1)
    expect(await closedDays(B)).toEqual(['2026-10-05'])
  })

  it('closes nothing for someone who never turned the pillar on', async () => {
    await makeUser(db, B)
    await setTarget(db, B, '2026-10-01', T)
    await onTarget(B, '2026-10-03')
    expect(await closeAs(db, B)).toBe(0)
    expect(await closedDays(B)).toEqual([])
  })

  it('closes days in the profile time zone', async () => {
    await makeUser(db, B, { timezone: 'Asia/Tokyo' })
    await setClock(db, '2026-10-04T16:00:00Z')               // 01:00 on 05/10 in Tokyo
    await enableNutrition(db, B)
    await setTarget(db, B, '2026-10-05', T)
    await onTarget(B, '2026-10-05')
    await onTarget(B, '2026-10-06')
    await setClock(db, '2026-10-07T14:59:00Z')               // 23:59 on 07/10 in Tokyo
    expect(await closeAs(db, B)).toBe(1)
    expect(await closedDays(B)).toEqual(['2026-10-05'])
    await setClock(db, '2026-10-07T15:01:00Z')               // 00:01 on 08/10 in Tokyo, 12:01 on 07/10 in Sao Paulo
    expect(await closeAs(db, B)).toBe(1)
    expect(await closedDays(B)).toEqual(['2026-10-05', '2026-10-06'])
  })

  it('pays the Sunday in its own week', async () => {
    await onTarget(A, '2026-10-11')
    await setClock(db, '2026-10-13T15:00:00Z')               // Tuesday of the next week
    expect(await closeAs(db, A)).toBe(7)
    const weeks = await sql(db,
      `select distinct to_char(l.week_start, 'YYYY-MM-DD') as week
         from public.xp_ledger l join public.activity_events e on e.id = l.event_id
        where e.user_id = $1 and e.source_ref = 'nutrition:2026-10-11'`, [A])
    expect(weeks).toEqual([{ week: '2026-10-05' }])
  })

  it('survives the largest day', async () => {
    await sql(db,
      `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
       select gen_random_uuid(), $1, '2026-10-05', (array['breakfast','lunch','dinner','snack'])[1 + i % 4],
              'Item', 'quick', 5000, 500, 500, 500
         from generate_series(1, 200) i`, [A])
    expect(await closeAs(db, A)).toBe(1)
    const [r] = await sql(db,
      `select kcal::float8 as kcal, fat_g::float8 as fat_g, meals, logged, on_target
         from public.nutrition_days where user_id = $1`, [A])
    expect(r).toEqual({ kcal: 1000000, fat_g: 100000, meals: 4, logged: true, on_target: false })
  })

  it('never touches strength reasons', async () => {
    const streak = () => sql(db, `select * from public.streaks where user_id = $1 and kind = 'training_week'`, [A])
    const before = await streak()
    for (let d = 5; d <= 11; d++) await onTarget(A, `2026-10-${String(d).padStart(2, '0')}`)
    await setClock(db, '2026-10-13T15:00:00Z')
    expect(await closeAs(db, A)).toBe(7)
    const rows = (await ledger(db, A)).filter(r => !r.reason.startsWith('achievement:'))
    expect(rows.every(r => r.pillar === 'nutrition' && r.reason.startsWith('nutrition_'))).toBe(true)
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(960)
    const [s] = await sql(db, `select public.achievement_stats($1) -> 'week_targets' as v`, [A])
    expect(s.v).toBe(0)
    expect(await streak()).toEqual(before)
  })
})

describe('nutrition_days access', () => {
  it('lets people read their own days and write none', async () => {
    await onTarget(A, '2026-10-05')
    await closeAs(db, A)
    await makeUser(db, B)
    const read = (uid: string) => asUser(db, uid, () => db.query('select day from public.nutrition_days'))
    expect((await read(A)).rows).toHaveLength(1)
    expect((await read(B)).rows).toHaveLength(0)
    await expect(asUser(db, A, () => db.query(
      `insert into public.nutrition_days (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, logged, on_target, balanced)
       values ($1, '2026-10-06', 0, 0, 0, 0, 0, true, true, true)`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      `update public.nutrition_days set on_target = true where user_id = $1`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      `delete from public.nutrition_days where user_id = $1`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_nutrition_days($1)', [A])))
      .rejects.toThrow(/permission denied/)
  })
})
