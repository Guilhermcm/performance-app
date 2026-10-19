import { describe, expect, it } from 'vitest'
import { dismissSuggestion, recordRaceResult, repeatPreviousWeek, updateVdot } from './run-adjust'
import { applyRunPlan, type RunState } from './run-actions'
import { doneSessions, weekSummary } from './progress'
import { nextSuggestion } from './suggestions'
import { vdotFrom } from './vdot'
import type { Answers, Phase, RunPlan, Week } from './types'

const SUN = 0, MON = 1, WED = 3
// Weeks start on Monday. 2026-10-19 is a Monday: plan week k starts 7(k-1) days later.
const W1 = '2026-10-19'
const day = (first: string, k: number) => new Date(Date.parse(first + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10)
const weekFirst = (index: number) => day(W1, 7 * (index - 1))
const dayOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay()
// The position of weekday `d` in a week starting on Monday.
const pos = (d: number) => (d + 6) % 7
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

type Ex = { id: string; sets: number; bp: string }
const ex = (id: string, sets: number, bp: string): Ex => ({ id, sets, bp })
const LEG = { id: 'leg', name: 'Leg', ex: [ex('x-squat', 6, 'upper legs'), ex('x-curl', 4, 'upper legs')] }
const UPPER = { id: 'upper', name: 'Upper', ex: [ex('x-bench', 5, 'chest'), ex('x-row', 5, 'back')] }
const state = (): RunState => ({ weekStart: 1, week: { [MON]: ['leg'], [WED]: ['upper'] }, routines: [LEG, UPPER], runPlan: null })

const tenK = (extra: Partial<Answers> = {}): Answers => ({
  goal: '10k', goalType: 'finish', reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN, ...extra
})
// 12 weeks to a race on Sunday 10 Jan 2027: base in weeks 1 to 6, then build, specific and taper.
const RACE = '2027-01-10'
const raceState = () => { const S = state(); applyRunPlan(S, tenK({ raceDate: RACE }), W1); return S }
// 10 weeks, no race date.
const weeksState = () => { const S = state(); applyRunPlan(S, tenK({ weeks: 10 }), W1); return S }

const plan = (S: RunState) => S.runPlan as RunPlan
const types = (w: Week) => w.sessions.map(s => s.type)
// A week with its index and ids taken off, to compare weeks that moved.
const bare = (w: Week) => ({ phase: w.phase, recovery: w.recovery, sessions: w.sessions.map(s => ({ type: s.type, blocks: s.blocks, day: s.day })) })
// Every id names the week, and no two are the same.
const idsOk = (w: Week) => w.sessions.every(s => new RegExp(`^w${w.index}-s[1-9][0-9]*$`).test(s.id)) &&
  new Set(w.sessions.map(s => s.id)).size === w.sessions.length
const strengthKept = (S: RunState) => {
  expect(S.week).toEqual({ [MON]: ['leg'], [WED]: ['upper'] })
  expect(S.routines).toEqual([LEG, UPPER])
}

describe('repeatPreviousWeek with a race date', () => {
  it('the previous week comes in at the current one, the first base week ahead goes, the race stays last', () => {
    const S = raceState()
    const before = clone(plan(S))
    const today = day(weekFirst(3), 2)
    repeatPreviousWeek(S, today)
    const after = plan(S)
    expect(after.weeks).toHaveLength(12)
    expect(after.weeks.slice(0, 2)).toEqual(before.weeks.slice(0, 2))
    // The new week 3 is week 2 again, refitted from today on.
    expect(after.weeks[2].index).toBe(3)
    expect(idsOk(after.weeks[2])).toBe(true)
    expect(types(after.weeks[2]).sort()).toEqual(types(before.weeks[1]).sort())
    expect(after.weeks[2].phase).toBe(before.weeks[1].phase)
    // Week 3 was the first base week ahead of it: it is the one taken out, the rest stay put.
    expect(after.weeks.slice(3)).toEqual(before.weeks.slice(3))
    expect(after.weeks[11]).toEqual(before.weeks[11])
    expect(after.goalType).toBe('finish')
    strengthKept(S)
  })

  it('a base week further ahead goes, and the weeks between move one week later with new ids', () => {
    const S = raceState()
    const phases: Phase[] = ['base', 'build', 'build', 'base', 'specific', 'taper']
    const p = plan(S)
    p.weeks = p.weeks.slice(0, 6).map((w, i) => ({ ...w, phase: phases[i] }))
    p.raceDate = day(weekFirst(6), 6)
    const before = clone(p)
    repeatPreviousWeek(S, day(weekFirst(2), 0))
    const after = plan(S)
    expect(after.weeks.map(w => w.index)).toEqual([1, 2, 3, 4, 5, 6])
    expect(after.weeks.every(idsOk)).toBe(true)
    expect(after.weeks[0]).toEqual(before.weeks[0])
    expect(types(after.weeks[1]).sort()).toEqual(types(before.weeks[0]).sort())
    // Old weeks 2 and 3 are now 3 and 4; old week 4 (base) is gone; 5 and 6 stay.
    expect(after.weeks.slice(2, 4).map(bare)).toEqual(before.weeks.slice(1, 3).map(bare))
    expect(after.weeks.slice(4)).toEqual(before.weeks.slice(4))
  })

  it('without a base week ahead, swaps the week in place and the goal becomes finishing', () => {
    const S = raceState()
    const p = plan(S)
    p.goalType = 'time'
    p.targetTime = 55
    const before = clone(p)
    // Week 8 (build) has no base week from it on.
    const today = day(weekFirst(8), 1)
    repeatPreviousWeek(S, today)
    const after = plan(S)
    expect(after.weeks).toHaveLength(12)
    expect(after.weeks.slice(0, 7)).toEqual(before.weeks.slice(0, 7))
    expect(after.weeks.slice(8)).toEqual(before.weeks.slice(8))
    expect(after.weeks[7].index).toBe(8)
    expect(idsOk(after.weeks[7])).toBe(true)
    expect(types(after.weeks[7]).sort()).toEqual(types(before.weeks[6]).sort())
    expect(after.goalType).toBe('finish')
    expect('targetTime' in after).toBe(false)
    strengthKept(S)
  })

  it('in the race week the new week keeps to the days before the race, from today on', () => {
    const S = raceState()
    const today = day(weekFirst(12), 3)
    repeatPreviousWeek(S, today)
    const last = plan(S).weeks[11]
    expect(last.index).toBe(12)
    expect(last.sessions.length).toBeGreaterThan(0)
    for (const s of last.sessions) {
      const iso = day(weekFirst(12), pos(s.day))
      expect(iso >= today && iso < RACE).toBe(true)
    }
    // The quality run stays; it never sits on the eve of the race.
    expect(last.sessions.some(s => s.type === 'tempo' || s.type === 'intervals')).toBe(true)
    expect(last.sessions.filter(s => s.type !== 'easy').every(s => day(weekFirst(12), pos(s.day)) !== day(RACE, -1))).toBe(true)
  })
})

describe('repeatPreviousWeek without a race date', () => {
  it('the plan grows a week; the weeks after get new indexes and ids, the ones before stay', () => {
    const S = weeksState()
    const before = clone(plan(S))
    repeatPreviousWeek(S, day(weekFirst(3), 2))
    const after = plan(S)
    expect(after.weeks).toHaveLength(11)
    expect(after.weeks.slice(0, 2)).toEqual(before.weeks.slice(0, 2))
    expect(types(after.weeks[2]).sort()).toEqual(types(before.weeks[1]).sort())
    expect(after.weeks.map(w => w.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(after.weeks.every(idsOk)).toBe(true)
    expect(after.weeks.slice(3).map(bare)).toEqual(before.weeks.slice(2).map(bare))
    strengthKept(S)
  })

  it('at 64 weeks, swaps without growing', () => {
    const S = weeksState()
    const p = plan(S)
    const template = p.weeks[0]
    p.weeks = Array.from({ length: 64 }, (_, i) => ({
      ...clone(template), index: i + 1,
      sessions: template.sessions.map((s, k) => ({ ...s, id: `w${i + 1}-s${k + 1}` }))
    }))
    const before = clone(p)
    repeatPreviousWeek(S, day(weekFirst(3), 2))
    const after = plan(S)
    expect(after.weeks).toHaveLength(64)
    expect(after.weeks.slice(0, 2)).toEqual(before.weeks.slice(0, 2))
    expect(after.weeks.slice(3)).toEqual(before.weeks.slice(3))
    expect(after.weeks[2].index).toBe(3)
    expect(idsOk(after.weeks[2])).toBe(true)
  })

  it('the new week only holds workouts from today on', () => {
    const S = weeksState()
    const today = day(weekFirst(3), 4)
    repeatPreviousWeek(S, today)
    const week = plan(S).weeks[2]
    expect(week.sessions).toHaveLength(3)
    for (const s of week.sessions) expect(pos(s.day)).toBeGreaterThanOrEqual(pos(dayOf(today)))
  })

  it('with fewer days left than workouts, the Longão goes first, then the easy runs; never two on a day', () => {
    // Week 6 has a Longão, an Intervalado and an easy run; on Sunday one day is left.
    const S = weeksState()
    expect(types(plan(S).weeks[5]).sort()).toEqual(['easy', 'intervals', 'long'])
    repeatPreviousWeek(S, day(weekFirst(7), 6))
    expect(plan(S).weeks[6].sessions.map(s => [s.type, s.day])).toEqual([['intervals', SUN]])
    // Two days left: the easy run joins it.
    const T = weeksState()
    repeatPreviousWeek(T, day(weekFirst(7), 5))
    const week = plan(T).weeks[6]
    expect(types(week).sort()).toEqual(['easy', 'intervals'])
    expect(new Set(week.sessions.map(s => s.day)).size).toBe(2)
  })
})

describe('repeatPreviousWeek: the rebuilt week takes new ids (R2 T6-I1)', () => {
  // Week 5's first workout, run on Monday and linked to it.
  const mondayRun = (S: RunState) => {
    const s1 = plan(S).weeks[4].sessions[0]
    return { id: 'c1', day: weekFirst(5), duration_min: 30, run: { planned: { week: 5, session: 'w5-s1', type: s1.type, blocks: s1.blocks }, status: 'as_planned' as const, distance_km: 5 } }
  }
  const maxK = (w: Week) => Math.max(...w.sessions.map(s => Number(s.id.split('-s')[1])))

  it('insert: a check-in linked earlier this week matches no new workout and counts once', () => {
    const S = weeksState()
    const replaced = clone(plan(S).weeks[4])
    const logs = [mondayRun(S)]
    repeatPreviousWeek(S, day(weekFirst(5), 2))
    const week = plan(S).weeks[4]
    expect(week.sessions.map(s => s.id)).toEqual(week.sessions.map((_, k) => `w5-s${maxK(replaced) + k + 1}`))
    expect(week.sessions.some(s => replaced.sessions.some(r => r.id === s.id))).toBe(false)
    expect(doneSessions(plan(S), 4, logs, 1).size).toBe(0)
    expect(weekSummary(plan(S), 4, logs, 1)).toMatchObject({ done: 0, minutes: 30, km: 5 })
    // The old week 5 is now week 6 with its own ids: the check-in is not counted there either.
    expect(doneSessions(plan(S), 5, logs, 1).size).toBe(0)
  })

  it('swap: the same holds', () => {
    const S = raceState()
    // Week 8 has no base week ahead: the repeat swaps it.
    const p = plan(S)
    const s1 = p.weeks[7].sessions[0]
    const logs = [{ id: 'c1', day: weekFirst(8), duration_min: 30, run: { planned: { week: 8, session: 'w8-s1', type: s1.type, blocks: s1.blocks }, status: 'as_planned' as const } }]
    repeatPreviousWeek(S, day(weekFirst(8), 2))
    const week = plan(S).weeks[7]
    expect(week.sessions.every(s => /^w8-s[1-9][0-9]*$/.test(s.id) && s.id !== 'w8-s1')).toBe(true)
    expect(doneSessions(plan(S), 7, logs, 1).size).toBe(0)
  })

  it('a second repeat of the same week keeps the ids unique', () => {
    const S = weeksState()
    repeatPreviousWeek(S, day(weekFirst(5), 2))
    const first = plan(S).weeks[4].sessions.map(s => s.id)
    plan(S).dismissed = {}
    repeatPreviousWeek(S, day(weekFirst(5), 3))
    const again = plan(S).weeks[4].sessions.map(s => s.id)
    expect(again.some(id => first.includes(id))).toBe(false)
    expect(again.every(id => id.length <= 16)).toBe(true)
  })
})

describe('repeatPreviousWeek: dismissed keys move with the weeks (R2 T6-M2)', () => {
  it('without a race date, the keys of the weeks ahead shift by one', () => {
    const S = weeksState()
    plan(S).dismissed = { 'weak:2': 'a', 'effort:5': 'b', 'weak:7': 'c', 'race:2027-01-10': 'd', 'faster:c9': 'e' }
    const today = day(weekFirst(3), 2)
    repeatPreviousWeek(S, today)
    expect(plan(S).dismissed).toEqual({ 'weak:2': 'a', 'effort:6': 'b', 'weak:8': 'c', 'race:2027-01-10': 'd', 'faster:c9': 'e', 'weak:3': today, 'effort:3': today })
  })

  it('with a race date, only the weeks that moved take their keys; the removed week\'s key goes', () => {
    const S = raceState()
    const phases: Phase[] = ['base', 'build', 'build', 'base', 'specific', 'taper']
    const p = plan(S)
    p.weeks = p.weeks.slice(0, 6).map((w, i) => ({ ...w, phase: phases[i] }))
    p.raceDate = day(weekFirst(6), 6)
    p.dismissed = { 'weak:3': 'a', 'weak:4': 'b', 'effort:5': 'c' }
    const today = day(weekFirst(2), 0)
    repeatPreviousWeek(S, today)
    // Old week 3 is week 4; old week 4 (base) is gone; week 5 stays.
    expect(plan(S).dismissed).toEqual({ 'weak:4': 'a', 'effort:5': 'c', 'weak:2': today, 'effort:2': today })
  })
})

describe('repeatPreviousWeek: when it does nothing', () => {
  it('in week 1, in a maintain plan or week, after the plan, without a plan', () => {
    const S = weeksState()
    const before = clone(S)
    repeatPreviousWeek(S, day(W1, 3))
    repeatPreviousWeek(S, day(weekFirst(11), 1))
    expect(S).toEqual(before)

    const M = state()
    applyRunPlan(M, { goal: 'maintain', reference: { kind: 'none' }, days: 3, longDay: SUN }, W1)
    const m = clone(M)
    repeatPreviousWeek(M, day(weekFirst(3), 1))
    expect(M).toEqual(m)

    const B = raceState()
    const p = plan(B)
    p.weeks[0].phase = 'maintain'
    p.weeks[1].phase = 'maintain'
    const b = clone(B)
    repeatPreviousWeek(B, day(weekFirst(2), 1))
    repeatPreviousWeek(B, day(weekFirst(3), 1))
    expect(B).toEqual(b)

    const N = state()
    repeatPreviousWeek(N, W1)
    expect(N.runPlan).toBeNull()
  })
})

describe('repeatPreviousWeek and the suggestions', () => {
  it('once applied, the weak week and high effort of this week are put away', () => {
    const S = weeksState()
    const today = day(weekFirst(3), 1)
    expect(nextSuggestion(plan(S), [], today, 1)).toMatchObject({ key: 'weak:3' })
    repeatPreviousWeek(S, today)
    expect(plan(S).dismissed).toEqual({ 'weak:3': today, 'effort:3': today })
    expect(nextSuggestion(plan(S), [], today, 1)).toBeNull()
    // Next week is judged again.
    expect(nextSuggestion(plan(S), [], day(weekFirst(4), 1), 1)).toMatchObject({ key: 'weak:4' })
  })
})

describe('recordRaceResult, updateVdot, dismissSuggestion', () => {
  it('the race result goes in with the VDOT of the race, dated race day', () => {
    const S = raceState()
    recordRaceResult(S, 52.5)
    const p = plan(S)
    expect(p.raceResult).toEqual({ minutes: 52.5 })
    expect(p.vdot).toBe(vdotFrom(10000, 52.5))
    expect(p.vdotSource).toBe('race')
    expect(p.vdotDate).toBe(RACE)
    expect(nextSuggestion(p, [], day(RACE, 1), 1)).toBeNull()
    strengthKept(S)
  })

  it('the half marathon uses its own distance', () => {
    const S = state()
    applyRunPlan(S, { ...tenK(), goal: 'half', raceDate: '2027-02-28' }, W1)
    recordRaceResult(S, 120)
    expect(plan(S).vdot).toBe(vdotFrom(21097.5, 120))
  })

  it('no result without a race, or with a time that is not one', () => {
    const S = weeksState()
    const before = clone(S)
    recordRaceResult(S, 50)
    expect(S).toEqual(before)
    const R = raceState()
    const r = clone(R)
    recordRaceResult(R, 0)
    recordRaceResult(R, Number.NaN)
    expect(R).toEqual(r)
  })

  it('updateVdot rounds to one decimal and records where it came from', () => {
    const S = weeksState()
    updateVdot(S, 45.678, 'run', '2026-10-20')
    expect(plan(S)).toMatchObject({ vdot: 45.7, vdotSource: 'run', vdotDate: '2026-10-20' })
    // A VDOT under the plan's usable floor, or not a number, changes nothing.
    updateVdot(S, 12, 'run', '2026-10-21')
    updateVdot(S, Number.POSITIVE_INFINITY, 'run', '2026-10-21')
    expect(plan(S)).toMatchObject({ vdot: 45.7, vdotDate: '2026-10-20' })
    strengthKept(S)
  })

  it('accepting a faster run puts its suggestion away', () => {
    const S = weeksState()
    const run = { id: 'c1', day: day(W1, 2), duration_min: 21, run: { status: 'unplanned' as const, distance_km: 5, rpe: 8 } }
    const s = nextSuggestion(plan(S), [run], day(W1, 3), 1)
    expect(s).toMatchObject({ kind: 'faster' })
    if (s?.kind === 'faster') updateVdot(S, s.vdot, 'run', s.day)
    expect(nextSuggestion(plan(S), [run], day(W1, 3), 1)).toBeNull()
  })

  it('dismissSuggestion records the key with today', () => {
    const S = weeksState()
    dismissSuggestion(S, 'weak:3', '2026-11-03')
    expect(plan(S).dismissed).toEqual({ 'weak:3': '2026-11-03' })
    const p = plan(S) as Partial<RunPlan>
    delete p.dismissed
    dismissSuggestion(S, 'race:2027-01-10', '2027-01-11')
    expect(plan(S).dismissed).toEqual({ 'race:2027-01-10': '2027-01-11' })
    const N = state()
    dismissSuggestion(N, 'weak:3', '2026-11-03')
    expect(N.runPlan).toBeNull()
  })
})
