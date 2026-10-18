import { describe, expect, it } from 'vitest'
import { applyRunPlan, calendarAnswers, currentWeek, endRunPlan, moveSession, raceStartOf, raceWeeksStart, refitFuture, sessionsOn, type RunState } from './run-actions'
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

  describe('a race date always ends the plan in the race week', () => {
    const raceDays: [string, number][] = [['Sunday', 12 * 7 - 1], ['Monday', 12 * 7], ['Wednesday', 12 * 7 + 2]]
    const starts: [string, string][] = [['Monday', MONDAY], ['Friday', FRIDAY]]
    for (const ws of [0, 1] as const) {
      for (const [startName, today] of starts) {
        for (const [raceName, offset] of raceDays) {
          for (const far of [0, 20]) {
            it(`race on a ${raceName}${far ? ' far away' : ''}, applied on a ${startName}, week starting on ${ws ? 'Monday' : 'Sunday'}`, () => {
              const raceDate = addDays(MONDAY, offset + far * 7)
              const plan = applyRunPlan(state(ws), tenK({ weeks: undefined, raceDate }), today)
              const last = plan.weeks[plan.weeks.length - 1]
              expect(currentWeek(plan, raceDate, ws)).toBe(last)
              expect(currentWeek(plan, plan.startDate, ws)).toBe(plan.weeks[0])
              expect(plan.weeks.map(w => w.phase).slice(-2)).toEqual(['taper', 'taper'])
              expect(plan.weeks.filter(w => w.phase === 'taper')).toHaveLength(2)
              expect(plan.weeks.length).toBeLessThanOrEqual(18)
              // Nothing is planned after the race week.
              expect(currentWeek(plan, addDays(raceDate, 7), ws)).toBeNull()
              if (!far) {
                // Within the cap, week 1 is the one Decision 2 picks.
                expect(currentWeek(plan, addDays(today, 7), ws)).not.toBeNull()
                const daysLeft = 7 - ((dayOf(today) - ws + 7) % 7)
                expect(plan.startDate).toBe(daysLeft >= 3 ? today : addDays(today, daysLeft))
              } else {
                expect(plan.weeks).toHaveLength(18)
              }
              expect(plan.raceDate).toBe(raceDate)
              expect(plan.answers.raceDate).toBe(raceDate)
            })
          }
        }
      }
    }
  })

  it('calendarAnswers counts the race date in calendar weeks from week 1', () => {
    const a = tenK({ weeks: undefined, raceDate: addDays(MONDAY, 12 * 7 - 1) }) // the 12th Sunday
    const counted = calendarAnswers(a, MONDAY, 1)
    expect(counted.weeks).toBe(12)
    expect('raceDate' in counted).toBe(false)
    // A Sunday week: that Sunday opens week 13 counted from this week.
    expect(calendarAnswers(a, MONDAY, 0).weeks).toBe(13)
    // On a Friday in a Sunday week, week 1 is next week.
    expect(calendarAnswers(a, FRIDAY, 0).weeks).toBe(12)
    expect(calendarAnswers(tenK(), MONDAY, 1)).toEqual(tenK())
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
    // The plan keeps the week start it was made with: read with a Sunday week, Sunday stays in week 1.
    expect(plan.weekStart).toBe(1)
    expect(currentWeek(plan, sunday, 0)?.index).toBe(1)
    // A plan saved before RunPlan.weekStart maps with the week start it is read with: that Sunday opens week 2.
    const old = { ...plan, weekStart: undefined }
    expect(currentWeek(old, sunday, 0)?.index).toBe(2)
    expect(sessionsOn(old, sunday, 0).map(s => s.id)).toEqual([plan.weeks[1].sessions.find(s => s.type === 'long')!.id])
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

describe('a race plan that starts later (spec §5.3, R2 I6-1)', () => {
  // 5k: at most 16 weeks; the race is on the Sunday 30 weeks out, so 14 weeks wait.
  const raceDate = addDays(MONDAY, 30 * 7 - 1)
  const fiveK = (extra: Partial<Answers> = {}): Answers =>
    ({ goal: '5k', goalType: 'finish', raceDate, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN, ...extra })

  it('says when the race plan starts and how many weeks wait before it', () => {
    expect(raceStartOf(fiveK(), MONDAY, 1)).toEqual({ raceStart: addDays(MONDAY, 14 * 7), waitWeeks: 14 })
    expect(raceStartOf(tenK({ weeks: 14 }), MONDAY, 1)).toEqual({ raceStart: MONDAY, waitWeeks: 0 })
  })

  it('with the bridge, runs maintain weeks from week 1 and still ends in the race week', () => {
    const plan = applyRunPlan(state(1), fiveK({ bridge: true }), MONDAY)
    expect(plan.startDate).toBe(MONDAY)
    expect(plan.weeks).toHaveLength(30)
    expect(plan.weeks.slice(0, 14).every(w => w.phase === 'maintain')).toBe(true)
    expect(plan.weeks[14].phase).toBe('base')
    expect(plan.weeks.map(w => w.index)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    expect(plan.weeks[14].sessions.map(s => s.id)).toEqual(['w15-s1', 'w15-s2', 'w15-s3'])
    expect(new Set(plan.weeks.flatMap(w => w.sessions.map(s => s.id))).size).toBe(90)
    // Before the race weeks, today is in a bridge week.
    expect(currentWeek(plan, MONDAY, 1)).toBe(plan.weeks[0])
    expect(currentWeek(plan, MONDAY, 1)!.phase).toBe('maintain')
    expect(raceWeeksStart(plan, 1)).toBe(addDays(MONDAY, 14 * 7))
    const last = plan.weeks[29]
    expect(currentWeek(plan, raceDate, 1)).toBe(last)
    expect(last.phase).toBe('taper')
    expect(currentWeek(plan, addDays(raceDate, 1), 1)).toBeNull()
  })

  it('a bridge started on a Friday keeps week 1 to the days left (Decision 2)', () => {
    const plan = applyRunPlan(state(0), fiveK({ bridge: true }), FRIDAY)
    // A Sunday week: Friday and Saturday are left, too few for 3 runs, so week 1 is next week.
    expect(plan.startDate).toBe(addDays(FRIDAY, 2))
    expect(plan.weeks[0].phase).toBe('maintain')
    expect(currentWeek(plan, raceDate, 0)).toBe(plan.weeks.at(-1))
  })

  it('without the bridge, waits as before', () => {
    for (const bridge of [false, undefined]) {
      const plan = applyRunPlan(state(1), fiveK({ bridge }), MONDAY)
      expect(plan.weeks).toHaveLength(16)
      expect(plan.startDate).toBe(addDays(MONDAY, 14 * 7))
      expect(currentWeek(plan, MONDAY, 1)).toBeNull()
      expect(raceWeeksStart(plan, 1)).toBeNull()
    }
  })

  it('no bridge when the race plan starts at once', () => {
    const plan = applyRunPlan(state(1), tenK({ weeks: 14, bridge: true }), MONDAY)
    expect(plan.weeks).toHaveLength(14)
    expect(plan.weeks.some(w => w.phase === 'maintain')).toBe(false)
  })
})

describe('the plan keeps its week start (R2 M4-2)', () => {
  it('a Sunday race stays in the last week after the person switches to a Sunday week', () => {
    const raceDate = addDays(MONDAY, 12 * 7 - 1) // a Sunday, 12 weeks out
    const S = state(1)
    const plan = applyRunPlan(S, tenK({ weeks: undefined, raceDate }), MONDAY)
    const last = plan.weeks.at(-1)!
    const raceRuns = sessionsOn(plan, raceDate, 1)
    S.weekStart = 0
    expect(currentWeek(plan, raceDate, 0)).toBe(last)
    expect(sessionsOn(plan, raceDate, 0)).toEqual(raceRuns)
    // Every session still falls on the same date.
    for (let i = 0; i < 12 * 7; i++) {
      const iso = addDays(MONDAY, i)
      expect(sessionsOn(plan, iso, 0)).toEqual(sessionsOn(plan, iso, 1))
    }
    // refitFuture counts weeks with the plan's start too: on the race Sunday nothing after it moves.
    const before = clone(plan.weeks)
    refitFuture(S, raceDate)
    expect(plan.weeks).toEqual(before)
  })
})

describe('a maintain plan begun mid-week (R2 M4-4)', () => {
  it('keeps week 1 to the days left only in the first calendar week; later cycles use every day', () => {
    // Thursday in a Monday week: Thu to Sun left, Monday has legs.
    const S = state(1)
    const plan = applyRunPlan(S, { goal: 'maintain', reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN }, THURSDAY)
    const first = currentWeek(plan, THURSDAY, 1)!
    expect(first.sessions.every(s => [THU, FRI, SAT, SUN].includes(s.day))).toBe(true)
    const again = currentWeek(plan, addDays(THURSDAY, 8 * 7), 1)!
    expect(again).toBe(plan.weeks[0])
    const free = fitWeek(plan.weeks[0].sessions, { week: { [MON]: ['leg'], [WED]: ['upper'] }, routines: [LEG, UPPER], longDay: SUN }).placement
    expect(Object.fromEntries(again.sessions.map(s => [s.id, s.day]))).toEqual(free)
    // A move in the first calendar week changes that week only; in a later cycle, the template.
    const id = first.sessions.find(s => s.type !== 'long')!.id
    const to = [THU, FRI, SAT].find(d => !first.sessions.some(s => s.day === d))!
    const templateDay = plan.weeks[0].sessions.find(s => s.id === id)!.day
    moveSession(S, 1, id, to, THURSDAY)
    expect(currentWeek(S.runPlan, THURSDAY, 1)!.sessions.find(s => s.id === id)!.day).toBe(to)
    expect(S.runPlan!.weeks[0].sessions.find(s => s.id === id)!.day).toBe(templateDay)
    moveSession(S, 1, id, TUE, addDays(THURSDAY, 8 * 7))
    expect(S.runPlan!.weeks[0].sessions.find(s => s.id === id)!.day).toBe(TUE)
    expect(currentWeek(S.runPlan, THURSDAY, 1)!.sessions.find(s => s.id === id)!.day).toBe(to)
  })

  it('a maintain plan begun on Monday has no opening days', () => {
    const plan = applyRunPlan(state(1), { goal: 'maintain', reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: SUN }, MONDAY)
    expect(plan.openingDays).toBeUndefined()
  })
})
