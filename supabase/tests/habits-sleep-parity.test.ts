import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, ledger, sql } from './helpers/game'
import { addCheckin } from './helpers/checkin'
import { closeAs, enableNutrition, setTarget } from './helpers/nutrition'
import { closeSleepAs, enableSleep, logNight, setSleepTarget } from './helpers/sleep'

// The Treino, Nutrition and Sleep branches of the functions Habits redefines keep behaving as in
// phase 3. One describe per task that redefines something.

let db: PGlite

const pillarRows = async (uid: string) => (await ledger(db, uid)).filter(r => !r.reason.startsWith('achievement:'))

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await sql(db, `update public.app_settings set value = '"2026-10-05"' where key = 'training_checkin_since'`)
})

describe('award_xp (0027)', () => {
  it('still pays a check-in day', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday
    const [c] = await sql(db, 'select public.close_training_days($1) as n', [A])
    expect(c.n).toBe(1)
    const [{ xp }] = await sql(db, 'select public.session_xp(3, 1) as xp')
    expect(await pillarRows(A)).toEqual([
      { reason: 'training_logged', amount: 10, week_start: '2026-10-05', pillar: 'strength' },
      { reason: 'training_day', amount: xp, week_start: '2026-10-05', pillar: 'strength' },
    ])
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
    expect(await pillarRows(A)).toEqual([
      { reason: 'nutrition_logged', amount: 10, week_start: '2026-10-05', pillar: 'nutrition' },
      { reason: 'nutrition_day', amount: 120, week_start: '2026-10-05', pillar: 'nutrition' },
      { reason: 'nutrition_balanced', amount: 30, week_start: '2026-10-05', pillar: 'nutrition' },
    ])
  })

  it('still pays a sleep night', async () => {
    await enableSleep(db, A)                      // T = 5
    await setSleepTarget(db, A, '2026-10-05', 480, '23:00')
    await logNight(db, A, '2026-10-05', '23:00', '07:00', { asOwner: true })
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await closeSleepAs(db, A)).toBe(1)
    expect(await pillarRows(A)).toEqual([
      { reason: 'sleep_logged', amount: 10, week_start: '2026-10-05', pillar: 'sleep' },
      { reason: 'sleep_night', amount: 120, week_start: '2026-10-05', pillar: 'sleep' },
    ])
  })
})
