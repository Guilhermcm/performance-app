import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { closeSleepAs, enableSleep, logNight, setSleepTarget } from './helpers/sleep'

let db: PGlite
const C = '00000000-0000-0000-0000-00000000000c'

const SLEEP_CODES = [
  'sleep_first_night', 'sleep_nights_10', 'sleep_nights_50', 'sleep_nights_100', 'sleep_nights_250',
  'sleep_week_target_1', 'sleep_streak_4', 'sleep_streak_12', 'sleep_streak_26', 'sleep_clock_7',
]
const NUTRITION_CODES = [
  'nutrition_first_day', 'nutrition_days_10', 'nutrition_days_50', 'nutrition_days_100', 'nutrition_days_250',
  'nutrition_week_target_1', 'nutrition_streak_4', 'nutrition_streak_12', 'nutrition_streak_26', 'protein_7',
]

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (day: string, n: number) => iso(new Date(Date.parse(day + 'T12:00:00Z') + n * 86_400_000))
// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')

// A night straight into the table as the owner, so any night can be filled. The defaults are on
// target for the 8 h, 23:00 target.
const night = (uid: string, day: string, bed = '23:00', wake = '07:00') =>
  logNight(db, uid, day, bed, wake, { asOwner: true })

// The first `nights` nights of each week from `monday` on target, for `weeks` weeks (T = 5).
const hitWeeks = async (uid: string, monday: string, weeks: number, nights = 5) => {
  for (let w = 0; w < weeks; w++) for (let d = 0; d < nights; d++) await night(uid, addDays(monday, 7 * w + d))
}

const streak = async (uid = A) => {
  const [r] = await sql(db,
    `select current, best, shields, to_char(last_period, 'YYYY-MM-DD') as last
       from public.streaks where user_id = $1 and kind = 'sleep_week'`, [uid])
  return r ?? { current: 0, best: 0, shields: 0, last: null }
}

const codes = async (uid = A) =>
  (await sql<{ code: string }>(db,
    `select code from public.user_achievements where user_id = $1 and code = any($2) order by code`,
    [uid, SLEEP_CODES])).map(r => r.code)

const stats = async (uid = A) => (await sql(db, 'select public.achievement_stats($1) as s', [uid]))[0].s

// Turns the pillar off on `off` and back on on `on` (the nights in between are outside a period).
const pause = async (uid: string, off: string, on: string) => {
  await at(off)
  await enableSleep(db, uid, false)
  await at(on)
  await enableSleep(db, uid)
}

beforeEach(async () => {
  db = await freshDb()
  await at('2026-10-05')                         // Monday
  await makeUser(db, A)                          // T = 5, the default
  await enableSleep(db, A)
  await setSleepTarget(db, A, '2026-10-05', 480, '23:00')
})

describe('sleep weekly streak', () => {
  it('judges a week only once its seven nights closed', async () => {
    await hitWeeks(A, '2026-10-05', 1)
    await at('2026-10-12')                       // Monday: Saturday 10/10 is the last closed night
    await closeSleepAs(db, A)
    expect(await streak()).toMatchObject({ current: 0, last: null })
    await at('2026-10-13')                       // Tuesday: Sunday 11/10 closes
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })
  })

  it('builds the streak and gives a shield every 4 weeks, at most 2', async () => {
    await hitWeeks(A, '2026-10-05', 12)
    await at(addDays('2026-10-05', 7 * 2 + 8))   // three weeks judged
    await closeSleepAs(db, A)
    expect(await streak()).toMatchObject({ current: 3, best: 3, shields: 0 })
    await at(addDays('2026-10-05', 7 * 3 + 8))   // four weeks judged
    await closeSleepAs(db, A)
    expect(await streak()).toMatchObject({ current: 4, best: 4, shields: 1 })
    expect(await codes()).toContain('sleep_streak_4')
    await at(addDays('2026-10-05', 7 * 7 + 8))   // eight weeks judged
    await closeSleepAs(db, A)
    expect(await streak()).toMatchObject({ current: 8, best: 8, shields: 2 })
    await at(addDays('2026-10-05', 7 * 11 + 8))  // twelve weeks judged: still two shields
    await closeSleepAs(db, A)
    expect(await streak()).toMatchObject({ current: 12, best: 12, shields: 2 })
    expect(await codes()).toContain('sleep_streak_12')
    expect(await stats()).toMatchObject({ sleep_best_streak: 12, sleep_week_targets: 12 })
  })

  it('spends a shield on a missed week', async () => {
    await hitWeeks(A, '2026-10-05', 4)                    // 05/10 to 01/11: four weeks, one shield
    await at(addDays('2026-10-05', 7 * 3 + 8))
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-10-26' })
    await at(addDays('2026-10-05', 7 * 4 + 8))           // week of 02/11 missed: the shield goes
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 0, last: '2026-11-02' })
    await at(addDays('2026-10-05', 7 * 5 + 8))           // week of 09/11 missed: the streak breaks
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 0, best: 4, shields: 0, last: '2026-11-09' })
  })

  it('makes a week with a night off neutral', async () => {
    await hitWeeks(A, '2026-10-05', 4)                    // four weeks, one shield
    await pause(A, '2026-11-04', '2026-11-05')            // Wednesday 04/11 is outside a period
    for (const day of ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07']) await night(A, day)
    await pause(A, '2026-11-11', '2026-11-12')            // Wednesday 11/11 too, and no goal that week
    await at('2026-11-16')
    await closeSleepAs(db, A)
    // Goal met in a week with a night off: it counts.
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 1, last: '2026-11-02' })
    await at('2026-11-17')                                // week of 09/11: neutral and missed
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 1, last: '2026-11-09' })
    await at('2026-11-24')                                // week of 16/11 is a full week, missed
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 0, last: '2026-11-16' })
  })

  it('treats the activation week as neutral', async () => {
    // Turned on on a Wednesday: Monday and Tuesday are outside a period, and the goal met counts.
    await makeUser(db, B)
    await at('2026-10-07')
    await enableSleep(db, B)
    await setSleepTarget(db, B, '2026-10-07')
    for (const day of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']) await night(B, day)
    await at('2026-10-13')
    await closeSleepAs(db, B)
    expect(await streak(B)).toEqual({ current: 1, best: 1, shields: 0, last: '2026-10-05' })

    // A, with a shield, turns the pillar off for weeks and back on mid-week without meeting the
    // goal: the weeks off and the week it comes back keep the streak and the shield.
    await hitWeeks(A, '2026-10-05', 4)
    await at('2026-11-02')
    await enableSleep(db, A, false)                       // off from Sunday 01/11
    await at('2026-11-18')
    await enableSleep(db, A)                              // back on Wednesday 18/11
    await at('2026-11-24')
    await closeSleepAs(db, A)
    expect(await streak()).toEqual({ current: 4, best: 4, shields: 1, last: '2026-11-16' })
  })
})

describe('sleep badges', () => {
  it('unlocks private sleep badges', async () => {
    await night(A, '2026-10-05', '23:00', '05:00')       // logged, too short to be on target
    await at('2026-10-07')
    await closeSleepAs(db, A)
    expect(await codes()).toEqual(['sleep_first_night'])

    for (let d = 1; d <= 10; d++) await night(A, addDays('2026-10-05', d))   // 06/10 to 15/10
    await at('2026-10-17')
    await closeSleepAs(db, A)
    expect(await codes()).toEqual(['sleep_clock_7', 'sleep_first_night', 'sleep_nights_10', 'sleep_week_target_1'])
    expect(await stats()).toMatchObject({
      sleep_logged_nights: 11, sleep_on_target_nights: 10, sleep_week_targets: 1,
      sleep_best_streak: 1, sleep_clock_best_run: 11,
    })
    const [x] = await sql(db,
      `select amount from public.xp_ledger where user_id = $1 and reason = 'achievement:sleep_nights_10'`, [A])
    expect(x.amount).toBe(100)

    const catalog = await sql<{ code: string; private: boolean }>(db,
      'select code, private from public.achievement_catalog order by sort')
    expect(catalog.filter(r => r.private).map(r => r.code)).toEqual([...NUTRITION_CODES, ...SLEEP_CODES])
    expect(catalog.filter(r => !r.private)).toHaveLength(22)
  })

  it('counts the clock run only on logged nights within 30 minutes', async () => {
    // A: seven nights in a row, 30 minutes either side of the target (inclusive).
    for (let d = 0; d < 7; d++) await night(A, addDays('2026-10-05', d), d % 2 ? '22:30' : '23:30', d % 2 ? '06:30' : '07:30')
    await at('2026-10-13')
    await closeSleepAs(db, A)
    expect((await stats()).sleep_clock_best_run).toBe(7)
    expect(await codes()).toContain('sleep_clock_7')

    // B: six nights, a night without a log, three more, one 31 minutes late and four more. Without
    // the break at 31 minutes the last run would be 8.
    await makeUser(db, B)
    await at('2026-10-05')
    await enableSleep(db, B)
    await setSleepTarget(db, B, '2026-10-05')
    for (let d = 0; d < 6; d++) await night(B, addDays('2026-10-05', d))       // 05 to 10/10
    for (let d = 7; d < 10; d++) await night(B, addDays('2026-10-05', d))      // 12 to 14/10
    await night(B, '2026-10-15', '23:31', '07:31')
    for (let d = 11; d < 15; d++) await night(B, addDays('2026-10-05', d))     // 16 to 19/10
    await at('2026-10-22')
    await closeSleepAs(db, B)
    const [n] = await sql(db,
      `select bed_diff_min, on_target from public.sleep_nights where user_id = $1 and night = '2026-10-15'`, [B])
    expect(n).toEqual({ bed_diff_min: 31, on_target: true })
    expect((await stats(B)).sleep_clock_best_run).toBe(6)
    expect(await codes(B)).not.toContain('sleep_clock_7')
  })
})

describe('close_all_sleep_nights', () => {
  it('closes everyone due in the safety net', async () => {
    await makeUser(db, B)
    await enableSleep(db, B)
    await setSleepTarget(db, B, '2026-10-05')
    await makeUser(db, C)                                  // never turned the pillar on
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      await night(A, day)
      await night(B, day)
    }
    await at('2026-10-08')
    await enableSleep(db, B, false)                        // B's period ends on 07/10
    const all = async () => (await sql<{ n: number }>(db, 'select public.close_all_sleep_nights() as n'))[0].n
    const nights = async (uid: string) =>
      (await sql<{ n: number }>(db, 'select count(*)::int as n from public.sleep_nights where user_id = $1', [uid]))[0].n

    expect(await all()).toBe(2)                            // 05 and 06/10 for both
    expect(await nights(A)).toBe(2)
    expect(await nights(B)).toBe(2)
    expect(await all()).toBe(0)
    await at('2026-10-10')
    expect(await all()).toBe(2)                            // A up to 08/10, B its last night 07/10
    expect(await nights(B)).toBe(3)
    expect(await all()).toBe(0)
    await at('2026-10-13')
    // Only A has nights pending; B is still visited so its last week gets judged.
    expect(await all()).toBe(1)
    expect(await nights(A)).toBe(7)
    expect(await nights(B)).toBe(3)
    expect(await streak(A)).toMatchObject({ current: 0, last: '2026-10-05' })
    expect(await streak(B)).toMatchObject({ current: 0, last: '2026-10-05' })
    expect(await all()).toBe(0)
    expect(await nights(C)).toBe(0)

    await expect(asUser(db, A, () => db.query('select public.close_sleep_weeks($1)', [A])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_all_sleep_nights()')))
      .rejects.toThrow(/permission denied/)
  })
})
