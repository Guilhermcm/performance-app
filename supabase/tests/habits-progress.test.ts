import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql, withoutEventWindow } from './helpers/game'
import { befriend } from './helpers/social'
import { enableNutrition } from './helpers/nutrition'
import { enableSleep } from './helpers/sleep'
import { addHabit, checkHabit, enableHabits } from './helpers/habits'

// The habits pillar in the progress answers (spec 5.5, 5.6, 6.4, 11; plan decisions 12 and 15): the
// public card, the owner's block, the radar axis and the habit history.
let db: PGlite

// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')

const progress = async (uid = A) =>
  (await asUser(db, uid, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p
const card = async (uid = A) => (await sql(db, 'select public.progress_card($1) as c', [uid]))[0].c
const history = async (uid: string, from: string, to: string) =>
  (await asUser(db, uid, () =>
    db.query<{ h: any }>('select public.get_habit_history($1, $2) as h', [from, to]))).rows[0].h

// Checks straight into the table as the owner, so any past day can be filled.
const past = (uid: string, habitId: string, ...days: string[]) =>
  Promise.all(days.map(day => checkHabit(db, uid, habitId, day, { asOwner: true })))

// A ledger row straight into the table (as the owner); a bonus without an event needs its own reason.
let n = 0
const xpRow = (uid: string, pillar: string | null, amount: number, week: string) =>
  sql(db,
    `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
     values ($1, $2, $3, $4, null, $5)`,
    [uid, pillar, amount, `test_${++n}`, week])

const period = (uid: string, from: string, to: string | null) =>
  sql(db, 'insert into public.habit_periods (user_id, started_on, ended_on) values ($1, $2, $3)', [uid, from, to])

const closedDays = async (uid: string) =>
  (await sql<{ day: string }>(db,
    `select to_char(day, 'YYYY-MM-DD') as day from public.habit_days where user_id = $1 order by day`, [uid]))
    .map(r => r.day)

// Every key of a JSON value, at any depth.
const keys = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keys)
    : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)])
      : []

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await at('2026-10-05')                       // Monday
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('habits in the public card', () => {
  it('raises the week max by active pillars', async () => {
    expect((await card()).week.max).toBe(960)
    await enableHabits(db, A)
    expect((await card()).week.max).toBe(1920)
    expect((await progress()).week.max).toBe(1920)
    await enableNutrition(db, A)
    await enableSleep(db, A)
    expect((await card()).week.max).toBe(3840)
    // Off from Wednesday: the period still touched this week, not the next one.
    await at('2026-10-07')
    await enableHabits(db, A, false)
    expect((await card()).week.max).toBe(3840)
    await at('2026-10-12')
    expect((await card()).week.max).toBe(2880)
    // A period turned on and off the same day touches no week.
    await enableHabits(db, B)
    await enableHabits(db, B, false)
    expect((await card(B)).week.max).toBe(960)
  })

  it('splits the week XP with habits', async () => {
    await xpRow(A, 'strength', 200, '2026-10-05')
    await xpRow(A, 'nutrition', 70, '2026-10-05')
    await xpRow(A, 'sleep', 130, '2026-10-05')
    await xpRow(A, 'habits', 90, '2026-10-05')
    await xpRow(A, null, 25, '2026-10-05')
    await xpRow(A, 'habits', 960, '2026-09-28')                  // last week: not in this one
    const c = await card()
    expect(c.week.pillars).toEqual({ strength: 200, nutrition: 70, sleep: 130, habits: 90, bonus: 25 })
    expect(c.week.xp).toBe(515)
    expect((await card(B)).week.pillars).toEqual({ strength: 0, nutrition: 0, sleep: 0, habits: 0, bonus: 0 })
  })

  it('hides habits from friends', async () => {
    await enableHabits(db, A)
    const h = await addHabit(db, A, { name: 'Ler', icon: 'book' })    // N = 7: Q = 7, 86 a check
    await past(A, h, '2026-10-05')
    await at('2026-10-07')
    await progress()                                                  // closes Monday
    await befriend(db, A, B)

    const friends = (await asUser(db, B, () => db.query<{ f: any }>('select public.get_friends() as f'))).rows[0].f
    const a = friends.find((f: { id: string }) => f.id === A).card
    for (const shown of [a, await card()]) {
      expect(shown.habits).toBeUndefined()
      expect(shown.radar).toBeUndefined()
      expect(keys(shown).filter(k => /habit_|icon|check|counted|^q$|^c$/.test(k))).toEqual([])
      const text = JSON.stringify(shown)
      for (const secret of ['Ler', 'book', h, 'habits_first_check']) expect(text).not.toContain(secret)
      // Only the pillar's level and XP: 86 for the check + 30 for the day.
      expect(shown.pillars.habits).toEqual({ level: 2, into: 16, need: 150, xp: 116 })
      expect(shown.week.pillars.habits).toBe(116)
    }
    for (const secret of ['Ler', 'book', h, 'habits_first_check']) expect(JSON.stringify(friends)).not.toContain(secret)

    const p = await progress()
    expect(p.achievements.map((x: { code: string }) => x.code)).toContain('habits_first_check')
    expect(p.habits).toBeTruthy()
  })
})

describe('the owner habits block', () => {
  it('reports the habits block to the owner', async () => {
    await enableHabits(db, A)
    const h = await addHabit(db, A, { perWeek: 3 })                  // Q = 3, so P = 7: 86 a check
    const empty = { week: { q: 3, c: 0, xp: 0 }, streak: { current: 0, best: 0, shields: 0 }, last_week: null }
    expect((await progress()).habits).toEqual(empty)

    await past(A, h, '2026-10-05', '2026-10-06', '2026-10-07')
    // Wednesday: Monday closes; Tuesday's check is still open and does not count yet.
    await at('2026-10-07')
    expect((await progress()).habits).toEqual({ ...empty, week: { q: 3, c: 1, xp: 86 + 30 } })
    // Friday: Wednesday closes, C reaches Q: 3 × (86 + 30) and round(150 × 3 / 7) = 64.
    await at('2026-10-09')
    expect((await progress()).habits).toEqual({ ...empty, week: { q: 3, c: 3, xp: 412 } })
    // Monday: a new week, the last one still has Sunday open.
    await at('2026-10-12')
    expect((await progress()).habits).toEqual(empty)
    // Tuesday: Sunday closes and the week is judged.
    await at('2026-10-13')
    expect((await progress()).habits).toEqual({
      week: { q: 3, c: 0, xp: 0 }, streak: { current: 1, best: 1, shields: 0 },
      last_week: { start: '2026-10-05', target_hit: true, bonus: 64 },
    })
    // A week missed: no bonus.
    await at('2026-10-20')
    expect((await progress()).habits.last_week).toEqual({ start: '2026-10-12', target_hit: false, bonus: 0 })
  })

  it('leaves the habits block out until the pillar was ever on', async () => {
    expect('habits' in (await progress())).toBe(false)
    // On and off the same day: the pillar was on once, so the block stays.
    await enableHabits(db, A)
    await enableHabits(db, A, false)
    expect((await progress()).habits).toEqual({
      week: { q: 0, c: 0, xp: 0 }, streak: { current: 0, best: 0, shields: 0 }, last_week: null,
    })
  })

  it('freezes the targets and closes pending days when the owner reads progress', async () => {
    // On since Thursday 01/10, with a habit created that day (its week got min(5, 4) from the trigger).
    await at('2026-10-01')
    await enableHabits(db, A)
    const h = await addHabit(db, A, { perWeek: 5 })
    await past(A, h, '2026-10-01')
    const frozen = () => sql(db,
      `select target from public.habit_targets where habit_id = $1 and week_start = '2026-10-05'`, [h])

    // Monday: nothing froze this week and the days up to Saturday are pending until the owner reads.
    await at('2026-10-05')
    expect(await frozen()).toEqual([])
    expect(await closedDays(A)).toEqual([])
    let p = await progress()
    expect(await frozen()).toEqual([{ target: 5 }])
    expect(await closedDays(A)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(p.habits.week).toEqual({ q: 5, c: 0, xp: 0 })

    // Wednesday: Sunday and Monday are pending until the owner reads progress.
    await past(A, h, '2026-10-05')
    await at('2026-10-07')
    expect(await closedDays(A)).toHaveLength(3)
    p = await progress()
    expect(await closedDays(A)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
    expect(p.habits.week).toEqual({ q: 5, c: 1, xp: 86 + 30 })
    expect(p.week.pillars.habits).toBe(116)
  })

  it('computes the habits radar over closed weeks', async () => {
    // Wednesday 04/11. Closed weeks: 26/10 back to 05/10 (current), 28/09 back to 07/09 (previous).
    await at('2026-11-04')
    // A: habits on from Thursday 22/10 (two active weeks in the window, the first partly).
    await period(A, '2026-10-22', null)
    await xpRow(A, 'habits', 960, '2026-10-19')
    await xpRow(A, 'habits', 480, '2026-10-26')
    await xpRow(A, 'habits', 900, '2026-11-02')                 // running week: not closed
    await xpRow(A, null, 500, '2026-10-26')                     // bonus never counts
    expect((await progress()).radar.habits).toEqual({ current: 0.75, previous: null })

    // B: never on, then one week in the previous window only.
    expect((await progress(B)).radar.habits).toEqual({ current: null, previous: null })
    await period(B, '2026-09-15', '2026-09-16')
    await period(B, '2026-10-13', '2026-10-12')                 // same-day toggle: covers nothing
    await xpRow(B, 'habits', 480, '2026-09-14')
    expect((await progress(B)).radar.habits).toEqual({ current: null, previous: 0.5 })

    // On Monday 09/11 the week of 02/11 is not in yet; on Tuesday, once Sunday closed, it is.
    const consistency = async () =>
      Number((await sql(db, `select public.pillar_consistency($1, 'habits', 0) as v`, [A]))[0].v)
    await at('2026-11-09')
    expect(await consistency()).toBe(0.75)
    await at('2026-11-10')
    expect(await consistency()).toBe(0.8125)                    // (960 + 480 + 900) / (3 * 960)
  })
})

describe('habit history', () => {
  it('returns history for the owner only', async () => {
    // A: on 01/10 to 02/10 (off on 03/10), back on 05/10. Days 03/10 and 04/10 are outside.
    await at('2026-10-01')
    await enableHabits(db, A)
    const h = await addHabit(db, A, { name: 'Ler', perWeek: 3 })     // week of 28/09: min(3, 4) = 3
    await at('2026-10-03')
    await enableHabits(db, A, false)
    await at('2026-10-05')
    await enableHabits(db, A)
    await past(A, h, '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-10')
    await enableHabits(db, B)
    const hb = await addHabit(db, B, { name: 'Correr', perWeek: 2 })
    await past(B, hb, '2026-10-05')
    await at('2026-10-11')                                           // Sunday: up to Friday closes

    // Nothing closed yet: the call closes the pending days first.
    expect(await closedDays(A)).toEqual([])
    const ha = await history(A, '2026-10-01', '2026-10-10')
    expect(ha.days).toEqual([
      { day: '2026-10-01', checks: 1, valid: 1, xp: 116 },
      { day: '2026-10-02', checks: 1, valid: 1, xp: 116 },
      { day: '2026-10-05', checks: 1, valid: 1, xp: 116 },
      { day: '2026-10-06', checks: 1, valid: 1, xp: 116 },
      { day: '2026-10-07', checks: 1, valid: 1, xp: 116 },        // the week bonus is not the day's
      { day: '2026-10-08', checks: 1, valid: 0, xp: 0 },          // beyond the target of 3
      { day: '2026-10-09', checks: 0, valid: 0, xp: 0 },
    ])
    expect(ha.checks).toEqual([
      { habit_id: h, day: '2026-10-01', counted: true },
      { habit_id: h, day: '2026-10-02', counted: true },
      { habit_id: h, day: '2026-10-05', counted: true },
      { habit_id: h, day: '2026-10-06', counted: true },
      { habit_id: h, day: '2026-10-07', counted: true },
      { habit_id: h, day: '2026-10-08', counted: false },
      { habit_id: h, day: '2026-10-10', counted: null },          // still open
    ])
    expect(ha.targets).toEqual([
      { habit_id: h, week_start: '2026-09-28', target: 3 },
      { habit_id: h, week_start: '2026-10-05', target: 3 },
    ])
    expect(ha.periods).toEqual([
      { started_on: '2026-10-01', ended_on: '2026-10-02' },
      { started_on: '2026-10-05', ended_on: null },
    ])
    expect(Object.keys(ha).sort()).toEqual(['checks', 'days', 'periods', 'targets'])
    // A period outside the range is left out.
    expect((await history(A, '2026-10-06', '2026-10-07')).periods)
      .toEqual([{ started_on: '2026-10-05', ended_on: null }])

    // 62 days at most.
    expect((await history(A, '2026-08-10', '2026-10-10')).days).toHaveLength(7)
    await expect(history(A, '2026-08-09', '2026-10-10')).rejects.toThrow(/invalid_range/)
    await expect(history(A, '2026-10-10', '2026-10-01')).rejects.toThrow(/invalid_range/)
    expect(JSON.stringify(ha)).not.toContain(hb)

    // B only gets their own; a period turned on and off the same day covers nothing.
    await period(B, '2026-10-02', '2026-10-01')
    const hB = await history(B, '2026-10-01', '2026-10-10')
    expect(hB.days.map((d: { day: string }) => d.day)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09',
    ])
    expect(hB.checks).toEqual([{ habit_id: hb, day: '2026-10-05', counted: true }])
    expect(hB.targets).toEqual([{ habit_id: hb, week_start: '2026-10-05', target: 2 }])
    expect(hB.periods).toEqual([{ started_on: '2026-10-05', ended_on: null }])
    expect(JSON.stringify(hB)).not.toContain(h)
  })

  it('keeps single progress functions closed to clients', async () => {
    for (const fn of ['progress_card', 'get_habit_history', 'habits_week_active', 'pillar_consistency'])
      expect(await sql(db, `select count(*)::int as n from pg_proc where proname = $1`, [fn])).toEqual([{ n: 1 }])
    for (const q of [
      `select public.progress_card('${B}')`,
      `select public.my_progress_extras('${B}')`,
      `select public.habits_week_active('${B}', '2026-10-05')`,
      `select public.pillar_consistency('${B}', 'habits', 0)`,
    ]) await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, () => db.query(`select public.get_habit_history('2026-10-01', '2026-10-02')`)))
      .rejects.toThrow(/permission denied/)
    const rows = await sql(db,
      `select proname, provolatile as v from pg_proc
        where proname in ('progress_card', 'get_habit_history') order by proname`)
    expect(rows).toEqual([{ proname: 'get_habit_history', v: 'v' }, { proname: 'progress_card', v: 's' }])
  })
})
