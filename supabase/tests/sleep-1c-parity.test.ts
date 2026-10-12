import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, ledger, sql } from './helpers/game'
import { addCheckin } from './helpers/checkin'
import { closeAs, enableNutrition, setTarget } from './helpers/nutrition'

// The Treino and Nutrition branches of the functions Sleep redefines keep behaving as in 1c.
// One describe per task that redefines something.

let db: PGlite

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await sql(db, `update public.app_settings set value = '"2026-10-05"' where key = 'training_checkin_since'`)
})

describe('award_xp (0022)', () => {
  it('still pays and closes a check-in day', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday
    const [c] = await sql(db, 'select public.close_training_days($1) as n', [A])
    expect(c.n).toBe(1)
    const [{ xp }] = await sql(db, 'select public.session_xp(3, 1) as xp')
    expect((await ledger(db, A)).filter(r => !r.reason.startsWith('achievement:'))).toEqual([
      { reason: 'training_logged', amount: 10, week_start: '2026-10-05', pillar: 'strength' },
      { reason: 'training_day', amount: xp, week_start: '2026-10-05', pillar: 'strength' },
    ])
    const [d] = await sql(db,
      `select checked from public.training_days where user_id = $1 and day = '2026-10-05'`, [A])
    expect(d.checked).toBe(true)
  })

  it('still pays a nutrition day', async () => {
    await enableNutrition(db, A)
    await setTarget(db, A, '2026-10-05', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 })
    // Two meals, the target exactly: logged and on target.
    for (const meal of ['lunch', 'dinner'])
      await sql(db,
        `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
         values (gen_random_uuid(), $1, '2026-10-05', $2, 'Item', 'quick', 1000, 75, 100, 30)`, [A, meal])
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeAs(db, A)).toBe(1)
    expect((await ledger(db, A)).filter(r => !r.reason.startsWith('achievement:'))).toEqual([
      { reason: 'nutrition_logged', amount: 10, week_start: '2026-10-05', pillar: 'nutrition' },
      { reason: 'nutrition_day', amount: 120, week_start: '2026-10-05', pillar: 'nutrition' },
      { reason: 'nutrition_balanced', amount: 30, week_start: '2026-10-05', pillar: 'nutrition' },
    ])
  })
})

describe('achievement_stats (0022)', () => {
  it('still counts training days and nutrition metrics', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await enableNutrition(db, A)
    await setTarget(db, A, '2026-10-05', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 })
    for (const meal of ['lunch', 'dinner'])
      await sql(db,
        `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
         values (gen_random_uuid(), $1, '2026-10-05', $2, 'Item', 'quick', 1000, 75, 100, 30)`, [A, meal])
    await setClock(db, '2026-10-07T15:00:00Z')
    await sql(db, 'select public.close_training_days($1)', [A])
    expect(await closeAs(db, A)).toBe(1)
    const [{ s }] = await sql(db, 'select public.achievement_stats($1) as s', [A])
    expect(s).toMatchObject({
      workouts: 1, nutrition_logged_days: 1, nutrition_on_target_days: 1, protein_best_run: 1,
      sleep_logged_nights: 0, sleep_on_target_nights: 0, sleep_week_targets: 0, sleep_best_streak: 0,
      sleep_clock_best_run: 0,
    })
  })
})

describe('progress (0023)', () => {
  const progress = async () =>
    (await asUser(db, A, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p

  it('still closes training days and shows the Treino week', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday: Monday closes
    const p = await progress()
    const [{ xp }] = await sql(db, 'select public.session_xp(3, 1) as xp')
    expect(p.week.pillars.strength).toBe(10 + xp)
    expect(p.week.workouts).toBe(1)
    expect(p.training.last_closed).toEqual({ day: '2026-10-05', detailed: false, xp: 10 + xp })
    expect(p.training.confirms_on).toBe('2026-10-09')
  })

  it('still computes the Treino and Nutrition radar', async () => {
    let n = 0
    const xpRow = (pillar: string, amount: number, week: string) =>
      sql(db,
        `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
         values ($1, $2, $3, $4, null, $5)`,
        [A, pillar, amount, `test_${++n}`, week])
    // Wednesday 04/11: closed weeks 26/10 back to 05/10. Treino since 19/10, Nutrition from 29/10.
    await setClock(db, '2026-11-04T15:00:00Z')
    await sql(db, `update public.profiles set created_at = '2026-10-19T15:00:00Z' where id = $1`, [A])
    await xpRow('strength', 960, '2026-10-19')
    await xpRow('strength', 480, '2026-10-26')
    await sql(db, `insert into public.nutrition_periods (user_id, started_on) values ($1, '2026-10-29')`, [A])
    await xpRow('nutrition', 480, '2026-10-26')
    expect((await progress()).radar).toEqual({
      strength: { current: 0.75, previous: null },
      nutrition: { current: 0.5, previous: null },
      sleep: { current: null, previous: null },
    })
  })
})
