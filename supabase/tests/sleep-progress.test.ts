import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql, withoutEventWindow } from './helpers/game'
import { befriend } from './helpers/social'
import { enableNutrition } from './helpers/nutrition'
import { enableSleep, logNight, setSleepTarget, closeSleepAs } from './helpers/sleep'

// The sleep pillar in the progress answers (spec 5.5, 6.4, 6.5, 9): the public card, the owner's
// block, the radar axis and the night history.
let db: PGlite

// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')

const progress = async (uid = A) =>
  (await asUser(db, uid, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p
const card = async (uid = A) => (await sql(db, 'select public.progress_card($1) as c', [uid]))[0].c
const nights = async (uid: string, from: string, to: string) =>
  (await asUser(db, uid, () =>
    db.query<{ h: any }>('select public.get_sleep_nights($1, $2) as h', [from, to]))).rows[0].h

// A night straight into the table as the owner, so any past night can be filled. The defaults are
// on target for the 8 h, 23:00 target.
const night = (uid: string, day: string, bed = '23:00', wake = '07:00', quality: number | null = null, note: string | null = null) =>
  logNight(db, uid, day, bed, wake, { asOwner: true, quality, note })

// A ledger row straight into the table (as the owner); a bonus without an event needs its own reason.
let n = 0
const xpRow = (uid: string, pillar: string | null, amount: number, week: string) =>
  sql(db,
    `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
     values ($1, $2, $3, $4, null, $5)`,
    [uid, pillar, amount, `test_${++n}`, week])

const period = (uid: string, from: string, to: string | null) =>
  sql(db, 'insert into public.sleep_periods (user_id, started_on, ended_on) values ($1, $2, $3)', [uid, from, to])

// Every key of a JSON value, at any depth.
const keys = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keys)
    : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)])
      : []

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await at('2026-10-05')                       // Monday
  await makeUser(db, A)                        // sleep T = 5, the default
  await makeUser(db, B)
})

describe('sleep in the public card', () => {
  it('raises the week max by active pillars', async () => {
    expect((await card()).week.max).toBe(960)
    await enableSleep(db, A)
    expect((await card()).week.max).toBe(1920)
    expect((await progress()).week.max).toBe(1920)
    await enableNutrition(db, A)
    expect((await card()).week.max).toBe(2880)
    // Off from Wednesday: the period still touched this week, not the next one.
    await at('2026-10-07')
    await enableSleep(db, A, false)
    expect((await card()).week.max).toBe(2880)
    await at('2026-10-12')
    expect((await card()).week.max).toBe(1920)
    // A period turned on and off the same day touches no week.
    await enableSleep(db, B)
    await enableSleep(db, B, false)
    expect((await card(B)).week.max).toBe(960)
  })

  it('splits the week XP with sleep', async () => {
    await xpRow(A, 'strength', 200, '2026-10-05')
    await xpRow(A, 'nutrition', 70, '2026-10-05')
    await xpRow(A, 'sleep', 130, '2026-10-05')
    await xpRow(A, null, 25, '2026-10-05')
    await xpRow(A, 'sleep', 960, '2026-09-28')                   // last week: not in this one
    const c = await card()
    expect(c.week.pillars).toEqual({ strength: 200, nutrition: 70, sleep: 130, habits: 0, bonus: 25 })
    expect(c.week.xp).toBe(425)
    expect((await card(B)).week.pillars).toEqual({ strength: 0, nutrition: 0, sleep: 0, habits: 0, bonus: 0 })
  })

  it('hides sleep from friends', async () => {
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-05')
    await night(A, '2026-10-05', '23:10', '07:05', 5, 'Sonho estranho')
    await at('2026-10-07')
    expect(await closeSleepAs(db, A)).toBe(1)
    await befriend(db, A, B)

    const friends = (await asUser(db, B, () => db.query<{ f: any }>('select public.get_friends() as f'))).rows[0].f
    const a = friends.find((f: { id: string }) => f.id === A).card
    for (const shown of [a, await card()]) {
      expect(shown.sleep).toBeUndefined()
      expect(shown.radar).toBeUndefined()
      expect(keys(shown).filter(k => /bed|wake|duration|quality|note/.test(k))).toEqual([])
      expect(JSON.stringify(shown)).not.toContain('sleep_first_night')
      expect(JSON.stringify(shown)).not.toContain('Sonho estranho')
      // Only the pillar's level and XP: 120 on target + 30 rested + 10 logged.
      expect(shown.pillars.sleep).toEqual({ level: 2, into: 60, need: 150, xp: 160 })
    }
    expect(JSON.stringify(friends)).not.toContain('sleep_first_night')

    const p = await progress()
    expect(p.achievements.map((x: { code: string }) => x.code)).toContain('sleep_first_night')
  })
})

describe('the owner sleep block', () => {
  it('reports the sleep block to the owner', async () => {
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-05')
    expect((await progress()).sleep).toEqual({
      target: 5, on_target: 0, logged: 0, streak: { current: 0, best: 0, shields: 0 },
      confirms_on: '2026-10-07', last_closed: null, last_week: null,
    })

    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) await night(A, d)
    // Wednesday: Monday closes, on target and logged (T = 5): 120 + 10.
    await at('2026-10-07')
    let p = await progress()
    expect(p.sleep).toEqual({
      target: 5, on_target: 1, logged: 1, streak: { current: 0, best: 0, shields: 0 },
      confirms_on: '2026-10-09',
      last_closed: { night: '2026-10-05', logged: true, on_target: true, rested: false, xp: 130 },
      last_week: null,
    })
    // Sunday: Friday closes, the fifth night on target: 120 + 150 (weekly goal) + 10.
    await at('2026-10-11')
    p = await progress()
    expect(p.sleep).toMatchObject({
      on_target: 5, logged: 5,
      last_closed: { night: '2026-10-09', logged: true, on_target: true, rested: false, xp: 280 },
      last_week: null,
    })
    // The same XP the night history reports for that night.
    expect((await nights(A, '2026-10-09', '2026-10-09')).nights[0].xp).toBe(280)
    // Monday: the week of 05/10 still has Sunday open; the new week has nothing closed.
    await at('2026-10-12')
    p = await progress()
    expect(p.sleep).toMatchObject({
      on_target: 0, logged: 0,
      last_closed: { night: '2026-10-10', logged: false, on_target: false, rested: false, xp: 0 },
      last_week: null,
    })
    // Tuesday: Sunday closes and the week is judged.
    await at('2026-10-13')
    p = await progress()
    expect(p.sleep).toMatchObject({
      last_closed: { night: '2026-10-11' }, last_week: { start: '2026-10-05', target_hit: true },
      streak: { current: 1, best: 1, shields: 0 },
    })
    // A week missed.
    await at('2026-10-20')
    expect((await progress()).sleep.last_week).toEqual({ start: '2026-10-12', target_hit: false })
  })

  it('leaves the sleep block out until the pillar was ever on', async () => {
    expect('sleep' in (await progress())).toBe(false)
    // On and off the same day: the pillar was on once, so the block stays.
    await enableSleep(db, A)
    await enableSleep(db, A, false)
    expect((await progress()).sleep).toMatchObject({ target: 5, last_closed: null, last_week: null })
  })

  it('freezes the sleep T and closes pending nights when the owner reads progress', async () => {
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-05')
    await night(A, '2026-10-05')
    const frozen = () => sql(db,
      `select target from public.weekly_targets where user_id = $1 and pillar = 'sleep' and week_start = '2026-10-05'`, [A])
    const closed = async () => (await sql<{ night: string }>(db,
      `select to_char(night, 'YYYY-MM-DD') as night from public.sleep_nights where user_id = $1 order by night`, [A]))
      .map(r => r.night)
    // Monday: turning the pillar on froze the week's T; reading progress keeps it, closing nothing.
    expect(await frozen()).toEqual([{ target: 5 }])
    await progress()
    expect(await frozen()).toEqual([{ target: 5 }])
    expect(await closed()).toEqual([])
    // Wednesday: Monday's night is pending until the owner reads progress.
    await at('2026-10-07')
    expect(await closed()).toEqual([])
    expect((await progress()).week.pillars.sleep).toBe(130)
    expect(await closed()).toEqual(['2026-10-05'])
  })

  it('computes the sleep radar over closed weeks', async () => {
    // Wednesday 04/11. Closed weeks: 26/10 back to 05/10 (current), 28/09 back to 07/09 (previous).
    await at('2026-11-04')
    // A: sleep on from Thursday 22/10 (two active weeks in the window, the first partly).
    await period(A, '2026-10-22', null)
    await xpRow(A, 'sleep', 960, '2026-10-19')
    await xpRow(A, 'sleep', 480, '2026-10-26')
    await xpRow(A, 'sleep', 900, '2026-11-02')                  // running week: not closed
    await xpRow(A, null, 500, '2026-10-26')                     // bonus never counts
    expect((await progress()).radar.sleep).toEqual({ current: 0.75, previous: null })

    // B: never on, then one week in the previous window only.
    expect((await progress(B)).radar.sleep).toEqual({ current: null, previous: null })
    await period(B, '2026-09-15', '2026-09-16')
    await period(B, '2026-10-13', '2026-10-12')                 // same-day toggle: covers nothing
    await xpRow(B, 'sleep', 480, '2026-09-14')
    expect((await progress(B)).radar.sleep).toEqual({ current: null, previous: 0.5 })

    // On Monday 09/11 the week of 02/11 is not in yet; on Tuesday, once Sunday closed, it is.
    const consistency = async () =>
      Number((await sql(db, `select public.pillar_consistency($1, 'sleep', 0) as v`, [A]))[0].v)
    await at('2026-11-09')
    expect(await consistency()).toBe(0.75)
    await at('2026-11-10')
    expect(await consistency()).toBe(0.8125)                    // (960 + 480 + 900) / (3 * 960)
  })
})

describe('sleep night history', () => {
  it('returns closed nights with their logs, weeks and periods', async () => {
    // A: on 01/10 to 02/10 (off on 03/10), back on 05/10. Nights 03/10 and 04/10 are outside.
    await at('2026-10-01')
    await enableSleep(db, A)
    await setSleepTarget(db, A, '2026-10-01')
    await at('2026-10-03')
    await enableSleep(db, A, false)
    await at('2026-10-05')
    await enableSleep(db, A)
    await night(A, '2026-10-01', '23:00', '07:00', 5, 'Café cedo')    // on target and rested
    await night(A, '2026-10-02', '01:00', '07:00')                    // late and short: logged only
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) await night(A, d)
    await enableSleep(db, B)
    await setSleepTarget(db, B, '2026-10-05')
    await night(B, '2026-10-05', '23:00', '07:00', 3, 'Noite do B')
    await at('2026-10-12')

    // Nothing closed yet: the call closes the pending nights first.
    const h = await nights(A, '2026-10-01', '2026-10-10')
    expect(h.nights.map((x: { night: string }) => x.night)).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ])
    const target = { goal_min: 480, bed_target: '23:00' }
    expect(h.nights[0]).toEqual({
      night: '2026-10-01', logged: true, on_target: true, rested: true, duration_min: 480, bed_diff_min: 0,
      quality: 5, target, xp: 160, bed_time: '23:00', wake_time: '07:00', note: 'Café cedo',
    })
    expect(h.nights[1]).toEqual({
      night: '2026-10-02', logged: true, on_target: false, rested: false, duration_min: 360, bed_diff_min: 120,
      quality: null, target, xp: 10, bed_time: '01:00', wake_time: '07:00', note: null,
    })
    // The fifth night on target of the week of 05/10 carries the +150.
    expect(h.nights.map((x: { xp: number }) => x.xp)).toEqual([160, 10, 130, 130, 130, 130, 280, 0])
    expect(h.nights[7]).toEqual({
      night: '2026-10-10', logged: false, on_target: false, rested: false, duration_min: null, bed_diff_min: null,
      quality: null, target, xp: 0, bed_time: null, wake_time: null, note: null,
    })
    expect(h.weeks).toEqual([
      { start: '2026-09-28', target_hit: false },
      { start: '2026-10-05', target_hit: true },
    ])
    expect(h.periods).toEqual([
      { started_on: '2026-10-01', ended_on: '2026-10-02' },
      { started_on: '2026-10-05', ended_on: null },
    ])
    // A period outside the range is left out.
    expect((await nights(A, '2026-10-06', '2026-10-07')).periods)
      .toEqual([{ started_on: '2026-10-05', ended_on: null }])

    // 62 days at most.
    expect((await nights(A, '2026-08-10', '2026-10-10')).nights).toHaveLength(8)
    await expect(nights(A, '2026-08-09', '2026-10-10')).rejects.toThrow(/invalid_range/)
    await expect(nights(A, '2026-10-10', '2026-10-01')).rejects.toThrow(/invalid_range/)

    expect(JSON.stringify(h)).not.toContain('Noite do B')

    // B only gets their own; a period turned on and off the same day covers no night.
    await period(B, '2026-10-02', '2026-10-01')
    const hb = await nights(B, '2026-10-01', '2026-10-10')
    expect(hb.nights.map((x: { night: string }) => x.night)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ])
    expect(hb.nights[0]).toMatchObject({ note: 'Noite do B', quality: 3, xp: 130 })
    expect(hb.periods).toEqual([{ started_on: '2026-10-05', ended_on: null }])
    expect(JSON.stringify(hb)).not.toContain('Café cedo')
  })

  it('keeps single progress functions closed to clients', async () => {
    for (const fn of ['progress_card', 'get_sleep_nights', 'sleep_week_active', 'pillar_consistency'])
      expect(await sql(db, `select count(*)::int as n from pg_proc where proname = $1`, [fn])).toEqual([{ n: 1 }])
    for (const q of [
      `select public.progress_card('${B}')`,
      `select public.my_progress_extras('${B}')`,
      `select public.sleep_week_active('${B}', '2026-10-05')`,
      `select public.pillar_consistency('${B}', 'sleep', 0)`,
    ]) await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, () => db.query(`select public.get_sleep_nights('2026-10-01', '2026-10-02')`)))
      .rejects.toThrow(/permission denied/)
    const [{ v }] = await sql(db,
      `select provolatile as v from pg_proc where proname = 'progress_card'`)
    expect(v).toBe('s')
  })
})
