import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, ledger, sql } from './helpers/game'
import { befriend, one, rows } from './helpers/social'
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

describe('achievement_stats (0027)', () => {
  it('still counts training, nutrition and sleep metrics', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await enableNutrition(db, A)
    await setTarget(db, A, '2026-10-05', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 })
    for (const meal of ['lunch', 'dinner'])
      await sql(db,
        `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
         values (gen_random_uuid(), $1, '2026-10-05', $2, 'Item', 'quick', 1000, 75, 100, 30)`, [A, meal])
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-05', 480, '23:00')
    await logNight(db, A, '2026-10-05', '23:00', '07:00', { asOwner: true })
    await setClock(db, '2026-10-07T15:00:00Z')
    await sql(db, 'select public.close_training_days($1)', [A])
    expect(await closeAs(db, A)).toBe(1)
    expect(await closeSleepAs(db, A)).toBe(1)
    const [{ s }] = await sql(db, 'select public.achievement_stats($1) as s', [A])
    expect(s).toMatchObject({
      workouts: 1, nutrition_logged_days: 1, nutrition_on_target_days: 1, protein_best_run: 1,
      sleep_logged_nights: 1, sleep_on_target_nights: 1, sleep_week_targets: 0, sleep_best_streak: 0,
      sleep_clock_best_run: 1,
    })
  })
})

describe('progress (0028)', () => {
  const progress = async () =>
    (await asUser(db, A, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p

  it('still closes training days, nutrition days and sleep nights', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await enableNutrition(db, A)
    await setTarget(db, A, '2026-10-05', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 })
    for (const meal of ['lunch', 'dinner'])
      await sql(db,
        `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
         values (gen_random_uuid(), $1, '2026-10-05', $2, 'Item', 'quick', 1000, 75, 100, 30)`, [A, meal])
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-05', 480, '23:00')
    await logNight(db, A, '2026-10-05', '23:00', '07:00', { asOwner: true })
    await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday: Monday closes in the three pillars
    const p = await progress()
    const [{ xp }] = await sql(db, 'select public.session_xp(3, 1) as xp')
    expect(p.training.last_closed).toEqual({ day: '2026-10-05', detailed: false, xp: 10 + xp })
    expect(p.nutrition.last_closed).toEqual({ day: '2026-10-05', logged: true, on_target: true, balanced: true, xp: 160 })
    expect(p.sleep.last_closed).toEqual({ night: '2026-10-05', logged: true, on_target: true, rested: false, xp: 130 })
    expect(p.week.pillars).toMatchObject({ strength: 10 + xp, nutrition: 160, sleep: 130, habits: 0 })
    expect(p.week.max).toBe(2880)
    expect('habits' in p).toBe(false)
  })

  it('still computes the Treino, Nutrition and Sleep radar', async () => {
    let n = 0
    const xpRow = (pillar: string, amount: number, week: string) =>
      sql(db,
        `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
         values ($1, $2, $3, $4, null, $5)`,
        [A, pillar, amount, `test_${++n}`, week])
    // Wednesday 04/11: closed weeks 26/10 back to 05/10. Treino since 19/10, Nutrition from 29/10,
    // Sleep from 22/10.
    await setClock(db, '2026-11-04T15:00:00Z')
    await sql(db, `update public.profiles set created_at = '2026-10-19T15:00:00Z' where id = $1`, [A])
    await xpRow('strength', 960, '2026-10-19')
    await xpRow('strength', 480, '2026-10-26')
    await sql(db, `insert into public.nutrition_periods (user_id, started_on) values ($1, '2026-10-29')`, [A])
    await xpRow('nutrition', 480, '2026-10-26')
    await sql(db, `insert into public.sleep_periods (user_id, started_on) values ($1, '2026-10-22')`, [A])
    await xpRow('sleep', 960, '2026-10-19')
    await xpRow('sleep', 960, '2026-10-26')
    expect((await progress()).radar).toEqual({
      strength: { current: 0.75, previous: null },
      nutrition: { current: 0.5, previous: null },
      sleep: { current: 1, previous: null },
      habits: { current: null, previous: null },
    })
  })
})

describe('challenges (0029)', () => {
  // Named parameters of the Sleep-era client (no p_share_habits). Seven days from Monday 2026-10-05.
  const create = async (template: string, target: number, share: { nutrition?: boolean; sleep?: boolean } = {}) =>
    (await one<{ id: string }>(db, A,
      `select public.create_challenge(p_template => $1, p_title => 'Desafio', p_mode => 'team', p_target => $2::numeric,
              p_starts_on => '2026-10-05', p_ends_on => '2026-10-11', p_invitees => $3::uuid[],
              p_share_volume => false, p_share_nutrition => $4, p_share_sleep => $5) as v`,
      [template, target, '{' + B + '}', share.nutrition ?? false, share.sleep ?? false])).id
  const join = (id: string, share: { nutrition?: boolean; sleep?: boolean } = {}) =>
    rows(db, B,
      `select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => $2,
              p_share_sleep => $3)`,
      [id, share.nutrition ?? false, share.sleep ?? false])
  const board = async () => {
    const [c] = await one<any[]>(db, A, 'select public.get_challenges() as v')
    return { status: c.status, members: c.members.map((m: any) => [m.name, m.progress, m.won]) }
  }
  const closeAll = async () => (await sql<{ n: number }>(db, 'select public.close_all_challenges() as n'))[0].n
  const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)

  beforeEach(async () => {
    await makeUser(db, B, { display_name: 'Bia' })
    await befriend(db, A, B)
  })

  it('still counts training days in checkin_days', async () => {
    const id = await create('checkin_days', 5)
    await join(id)
    await addCheckin(db, A, { day: '2026-10-05' })
    await addCheckin(db, A, { day: '2026-10-05', visibility: 'private' })   // same day
    await setClock(db, '2026-10-07T15:00:00Z')
    await sql(db, 'select public.close_training_days($1)', [A])
    expect(await board()).toEqual({ status: 'active', members: [['Ana', 1, null], ['Bia', 0, null]] })
  })

  it('still closes a nutrition challenge', async () => {
    for (const u of [A, B]) {
      await enableNutrition(db, u)
      await setTarget(db, u, '2026-10-05', { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 })
    }
    const id = await create('nutrition_days_on_target', 2, { nutrition: true })
    await join(id, { nutrition: true })
    // Ana on target on Monday and on the last day; nothing closed before the challenge.
    for (const day of ['2026-10-05', '2026-10-11'])
      for (const meal of ['lunch', 'dinner'])
        await sql(db,
          `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
           values (gen_random_uuid(), $1, $2, $3, 'Item', 'quick', 1000, 75, 100, 30)`, [A, day, meal])
    await setClock(db, '2026-10-14T02:59:00Z')       // 23:59 on ends_on + 2
    expect(await closeAll()).toBe(0)
    await setClock(db, '2026-10-14T03:01:00Z')       // 00:01 on ends_on + 3
    expect(await closeAll()).toBe(1)
    expect(await board()).toEqual({ status: 'won', members: [['Ana', 2, true], ['Bia', 0, true]] })
    expect(await bonus(B)).toEqual([300])
  })

  it('still closes a sleep challenge after closing pending nights', async () => {
    for (const u of [A, B]) {
      await enableSleep(db, u)
      await setSleepTarget(db, u, '2026-10-05', 480, '23:00')
    }
    const id = await create('sleep_nights_on_target', 3, { sleep: true })
    await join(id, { sleep: true })
    // Ana on target on Monday and the last two nights, Bia on Wednesday; nothing closed before.
    for (const night of ['2026-10-05', '2026-10-10', '2026-10-11'])
      await logNight(db, A, night, '23:00', '07:00', { asOwner: true })
    await logNight(db, B, '2026-10-07', '23:00', '07:00', { asOwner: true })
    await setClock(db, '2026-10-14T02:59:00Z')       // 23:59 on ends_on + 2
    expect(await closeAll()).toBe(0)
    await setClock(db, '2026-10-14T03:01:00Z')       // 00:01 on ends_on + 3
    expect(await closeAll()).toBe(1)
    expect(await board()).toEqual({ status: 'won', members: [['Ana', 3, true], ['Bia', 1, true]] })
    const [last] = await sql(db,
      `select to_char(max(night), 'YYYY-MM-DD') as n from public.sleep_nights where user_id = $1`, [A])
    expect(last.n).toBe('2026-10-12')
    expect(await bonus(A)).toEqual([300])
  })
})
