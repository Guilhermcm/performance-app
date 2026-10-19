import { describe, expect, it } from 'vitest'
import { doneSessions, milestones, volumeSeries, weekSummary } from './progress'
import type { RunLog } from './run-log'
import type { RunDetail } from './run-detail'
import type { RunPlan, Session, SessionType, Week } from './types'

// Weeks start on Monday. 2026-10-19 is a Monday; week 1 runs 19 to 25 Oct, week 2 26 Oct to 1 Nov.
const W1 = '2026-10-19', W2 = '2026-10-26', W3 = '2026-11-02'
const MON = 1, WED = 3, SAT = 6, SUN = 0
const day = (first: string, k: number) => new Date(Date.parse(first + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10)

const session = (week: number, k: number, type: SessionType, weekday: number, min: number): Session =>
  ({ id: `w${week}-s${k}`, type, day: weekday, blocks: [{ zone: type === 'easy' || type === 'long' ? 'easy' : 'hard', min }] })
// Three sessions a week: an easy run on Monday, a tempo on Wednesday and a long run on Sunday.
const weekOf = (index: number, phase: Week['phase'] = 'base'): Week => ({
  index, phase, recovery: false,
  sessions: [session(index, 1, 'easy', MON, 30), session(index, 2, 'tempo', WED, 40), session(index, 3, 'long', SUN, 60)]
})

const planOf = (over: Partial<RunPlan> = {}): RunPlan => ({
  version: 1, goal: '10k', goalType: 'finish', startDate: W1, weekStart: 1,
  answers: { goal: '10k', reference: { kind: 'none' }, days: 3, longDay: SUN },
  vdotSource: null, weeks: [weekOf(1), weekOf(2), weekOf(3)], dismissed: {}, ...over
})
const maintainOf = (): RunPlan => planOf({
  goal: 'maintain', answers: { goal: 'maintain', reference: { kind: 'none' }, days: 3, longDay: SUN },
  weeks: [weekOf(1, 'maintain'), weekOf(2, 'maintain')]
})

let n = 0
const log = (d: string, run: RunDetail | null = null, duration_min: number | null = 30): RunLog =>
  ({ id: `c${++n}`, day: d, duration_min, run })
const linked = (week: number, k: number, type: SessionType, extra: Partial<RunDetail> = {}): RunDetail =>
  ({ planned: { week, session: `w${week}-s${k}`, type, blocks: [{ zone: 'easy', min: 30 }] }, status: 'as_planned', ...extra })
const unplanned = (extra: Partial<RunDetail> = {}): RunDetail => ({ status: 'unplanned', ...extra })

describe('doneSessions', () => {
  it('counts a linked check-in by its session, whatever day it fell on in the week', () => {
    // The tempo of Wednesday, run on Friday and linked to it.
    const logs = [log(day(W1, 4), linked(1, 2, 'tempo'))]
    expect([...doneSessions(planOf(), 0, logs, 1)]).toEqual(['w1-s2'])
  })

  it('without a link, counts by the day', () => {
    expect([...doneSessions(planOf(), 0, [log(day(W1, 2))], 1)]).toEqual(['w1-s2'])
    expect([...doneSessions(planOf(), 0, [log(day(W1, 2), unplanned({ distance_km: 5 }))], 1)]).toEqual(['w1-s2'])
    // A day without a session counts nothing.
    expect(doneSessions(planOf(), 0, [log(day(W1, 1))], 1).size).toBe(0)
  })

  it('two check-ins on the same day for one workout count it once', () => {
    const plan = planOf()
    expect(doneSessions(plan, 0, [log(W1), log(W1)], 1)).toEqual(new Set(['w1-s1']))
    expect(doneSessions(plan, 0, [log(W1, linked(1, 1, 'easy')), log(W1, linked(1, 1, 'easy'))], 1)).toEqual(new Set(['w1-s1']))
    // A linked one and an unlinked one on that day: the linked one takes it, the other finds nothing left.
    expect(doneSessions(plan, 0, [log(W1), log(W1, linked(1, 1, 'easy'))], 1)).toEqual(new Set(['w1-s1']))
  })

  it('a linked check-in leaves the day for no other session, and each check-in matches one workout at most', () => {
    // Linked to the long run but run on Wednesday: it is the long run, not the tempo.
    expect(doneSessions(planOf(), 0, [log(day(W1, 2), linked(1, 3, 'long'))], 1)).toEqual(new Set(['w1-s3']))
  })

  it('a check-in of another calendar week does not count', () => {
    const plan = planOf()
    // Linked to week 1 but logged in week 2: it counts in neither.
    expect(doneSessions(plan, 0, [log(W2, linked(1, 1, 'easy'))], 1).size).toBe(0)
    expect(doneSessions(plan, 1, [log(W2, linked(1, 1, 'easy'))], 1).size).toBe(0)
    // Week 1's Monday run does not count in week 2.
    expect(doneSessions(plan, 1, [log(W1)], 1).size).toBe(0)
    expect(doneSessions(plan, 1, [log(W2)], 1)).toEqual(new Set(['w2-s1']))
  })

  it('a maintain plan in its second cycle matches by the date', () => {
    const plan = maintainOf()
    // Offset 2 (two weeks after the start) is week 1 again: the same ids as offset 0.
    const third = day(W1, 14)
    expect(doneSessions(plan, 2, [log(third, linked(1, 1, 'easy')), log(day(third, 2))], 1)).toEqual(new Set(['w1-s1', 'w1-s2']))
    // The same check-ins do not count in the first cycle's week 1.
    expect(doneSessions(plan, 0, [log(third, linked(1, 1, 'easy')), log(day(third, 2))], 1).size).toBe(0)
  })

  it('is empty outside the plan', () => {
    const plan = planOf()
    expect(doneSessions(plan, -1, [log(W1)], 1).size).toBe(0)
    expect(doneSessions(plan, 3, [log(day(W1, 21))], 1).size).toBe(0)
    expect(doneSessions(null, 0, [log(W1)], 1).size).toBe(0)
  })
})

describe('weekSummary', () => {
  it('sums the minutes and km of the check-ins of the week only', () => {
    const logs = [
      log(W1, linked(1, 1, 'easy', { distance_km: 5.1 }), 32),
      log(day(W1, 2), unplanned({ distance_km: 0.2 }), 10),
      log(day(W1, 4), null, null),
      log(day(W1, 5), unplanned({ distance_km: 0.1 }), 8),
      log(W2, unplanned({ distance_km: 10 }), 60)
    ]
    expect(weekSummary(planOf(), 0, logs, 1)).toEqual({ done: 2, planned: 3, minutes: 50, km: 5.4 })
    expect(weekSummary(planOf(), 1, logs, 1)).toEqual({ done: 1, planned: 3, minutes: 60, km: 10 })
  })

  it('is all zeros for a plan without check-ins', () => {
    expect(weekSummary(planOf(), 0, [], 1)).toEqual({ done: 0, planned: 3, minutes: 0, km: 0 })
    expect(weekSummary(maintainOf(), 5, [], 1)).toEqual({ done: 0, planned: 3, minutes: 0, km: 0 })
    expect(weekSummary(planOf(), 7, [], 1)).toEqual({ done: 0, planned: 0, minutes: 0, km: 0 })
    expect(weekSummary(null, 0, [], 1)).toEqual({ done: 0, planned: 0, minutes: 0, km: 0 })
  })
})

describe('volumeSeries', () => {
  it('has a point per week up to the current one, with the planned minutes and the minutes run', () => {
    const logs = [log(W1, null, 35), log(day(W1, 6), null, 50), log(W2, null, 20), log(W3, null, 99)]
    expect(volumeSeries(planOf(), logs, 1, day(W2, 3))).toEqual([
      { index: 1, planned: 130, done: 85 },
      { index: 2, planned: 130, done: 20 }
    ])
  })

  it('a plan without check-ins gives done 0 every week, and nothing before the start', () => {
    expect(volumeSeries(planOf(), [], 1, W1)).toEqual([{ index: 1, planned: 130, done: 0 }])
    expect(volumeSeries(planOf(), [], 1, day(W1, -1))).toEqual([])
    expect(volumeSeries(null, [], 1, W1)).toEqual([])
  })

  it('stops at the last week once the plan is over, and a maintain plan keeps counting calendar weeks', () => {
    expect(volumeSeries(planOf(), [], 1, day(W1, 40)).map(p => p.index)).toEqual([1, 2, 3])
    expect(volumeSeries(maintainOf(), [], 1, day(W1, 22)).map(p => p.index)).toEqual([1, 2, 3, 4])
  })

  it('starts on the week holding a mid-week start', () => {
    // Started on Thursday: only the long run is left in week 1.
    const plan = planOf({ startDate: day(W1, 3), weeks: [{ ...weekOf(1), sessions: [session(1, 3, 'long', SUN, 60)] }, weekOf(2)] })
    expect(volumeSeries(plan, [log(day(W1, 6), null, 61)], 1, day(W1, 7))).toEqual([
      { index: 1, planned: 60, done: 61 },
      { index: 2, planned: 130, done: 0 }
    ])
    expect(doneSessions(plan, 0, [log(day(W1, 6))], 1)).toEqual(new Set(['w1-s3']))
  })
})

describe('milestones', () => {
  it('is all null without data', () => {
    expect(milestones(planOf(), [], 1, W2)).toEqual({ longestLong: null, maxKm: null, easyPace: null })
    expect(milestones(null, [log(W1, unplanned({ distance_km: 5 }))], 1, W2)).toEqual({ longestLong: null, maxKm: null, easyPace: null })
  })

  it('takes the longest Longão in minutes, the longest distance and the pace of the easy runs', () => {
    const logs = [
      log(day(W1, 6), linked(1, 3, 'long', { distance_km: 9 }), 62),
      log(day(W2, 6), linked(2, 3, 'long'), 75),
      log(day(W2, 2), linked(2, 2, 'tempo', { distance_km: 11.5 }), 50),
      // Easy runs: 5 km in 30 min and 6 km in 33 min, 63 min over 11 km, 344 s/km.
      log(W2, linked(2, 1, 'easy', { distance_km: 5 }), 30),
      log(W3, linked(3, 1, 'easy', { distance_km: 6 }), 33)
    ]
    expect(milestones(planOf(), logs, 1, day(W3, 1))).toEqual({ longestLong: 75, maxKm: 11.5, easyPace: 344 })
  })

  it('easyPace ignores easy runs without a distance or a duration, unlinked runs and runs older than 4 weeks', () => {
    const plan = planOf({ weeks: [weekOf(1), weekOf(2), weekOf(3), weekOf(4), weekOf(5), weekOf(6)] })
    const today = day(W1, 34)
    const logs = [
      log(day(today, -2), linked(5, 1, 'easy'), 30),
      log(day(today, -3), linked(5, 1, 'easy', { distance_km: 5 }), null),
      log(day(today, -1), unplanned({ distance_km: 5 }), 25),
      log(day(today, -28), linked(1, 1, 'easy', { distance_km: 5 }), 25)
    ]
    expect(milestones(plan, logs, 1, today).easyPace).toBeNull()
    const easy = log(day(today, -27), linked(2, 1, 'easy', { distance_km: 4 }), 26)
    expect(milestones(plan, [...logs, easy], 1, today).easyPace).toBe(390)
  })

  it('counts only check-ins from the plan start to today', () => {
    const logs = [log(day(W1, -1), unplanned({ distance_km: 20 })), log(day(W2, 1), unplanned({ distance_km: 7 }))]
    expect(milestones(planOf(), logs, 1, W2).maxKm).toBeNull()
    expect(milestones(planOf(), logs, 1, day(W2, 1)).maxKm).toBe(7)
  })
})

describe('a plan on a Sunday week start', () => {
  it('maps days with the plan week start, not the fallback', () => {
    const plan = planOf({ weekStart: 0, startDate: '2026-10-18' })
    // Week 1 is 18 to 24 Oct; Saturday the 24th is still in it.
    const sat = '2026-10-24'
    const p = { ...plan, weeks: [{ ...weekOf(1), sessions: [session(1, 1, 'easy', SAT, 30)] }] }
    expect(doneSessions(p, 0, [log(sat)], 1)).toEqual(new Set(['w1-s1']))
    expect(doneSessions(p, 0, [log('2026-10-25')], 1).size).toBe(0)
  })
})
