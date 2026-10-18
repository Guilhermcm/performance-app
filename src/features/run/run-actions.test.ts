import { describe, expect, it } from 'vitest'
import { applyRunPlan, currentWeek, endRunPlan, moveSession, refitFuture, sessionsOn, type RunState } from './run-actions'
import { fitWeek } from './fit'
import type { Answers, RunPlan } from './types'

const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6
// 2026-10-18 is a Sunday.
const MONDAY = '2026-10-19'
const THURSDAY = '2026-10-22'
const FRIDAY = '2026-10-23'

type Ex = { id: string; sets: number; bp: string }
const ex = (id: string, sets: number, bp: string): Ex => ({ id, sets, bp })
const LEG = { id: 'leg', name: 'Leg', ex: [ex('x-squat', 6, 'upper legs'), ex('x-curl', 4, 'upper legs')] }
const UPPER = { id: 'upper', name: 'Upper', ex: [ex('x-bench', 5, 'chest'), ex('x-row', 5, 'back')] }

const state = (weekStart: 0 | 1 = 1, week: Record<number, string[] | string> = { [MON]: ['leg'], [WED]: ['upper'] }): RunState => ({
  weekStart,
  week,
  routines: [LEG, UPPER],
  runPlan: null,
})

const tenK = (extra: Partial<Answers> = {}): Answers => ({
  goal: '10k',
  goalType: 'finish',
  weeks: 10,
  reference: { kind: 'continuous', minutes: 30 },
  days: 3,
  longDay: SUN,
  ...extra,
})

const dayOf = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay()
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

describe('applyRunPlan', () => {
  it('on a Monday, week 1 is the current week', () => {
    const S = state(1)
    const plan = applyRunPlan(S, tenK(), MONDAY)
    expect(S.runPlan).toBe(plan)
    expect(plan.version).toBe(1)
    expect(plan.startDate).toBe(MONDAY)
    expect(currentWeek(plan, MONDAY, 1)?.index).toBe(1)
    expect(plan.weeks).toHaveLength(10)
    for (const w of plan.weeks) for (const s of w.sessions) expect(Number.isInteger(s.day) && s.day >= 0 && s.day <= 6).toBe(true)
  })

  it('on a Thursday with three sessions and three days left in a Sunday week, week 1 starts today and nothing lands before it', () => {
    const S = state(0)
    const plan = applyRunPlan(S, tenK({ longDay: TUE }), THURSDAY)
    expect(plan.startDate).toBe(THURSDAY)
    expect(currentWeek(plan, THURSDAY, 0)?.index).toBe(1)
    const days = plan.weeks[0].sessions.map(s => s.day).sort()
    expect(days).toEqual([THU, FRI, SAT])
    // Earlier days of this week carry nothing; later weeks may use any day again.
    for (const iso of ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21']) expect(sessionsOn(plan, iso, 0)).toEqual([])
    expect(plan.weeks[1].sessions.some(s => s.day === TUE)).toBe(true)
  })

  it('on a Friday without enough days left, week 1 is the next week', () => {
    const S = state(0)
    const plan = applyRunPlan(S, tenK(), FRIDAY)
    expect(plan.startDate).toBe('2026-10-25') // the next Sunday
    expect(currentWeek(plan, FRIDAY, 0)).toBeNull()
    expect(sessionsOn(plan, FRIDAY, 0)).toEqual([])
    expect(sessionsOn(plan, '2026-10-24', 0)).toEqual([])
    expect(currentWeek(plan, '2026-10-25', 0)?.index).toBe(1)
    expect(plan.weeks[0].sessions.find(s => s.type === 'long')?.day).toBe(SUN)
  })

  it('leaves the strength week and routines as they were', () => {
    const S = state(1)
    const before = clone({ week: S.week, routines: S.routines })
    applyRunPlan(S, tenK(), MONDAY)
    expect({ week: S.week, routines: S.routines }).toEqual(before)
  })

  it('keeps the long run on the preferred day and quality runs off the day after leg', () => {
    const S = state(1)
    const plan = applyRunPlan(S, tenK({ longDay: SAT }), MONDAY)
    for (const w of plan.weeks) {
      expect(w.sessions.find(s => s.type === 'long')?.day).toBe(SAT)
      for (const s of w.sessions) if (s.type === 'tempo' || s.type === 'intervals') expect(s.day).not.toBe(TUE)
    }
  })

  it('reads a legacy single routine id on a day as that routine', () => {
    // The leg routine as a bare string still makes Monday a leg day: no quality run on Tuesday.
    const S = state(1, { [MON]: 'leg', [WED]: ['upper'] })
    const plan = applyRunPlan(S, tenK({ longDay: SUN, days: 4 }), MONDAY)
    for (const w of plan.weeks) for (const s of w.sessions) if (s.type === 'tempo' || s.type === 'intervals') expect(s.day).not.toBe(TUE)
  })

  it('stores the answers, the goal and the VDOT of a race reference', () => {
    const S = state(1)
    const answers = tenK({ goalType: 'time', targetMinutes: 55, reference: { kind: 'race', distanceM: 5000, minutes: 25, date: '2026-10-01' } })
    const plan = applyRunPlan(S, answers, MONDAY)
    expect(plan).toMatchObject({ goal: '10k', goalType: 'time', targetTime: 55, vdotSource: 'race', vdotDate: '2026-10-01', dismissed: {} })
    expect(plan.vdot).toBeCloseTo(38.3, 0)
    expect(plan.answers).toEqual(answers)
    expect(plan.answers).not.toBe(answers)
  })

  it('has no VDOT without a race reference', () => {
    const plan = applyRunPlan(state(1), tenK(), MONDAY)
    expect(plan.vdot).toBeUndefined()
    expect(plan.vdotSource).toBeNull()
    expect(plan.goalType).toBe('finish')
  })

  it('starts later when the race is further away than the plan can grow, so it still ends at the race', () => {
    // 5k: 8 weeks minimum, at most 16 with the extra base. The race is 30 weeks out.
    const raceDate = addDays(MONDAY, 30 * 7 - 1) // a Sunday
    const plan = applyRunPlan(state(1), { goal: '5k', goalType: 'finish', raceDate, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN }, MONDAY)
    expect(plan.weeks).toHaveLength(16)
    expect(plan.startDate > MONDAY).toBe(true)
    expect(dayOf(plan.startDate)).toBe(MON)
    expect(currentWeek(plan, MONDAY, 1)).toBeNull()
    // The last week is the race week.
    const last = plan.weeks[plan.weeks.length - 1]
    expect(currentWeek(plan, raceDate, 1)).toBe(last)
    expect(currentWeek(plan, addDays(raceDate, 1), 1)).toBeNull()
    expect(last.phase).toBe('taper')
  })

  it('starts later by the weeks left over when the deadline is a number of weeks', () => {
    const plan = applyRunPlan(state(1), { goal: '5k', goalType: 'finish', weeks: 20, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN }, MONDAY)
    expect(plan.weeks).toHaveLength(16)
    expect(plan.startDate).toBe(addDays(MONDAY, 4 * 7))
  })

  it('start and maintain begin by Decision 2 whatever the deadline', () => {
    const run = { reference: { kind: 'none' as const }, days: 2 as const, longDay: SUN }
    const start = applyRunPlan(state(1), { goal: 'start', raceDate: addDays(MONDAY, 40 * 7), ...run }, MONDAY)
    expect(start.startDate).toBe(MONDAY)
    const weeks = applyRunPlan(state(1), { goal: 'start', weeks: 30, ...run }, MONDAY)
    expect(weeks.startDate).toBe(MONDAY)
    const maintain = applyRunPlan(state(1), { goal: 'maintain', weeks: 30, ...run, reference: { kind: 'continuous', minutes: 30 } }, MONDAY)
    expect(maintain.startDate).toBe(MONDAY)
  })

  it('starts now when the deadline fits the plan', () => {
    const plan = applyRunPlan(state(1), tenK({ weeks: 14 }), MONDAY)
    expect(plan.weeks).toHaveLength(14)
    expect(plan.startDate).toBe(MONDAY)
  })
})

describe('moveSession', () => {
  it('changes only that session of that week', () => {
    const S = state(1)
    applyRunPlan(S, tenK(), MONDAY)
    const before = clone(S.runPlan!)
    const target = before.weeks[2].sessions[1]
    const to = (target.day + 3) % 7
    moveSession(S, 3, target.id, to)
    const after = S.runPlan!
    expect(after.weeks[2].sessions[1].day).toBe(to)
    after.weeks[2].sessions[1].day = target.day
    expect(after).toEqual(before)
  })

  it('ignores an unknown session, an unknown week or a day out of range', () => {
    const S = state(1)
    applyRunPlan(S, tenK(), MONDAY)
    const before = clone(S.runPlan!)
    moveSession(S, 3, 'nope', 2)
    moveSession(S, 99, 'w1-s1', 2)
    moveSession(S, 1, 'w1-s1', 7)
    moveSession(S, 1, 'w1-s1', 1.5)
    expect(S.runPlan).toEqual(before)
  })
})

describe('refitFuture', () => {
  it('refits the weeks after today with the current strength week and keeps the others', () => {
    const S = state(1, {})
    applyRunPlan(S, tenK({ days: 4, longDay: SUN }), MONDAY)
    const before = clone(S.runPlan!)
    // A leg day moves in the day before week 5's quality run; two weeks later the plan is refitted.
    const quality = before.weeks[4].sessions.find(s => s.type === 'tempo' || s.type === 'intervals')!
    S.week = { [(quality.day + 6) % 7]: ['leg'], [WED]: ['upper'] }
    const today = addDays(MONDAY, 2 * 7 + 2) // Wednesday of week 3
    // Move a week-1 session by hand: refitting must not undo it.
    moveSession(S, 1, 'w1-s1', SAT)
    refitFuture(S, today)
    const after = S.runPlan!
    expect(after.weeks[0].sessions.find(s => s.id === 'w1-s1')?.day).toBe(SAT)
    expect(after.weeks[1]).toEqual(before.weeks[1])
    expect(after.weeks[2]).toEqual(before.weeks[2])
    for (const w of after.weeks.slice(3)) {
      const { placement } = fitWeek(w.sessions, { week: S.week as Record<number, string[]>, routines: S.routines, longDay: SUN })
      for (const s of w.sessions) expect(s.day).toBe(placement[s.id])
    }
    expect(after.weeks[4].sessions.find(s => s.id === quality.id)!.day).not.toBe(quality.day)
    // Only the days moved: the sessions themselves are the same.
    const strip = (weeks: RunPlan['weeks']) => weeks.map(w => ({ ...w, sessions: w.sessions.map(({ day: _d, ...s }) => s) }))
    expect(strip(after.weeks)).toEqual(strip(before.weeks))
  })

  it('does nothing without a plan or with an unknown version', () => {
    const S = state(1)
    refitFuture(S, MONDAY)
    expect(S.runPlan).toBeNull()
    S.runPlan = { version: 99 } as unknown as RunPlan
    refitFuture(S, MONDAY)
    moveSession(S, 1, 'w1-s1', 2)
    expect(S.runPlan).toEqual({ version: 99 })
  })
})

describe('endRunPlan', () => {
  it('clears the plan and leaves the strength week alone', () => {
    const S = state(1)
    applyRunPlan(S, tenK(), MONDAY)
    const week = clone(S.week)
    endRunPlan(S)
    expect(S.runPlan).toBeNull()
    expect(S.week).toEqual(week)
  })
})

describe('currentWeek and sessionsOn', () => {
  it('returns null for an unknown version, a missing plan or a broken one', () => {
    expect(currentWeek({ version: 99 } as unknown as RunPlan, MONDAY, 1)).toBeNull()
    expect(sessionsOn({ version: 99 } as unknown as RunPlan, MONDAY, 1)).toEqual([])
    expect(currentWeek(null, MONDAY, 1)).toBeNull()
    expect(currentWeek({ version: 1, weeks: 'x' } as unknown as RunPlan, MONDAY, 1)).toBeNull()
  })

  it('finds the session of a date by the weekday and the week start', () => {
    const plan = applyRunPlan(state(1), tenK({ longDay: SUN }), MONDAY)
    // A Monday week: the Sunday after the first Monday is still week 1.
    const sunday = addDays(MONDAY, 6)
    expect(sessionsOn(plan, sunday, 1).map(s => s.id)).toEqual([plan.weeks[0].sessions.find(s => s.type === 'long')!.id])
    expect(currentWeek(plan, sunday, 1)?.index).toBe(1)
    expect(currentWeek(plan, addDays(MONDAY, 7), 1)?.index).toBe(2)
    // The same plan read with a Sunday week: that Sunday opens week 2.
    expect(currentWeek(plan, sunday, 0)?.index).toBe(2)
    expect(sessionsOn(plan, sunday, 0).map(s => s.id)).toEqual([plan.weeks[1].sessions.find(s => s.type === 'long')!.id])
    for (const w of plan.weeks) {
      const days = w.sessions.map(s => s.day)
      const iso = addDays(MONDAY, (w.index - 1) * 7 + ((days[0] - MON + 7) % 7))
      expect(sessionsOn(plan, iso, 1).map(s => s.id)).toContain(w.sessions[0].id)
    }
  })

  it('returns nothing after the last week', () => {
    const plan = applyRunPlan(state(1), tenK(), MONDAY)
    expect(currentWeek(plan, addDays(MONDAY, 10 * 7), 1)).toBeNull()
    expect(sessionsOn(plan, addDays(MONDAY, 10 * 7 + 6), 1)).toEqual([])
  })

  it('starts the maintain cycle again when it ends', () => {
    const plan = applyRunPlan(state(1), { goal: 'maintain', reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN }, MONDAY)
    expect(plan.weeks).toHaveLength(8)
    expect(currentWeek(plan, addDays(MONDAY, 8 * 7), 1)).toBe(plan.weeks[0])
    expect(currentWeek(plan, addDays(MONDAY, 11 * 7), 1)).toBe(plan.weeks[3])
  })
})
