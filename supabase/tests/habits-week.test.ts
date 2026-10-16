import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { addHabit, archiveHabit, checkHabit, closeHabitsAs, enableHabits, targetOf } from './helpers/habits'

let db: PGlite
let h: string   // A's only habit: N = 3, created on Monday 28/09
const C = '00000000-0000-0000-0000-00000000000c'
const D = '00000000-0000-0000-0000-00000000000d'
const BASE = '2026-09-28'                         // Monday the pillar is turned on

const HABIT_CODES = [
  'habits_first_check', 'habits_checks_50', 'habits_checks_200', 'habits_checks_500', 'habits_checks_1000',
  'habits_week_target_1', 'habits_streak_4', 'habits_streak_12', 'habits_streak_26', 'habits_iron_8',
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => iso(new Date(Date.parse(day + 'T12:00:00Z') + n * 86_400_000))
// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')
// The day week `w` (counted from BASE) is judged: its Monday + 8, a Tuesday.
const judged = (w: number) => addDays(BASE, 7 * w + 8)

// A check straight into the table as the owner, so any day can be filled.
const check = (uid: string, habitId: string, day: string) => checkHabit(db, uid, habitId, day, { asOwner: true })

// Monday to Wednesday of each week from `monday`, for `weeks` weeks: N = 3 met.
const hitWeeks = async (uid: string, habitId: string, monday: string, weeks: number) => {
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 3; d++) await check(uid, habitId, addDays(monday, 7 * w + d))
}

const streak = async (uid = A) => {
  const [r] = await sql(db,
    `select current, best, shields, to_char(last_period, 'YYYY-MM-DD') as last
       from public.streaks where user_id = $1 and kind = 'habits_week'`, [uid])
  return r ?? { current: 0, best: 0, shields: 0, last: null }
}

const codes = async (uid = A) =>
  (await sql<{ code: string }>(db,
    `select code from public.user_achievements where user_id = $1 and code = any($2) order by code`,
    [uid, HABIT_CODES])).map(r => r.code)

const stats = async (uid = A) => (await sql(db, 'select public.achievement_stats($1) as s', [uid]))[0].s

// Turns the pillar off on `off` and back on on `on` (the days in between are outside a period).
const pause = async (uid: string, off: string, on: string) => {
  await at(off)
  await enableHabits(db, uid, false)
  await at(on)
  await enableHabits(db, uid)
}

// A person with the pillar on since `day` and one habit of N = 3 created that day.
const person = async (uid: string, day = BASE) => {
  await at(day)
  await makeUser(db, uid)
  await enableHabits(db, uid)
  return addHabit(db, uid, { perWeek: 3 })
}

beforeEach(async () => {
  db = await freshDb()
  h = await person(A)
})

describe('habits weekly streak', () => {
  it('judges a week only once its seven days closed', async () => {
    await hitWeeks(A, h, '2026-10-05', 1)
    await at('2026-10-12')                       // Monday: Saturday 10/10 is the last closed day
    await closeHabitsAs(db, A)
    // Only the week of 28/09 is judged, missed.
    expect(await streak()).toEqual({ current: 0, best: 0, shields: 0, last: '2026-09-28' })
    await at('2026-10-13')                       // Tuesday: Sunday 11/10 closes
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
  })

  it('builds the streak and gives a shield every 4 weeks, at most 2', async () => {
    await hitWeeks(A, h, BASE, 12)
    await at(judged(2))                          // three weeks judged
    await closeHabitsAs(db, A)
    expect(await streak()).toMatchObject({ current: 3, best: 3, shields: 0 })
    await at(judged(3))                          // four weeks judged
    await closeHabitsAs(db, A)
    expect(await streak()).toMatchObject({ current: 4, best: 4, shields: 1 })
    expect(await codes()).toContain('habits_streak_4')
    await at(judged(7))                          // eight weeks judged
    await closeHabitsAs(db, A)
    expect(await streak()).toMatchObject({ current: 8, best: 8, shields: 2 })
    await at(judged(11))                         // twelve weeks judged: still two shields
    await closeHabitsAs(db, A)
    expect(await streak()).toMatchObject({ current: 12, best: 12, shields: 2 })
    expect(await codes()).toContain('habits_streak_12')
    expect(await stats()).toMatchObject({ habits_best_streak: 12, habits_week_targets: 12, habits_checks: 36 })
  })

  it('spends a shield on a missed week', async () => {
    await hitWeeks(A, h, BASE, 4)                // 28/09 to 25/10: four weeks, one shield
    await at(judged(3))
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-10-19' })
    await check(A, h, '2026-10-26')              // week of 26/10: one check of three, missed
    await at(judged(4))
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 0, last: '2026-10-26' })
    await at(judged(5))                          // week of 02/11 missed: the streak breaks
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 0, best: 4, shields: 0, last: '2026-11-02' })
  })

  it('makes a week with a day off neutral', async () => {
    await hitWeeks(A, h, BASE, 4)                          // four weeks, one shield
    await pause(A, '2026-10-28', '2026-10-29')             // Wednesday 28/10 is outside a period
    for (const day of ['2026-10-26', '2026-10-27', '2026-10-29']) await check(A, h, day)
    await pause(A, '2026-11-04', '2026-11-05')             // Wednesday 04/11 too, and no goal that week
    await at('2026-11-09')
    await closeHabitsAs(db, A)
    // Goal met in a week with a day off: it counts.
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 1, last: '2026-10-26' })
    await at('2026-11-10')                                 // week of 02/11: neutral and missed
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 1, last: '2026-11-02' })
    await at('2026-11-17')                                 // week of 09/11 is a full week, missed
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 0, last: '2026-11-09' })
  })

  it('treats the activation week as neutral', async () => {
    // Turned on on a Thursday: Monday to Wednesday are outside a period, and the goal met counts.
    const mine = await person(B, '2026-10-01')
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-03']) await check(B, mine, day)
    await at('2026-10-06')
    await closeHabitsAs(db, B)
    expect(await streak(B)).toEqual({ current: 1, best: 1, shields: 0, last: '2026-09-28' })

    // A, with a shield, turns the pillar off for weeks and back on on a Thursday without meeting
    // the goal: the weeks off and the week it comes back keep the streak and the shield.
    await hitWeeks(A, h, BASE, 4)
    await at('2026-10-26')
    await enableHabits(db, A, false)                       // off from Sunday 25/10
    await at('2026-11-12')
    await enableHabits(db, A)                              // back on Thursday 12/11
    await check(A, h, '2026-11-12')
    await at('2026-11-17')
    await closeHabitsAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-11-09' })
  })

  it('makes an in-period week with Q = 0 neutral', async () => {
    await hitWeeks(A, h, BASE, 4)                          // four weeks, one shield
    await at('2026-10-25')                                 // Sunday: the only habit is archived
    await closeHabitsAs(db, A)                             // the daily close froze the weeks so far
    await archiveHabit(db, A, h)
    await at('2026-11-10')
    await closeHabitsAs(db, A)
    const [{ q }] = await sql(db, `select public.habit_week_q($1, '2026-11-02') as q`, [A])
    expect(q).toBe(0)
    // 19/10 still met (archived with its three checks); 26/10 and 02/11 in period, Q = 0: neutral.
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-11-02' })
  })

  it('freezes a week once: a habit reactivated the next Monday keeps Q = 0', async () => {
    await hitWeeks(A, h, BASE, 4)                          // four weeks, one shield
    await at('2026-10-25')
    await closeHabitsAs(db, A)                             // the daily close froze the weeks so far
    await archiveHabit(db, A, h)                           // Sunday: archived with its three checks
    await at('2026-10-28')
    await closeHabitsAs(db, A)                             // the daily close: Monday 26/10 closes
    await at('2026-11-02')
    await archiveHabit(db, A, h, false)                    // reactivated on the next Monday
    await at('2026-11-03')                                 // Tuesday: Saturday and Sunday close
    await closeHabitsAs(db, A)
    expect(await targetOf(db, h, '2026-10-26')).toBeNull()
    const [{ q }] = await sql(db, `select public.habit_week_q($1, '2026-10-26') as q`, [A])
    expect(q).toBe(0)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-10-26' })
  })

  it('keeps the week bonus when another habit is reactivated the next Monday', async () => {
    const other = await addHabit(db, A, { perWeek: 2, sort: 1 })   // Monday 28/09
    await at('2026-10-01')
    await archiveHabit(db, A, other)                               // archived the week before
    await at('2026-10-07')
    await closeHabitsAs(db, A)                                     // Monday 05/10 closes: Q = 3
    for (const day of ['2026-10-09', '2026-10-10', '2026-10-11']) await check(A, h, day)
    await at('2026-10-12')
    await archiveHabit(db, A, other, false)                        // reactivated on the next Monday
    await at('2026-10-13')                                         // Tuesday: C reaches Q on Sunday
    await closeHabitsAs(db, A)
    expect(await targetOf(db, other, '2026-10-05')).toBeNull()
    const bonus = await sql(db,
      `select amount from public.xp_ledger where user_id = $1 and reason = 'habit_week_target'
          and week_start = '2026-10-05'`, [A])
    expect(bonus).toEqual([{ amount: Math.round(150 * 3 / 7) }])
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
  })
})

describe('habit badges', () => {
  it('unlocks private habit badges', async () => {
    await check(A, h, '2026-09-28')
    await at('2026-09-30')
    await closeHabitsAs(db, A)
    expect(await codes()).toEqual(['habits_first_check'])
    const [x] = await sql(db,
      `select amount from public.xp_ledger where user_id = $1 and reason = 'achievement:habits_first_check'`, [A])
    expect(x.amount).toBe(50)

    // Tuesday and Wednesday meet N = 3; Thursday is beyond the target and does not count.
    for (const day of ['2026-09-29', '2026-09-30', '2026-10-01']) await check(A, h, day)
    await at('2026-10-03')
    await closeHabitsAs(db, A)
    expect(await codes()).toEqual(['habits_first_check', 'habits_week_target_1'])
    expect(await stats()).toMatchObject({
      habits_checks: 3, habits_week_targets: 1, habits_best_streak: 0, habits_iron_best_run: 0,
    })

    const catalog = await sql<{ code: string; private: boolean; sort: number }>(db,
      'select code, private, sort from public.achievement_catalog where sort >= 500 order by sort')
    expect(catalog.map(r => r.code)).toEqual(HABIT_CODES)
    expect(catalog.map(r => r.sort)).toEqual([500, 510, 520, 530, 540, 550, 560, 570, 580, 590])
    expect(catalog.every(r => r.private)).toBe(true)
  })

  it('counts the iron run per habit and breaks it on archive', async () => {
    // A: eight weeks in a row meeting the habit's own target.
    await hitWeeks(A, h, BASE, 8)
    await at(judged(6))
    await closeHabitsAs(db, A)
    expect((await stats()).habits_iron_best_run).toBe(7)
    expect(await codes()).not.toContain('habits_iron_8')
    await at(judged(7))
    await closeHabitsAs(db, A)
    expect((await stats()).habits_iron_best_run).toBe(8)
    expect(await codes()).toContain('habits_iron_8')

    // B: seven weeks, archived through the eighth (no target that week), back and met in the ninth.
    // Each step closes first, as the daily cron would have.
    const mine = await person(B)
    await hitWeeks(B, mine, BASE, 7)
    await at('2026-11-15')                                 // Sunday: archived after week 7
    await closeHabitsAs(db, B)
    await archiveHabit(db, B, mine)
    await at('2026-11-24')                                 // Tuesday of week 9: back
    await closeHabitsAs(db, B)
    await archiveHabit(db, B, mine, false)
    for (const day of ['2026-11-24', '2026-11-25', '2026-11-26']) await check(B, mine, day)
    await at(judged(8))
    await closeHabitsAs(db, B)
    expect(await targetOf(db, mine, '2026-11-16')).toBeNull()
    expect(await targetOf(db, mine, '2026-11-23')).toBe(3)
    expect((await stats(B)).habits_iron_best_run).toBe(7)
    expect(await codes(B)).not.toContain('habits_iron_8')

    // D: archived on a Monday before any check, so that week's target drops to 0, which breaks
    // the run too.
    const d = await person(D)
    await hitWeeks(D, d, BASE, 3)
    await at('2026-10-19')                                 // Monday of week 4
    await closeHabitsAs(db, D)
    await archiveHabit(db, D, d)
    await at('2026-10-27')                                 // Tuesday of week 5: back
    await closeHabitsAs(db, D)
    await archiveHabit(db, D, d, false)
    for (const day of ['2026-10-27', '2026-10-28', '2026-10-29']) await check(D, d, day)
    await at(judged(4))
    await closeHabitsAs(db, D)
    expect(await targetOf(db, d, '2026-10-19')).toBe(0)
    expect((await stats(D)).habits_iron_best_run).toBe(3)

    // C: two habits taking turns, each met every other week. Their weeks do not add up.
    const x = await person(C)
    const y = await addHabit(db, C, { perWeek: 3, sort: 1 })
    for (let w = 0; w < 4; w++) await hitWeeks(C, w % 2 ? y : x, addDays(BASE, 7 * w), 1)
    await at(judged(3))
    await closeHabitsAs(db, C)
    expect((await stats(C)).habits_iron_best_run).toBe(1)
  })
})

describe('close_all_habit_days', () => {
  it('closes everyone due in the safety net', async () => {
    const mine = await person(B)
    await makeUser(db, C)                                  // never turned the pillar on
    for (const day of ['2026-09-28', '2026-09-29', '2026-09-30']) {
      await check(A, h, day)
      await check(B, mine, day)
    }
    await at('2026-10-01')
    await enableHabits(db, B, false)                       // B's period ends on 30/09
    const all = async () => (await sql<{ n: number }>(db, 'select public.close_all_habit_days() as n'))[0].n
    const days = async (uid: string) =>
      (await sql<{ n: number }>(db, 'select count(*)::int as n from public.habit_days where user_id = $1', [uid]))[0].n

    expect(await all()).toBe(2)                            // 28 and 29/09 for both
    expect(await days(A)).toBe(2)
    expect(await days(B)).toBe(2)
    expect(await all()).toBe(0)
    await at('2026-10-03')
    expect(await all()).toBe(2)                            // A up to 01/10, B its last day 30/09
    expect(await days(B)).toBe(3)
    expect(await all()).toBe(0)
    await at('2026-10-06')
    // Only A has days pending; B is still visited so its last week gets judged.
    expect(await all()).toBe(1)
    expect(await days(A)).toBe(7)
    expect(await days(B)).toBe(3)
    expect(await streak(A)).toMatchObject({ current: 1, last: '2026-09-28' })
    expect(await streak(B)).toMatchObject({ current: 1, last: '2026-09-28' })
    expect(await all()).toBe(0)
    expect(await days(C)).toBe(0)

    await expect(asUser(db, A, () => db.query('select public.close_habit_weeks($1)', [A])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_all_habit_days()')))
      .rejects.toThrow(/permission denied/)
  })
})
