import { describe, expect, it } from 'vitest'
import { nextSuggestion } from './suggestions'
import { vdotFrom } from './vdot'
import type { RunLog } from './run-log'
import type { RunDetail } from './run-detail'
import type { Phase, RunPlan, Session, SessionType, Week } from './types'

// Weeks start on Monday. 2026-10-19 is a Monday: week 1 runs 19 to 25 Oct, week k starts 7(k-1)
// days later.
const W1 = '2026-10-19'
const day = (first: string, k: number) => new Date(Date.parse(first + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10)
const weekFirst = (index: number) => day(W1, 7 * (index - 1))
const MON = 1, WED = 3, SUN = 0

const session = (week: number, k: number, type: SessionType, weekday: number): Session =>
  ({ id: `w${week}-s${k}`, type, day: weekday, blocks: [{ zone: type === 'tempo' ? 'hard' : 'easy', min: 30 }] })
// An easy run on Monday, a tempo on Wednesday and a long run on Sunday.
const weekOf = (index: number, phase: Phase = 'base'): Week => ({
  index, phase, recovery: false,
  sessions: [session(index, 1, 'easy', MON), session(index, 2, 'tempo', WED), session(index, 3, 'long', SUN)]
})
const weeksOf = (phases: Phase[]) => phases.map((p, i) => weekOf(i + 1, p))

const planOf = (over: Partial<RunPlan> = {}): RunPlan => ({
  version: 1, goal: '10k', goalType: 'finish', startDate: W1, weekStart: 1,
  answers: { goal: '10k', reference: { kind: 'none' }, days: 3, longDay: SUN, weeks: 6 },
  vdotSource: null, weeks: weeksOf(['base', 'base', 'build', 'specific', 'taper', 'taper']), dismissed: {}, ...over
})
const maintainOf = (): RunPlan => planOf({
  goal: 'maintain', answers: { goal: 'maintain', reference: { kind: 'none' }, days: 3, longDay: SUN },
  weeks: weeksOf(['maintain', 'maintain'])
})

let n = 0
const log = (d: string, run: RunDetail | null = null, duration_min: number | null = 30): RunLog =>
  ({ id: `c${++n}`, day: d, duration_min, run })
const linked = (week: number, k: number, type: SessionType, rpe?: number): RunDetail =>
  ({ planned: { week, session: `w${week}-s${k}`, type, blocks: [{ zone: 'easy', min: 30 }] }, status: 'as_planned', ...(rpe ? { rpe } : {}) })
// Every workout of plan week `index` (Mon, Wed, Sun), unlinked.
const allOf = (index: number): RunLog[] => [log(weekFirst(index)), log(day(weekFirst(index), 2)), log(day(weekFirst(index), 6))]
const doneUpTo = (last: number) => Array.from({ length: last }, (_, i) => allOf(i + 1)).flat()

describe('nextSuggestion: race passed', () => {
  // A 6-week plan whose race is on the Sunday of week 6.
  const RACE = day(weekFirst(6), 6)
  const race = (over: Partial<RunPlan> = {}) => planOf({ raceDate: RACE, ...over })

  it('the day after the race, without a result, asks for it', () => {
    expect(nextSuggestion(race(), doneUpTo(6), day(RACE, 1), 1)).toEqual({ key: `race:${RACE}`, kind: 'race_result', raceDate: RACE })
    expect(nextSuggestion(race(), [], day(RACE, 30), 1)).toEqual({ key: `race:${RACE}`, kind: 'race_result', raceDate: RACE })
  })

  it('not on race day, nor once the result is in', () => {
    expect(nextSuggestion(race(), doneUpTo(6), RACE, 1)).toBeNull()
    expect(nextSuggestion(race({ raceResult: { minutes: 52 } }), doneUpTo(6), day(RACE, 1), 1)).toBeNull()
  })

  it('a plan with no race never asks', () => {
    expect(nextSuggestion(planOf(), doneUpTo(6), day(weekFirst(7), 1), 1)).toBeNull()
    expect(nextSuggestion(planOf({ goal: 'start', raceDate: RACE }), doneUpTo(6), day(RACE, 1), 1)).toBeNull()
  })
})

describe('nextSuggestion: weak week', () => {
  const TUE_W2 = day(weekFirst(2), 1)

  it('1 of 3 done last week offers to repeat it; the key is the current week', () => {
    expect(nextSuggestion(planOf(), [log(W1)], TUE_W2, 1)).toEqual({ key: 'weak:2', kind: 'repeat_week', week: 2, tight: false })
    // Nothing logged at all is a weak week too.
    expect(nextSuggestion(planOf(), [], day(weekFirst(3), 0), 1)).toEqual({ key: 'weak:3', kind: 'repeat_week', week: 3, tight: false })
  })

  it('2 of 3 is not a weak week', () => {
    expect(nextSuggestion(planOf(), [log(W1), log(day(W1, 2))], TUE_W2, 1)).toBeNull()
  })

  it('never in week 1, in a maintain week or in a maintain plan', () => {
    expect(nextSuggestion(planOf(), [], day(W1, 3), 1)).toBeNull()
    // A race plan that opens with maintain weeks: the week after the last of them looks back at one.
    const bridged = planOf({ raceDate: day(weekFirst(6), 6), weeks: weeksOf(['maintain', 'maintain', 'base', 'build', 'specific', 'taper']) })
    expect(nextSuggestion(bridged, [], TUE_W2, 1)).toBeNull()
    expect(nextSuggestion(bridged, [], day(weekFirst(3), 1), 1)).toBeNull()
    expect(nextSuggestion(bridged, doneUpTo(2), day(weekFirst(4), 1), 1)).toEqual({ key: 'weak:4', kind: 'repeat_week', week: 4, tight: true })
    expect(nextSuggestion(maintainOf(), [], TUE_W2, 1)).toBeNull()
    expect(nextSuggestion(maintainOf(), [], day(weekFirst(5), 1), 1)).toBeNull()
  })

  it('not once the plan is over', () => {
    expect(nextSuggestion(planOf(), doneUpTo(5), day(weekFirst(7), 1), 1)).toBeNull()
  })

  it('tight with a race date and no base week from the current one on', () => {
    const race = planOf({ raceDate: day(weekFirst(6), 6) })
    // Week 2 is still a base week: the repeat takes it out.
    expect(nextSuggestion(race, [log(W1)], TUE_W2, 1)).toMatchObject({ kind: 'repeat_week', tight: false })
    // From week 3 on there is no base week left.
    expect(nextSuggestion(race, [...doneUpTo(1), log(weekFirst(2))], day(weekFirst(3), 1), 1))
      .toEqual({ key: 'weak:3', kind: 'repeat_week', week: 3, tight: true })
    // Without a race date the plan grows instead: never tight.
    expect(nextSuggestion(planOf(), [...doneUpTo(1), log(weekFirst(2))], day(weekFirst(3), 1), 1)).toMatchObject({ tight: false })
  })
})

describe('nextSuggestion: high effort', () => {
  // Weeks 1 and 2 done, each with the easy run and the long run linked at `rpe`.
  const hard = (week: number, easy: number, other: number, otherType: SessionType = 'long'): RunLog[] => [
    log(weekFirst(week), linked(week, 1, 'easy', easy)),
    log(day(weekFirst(week), 2), linked(week, 2, 'tempo', 6)),
    log(day(weekFirst(week), 6), linked(week, otherType === 'long' ? 3 : 2, otherType, other)),
  ]
  const WED_W3 = day(weekFirst(3), 2)

  it('two weeks in a row with two easy or long runs at rpe 8 or more: step back', () => {
    expect(nextSuggestion(planOf(), [...hard(1, 8, 9), ...hard(2, 10, 8)], WED_W3, 1))
      .toEqual({ key: 'effort:3', kind: 'step_back', week: 3, tight: false })
    const race = planOf({ raceDate: day(weekFirst(6), 6) })
    expect(nextSuggestion(race, [...hard(1, 8, 9), ...hard(2, 10, 8)], WED_W3, 1)).toMatchObject({ kind: 'step_back', tight: true })
  })

  it('one week only, or a run below 8, is not enough', () => {
    expect(nextSuggestion(planOf(), [...doneUpTo(1), ...hard(2, 8, 8)], WED_W3, 1)).toBeNull()
    expect(nextSuggestion(planOf(), [...hard(1, 8, 7), ...hard(2, 8, 8)], WED_W3, 1)).toBeNull()
    // In week 2 the two hard weeks are not both behind yet.
    expect(nextSuggestion(planOf(), hard(1, 8, 8), day(weekFirst(2), 2), 1)).toBeNull()
  })

  it('a Ritmo at rpe 9 does not count, nor an unlinked run', () => {
    const tempoWeek = (week: number): RunLog[] => [
      log(weekFirst(week), linked(week, 1, 'easy', 8)),
      log(day(weekFirst(week), 2), linked(week, 2, 'tempo', 9)),
      log(day(weekFirst(week), 6), { status: 'unplanned', rpe: 9 }),
    ]
    expect(nextSuggestion(planOf(), [...tempoWeek(1), ...tempoWeek(2)], WED_W3, 1)).toBeNull()
  })

  it('two check-ins for one workout count it once', () => {
    const twice = (week: number): RunLog[] => [
      ...allOf(week),
      log(weekFirst(week), linked(week, 1, 'easy', 9)),
      log(day(weekFirst(week), 1), linked(week, 1, 'easy', 9)),
    ]
    expect(nextSuggestion(planOf(), [...twice(1), ...twice(2)], WED_W3, 1)).toBeNull()
  })

  it('never in maintain weeks or a maintain plan', () => {
    const bridged = planOf({ raceDate: day(weekFirst(6), 6), weeks: weeksOf(['maintain', 'maintain', 'base', 'build', 'specific', 'taper']) })
    expect(nextSuggestion(bridged, [...hard(1, 9, 9), ...hard(2, 9, 9)], WED_W3, 1)).toBeNull()
    expect(nextSuggestion(maintainOf(), [...hard(1, 9, 9), ...hard(2, 9, 9)], WED_W3, 1)).toBeNull()
  })
})

describe('nextSuggestion: faster', () => {
  const TODAY = day(W1, 3)
  const run = (distance_km: number, rpe: number, minutes = 21, d = day(W1, 2)) =>
    log(d, { status: 'unplanned', distance_km, rpe }, minutes)

  it('5 km in 21:00 at rpe 8 on a VDOT 40 plan offers the run\'s VDOT', () => {
    const r = run(5, 8)
    const vdot = vdotFrom(5000, 21)
    expect(vdot).toBeGreaterThan(40)
    expect(nextSuggestion(planOf({ vdot: 40, vdotSource: 'race' }), [r], TODAY, 1))
      .toEqual({ key: `faster:${r.id}`, kind: 'faster', vdot, checkinId: r.id, day: r.day })
    expect(Math.round(vdot * 10) / 10).toBe(vdot)
  })

  it('not under 3 km, below rpe 8, or with a VDOT that is not higher', () => {
    const plan = planOf({ vdot: 40, vdotSource: 'race' })
    expect(nextSuggestion(plan, [run(2.9, 9, 11)], TODAY, 1)).toBeNull()
    expect(nextSuggestion(plan, [run(5, 7)], TODAY, 1)).toBeNull()
    expect(nextSuggestion(plan, [run(5, 8, 30)], TODAY, 1)).toBeNull()
    expect(nextSuggestion(planOf({ vdot: vdotFrom(5000, 21), vdotSource: 'run' }), [run(5, 8)], TODAY, 1)).toBeNull()
    // No duration: no VDOT.
    expect(nextSuggestion(plan, [run(5, 8, null as unknown as number)], TODAY, 1)).toBeNull()
  })

  it('a VDOT above 85 is a typo, never offered (R2 T6-M3)', () => {
    // 10 km in 20 min.
    expect(vdotFrom(10000, 20)).toBeGreaterThan(85)
    expect(nextSuggestion(planOf({ vdot: 40, vdotSource: 'race' }), [run(10, 8, 20)], TODAY, 1)).toBeNull()
    // The typo does not hide a real run behind it.
    const real = run(5, 8, 21)
    expect(nextSuggestion(planOf(), [run(10, 8, 20), real], TODAY, 1)).toMatchObject({ checkinId: real.id })
  })

  it('a plan without a VDOT takes it; a maintain plan too', () => {
    const r = run(5, 8, 30)
    expect(nextSuggestion(planOf(), [r], TODAY, 1)).toMatchObject({ kind: 'faster', vdot: vdotFrom(5000, 30), checkinId: r.id })
    expect(nextSuggestion(maintainOf(), [r], TODAY, 1)).toMatchObject({ kind: 'faster', checkinId: r.id })
  })

  it('a run below the plan\'s usable VDOT floor is no pace to offer', () => {
    // 3 km in 40 min is a walk.
    expect(nextSuggestion(planOf(), [run(3, 9, 40)], TODAY, 1)).toBeNull()
  })

  it('the fastest run comes first; a run before the plan or after today does not count', () => {
    const slow = run(5, 8, 24, day(W1, 1))
    const fast = run(5, 9, 21, day(W1, 2))
    expect(nextSuggestion(planOf(), [slow, fast], TODAY, 1)).toMatchObject({ checkinId: fast.id })
    expect(nextSuggestion(planOf({ dismissed: { [`faster:${fast.id}`]: TODAY } }), [slow, fast], TODAY, 1)).toMatchObject({ checkinId: slow.id })
    expect(nextSuggestion(planOf(), [run(5, 9, 21, day(W1, -1)), run(5, 9, 21, day(TODAY, 1))], TODAY, 1)).toBeNull()
  })
})

describe('nextSuggestion: priority and "Not now"', () => {
  // A race date in week 2 of a 6-week plan, so the race is past while the plan still runs.
  const plan = (dismissed: Record<string, string> = {}) => planOf({ raceDate: day(weekFirst(2), 6), dismissed })
  const TUE_W3 = day(weekFirst(3), 1)
  const fast = log(day(weekFirst(3), 0), { status: 'unplanned', distance_km: 5, rpe: 8 }, 21)
  const logs = [...doneUpTo(1), fast]

  it('the race comes first, then the weak week, then the rest', () => {
    expect(nextSuggestion(plan(), logs, TUE_W3, 1)).toMatchObject({ kind: 'race_result' })
    expect(nextSuggestion(plan({ 'race:2026-11-01': TUE_W3 }), logs, TUE_W3, 1)).toEqual({ key: 'weak:3', kind: 'repeat_week', week: 3, tight: true })
    expect(nextSuggestion(plan({ 'race:2026-11-01': TUE_W3, 'weak:3': TUE_W3 }), logs, TUE_W3, 1))
      .toMatchObject({ kind: 'faster', checkinId: fast.id })
    expect(nextSuggestion(plan({ 'race:2026-11-01': TUE_W3, 'weak:3': TUE_W3, [`faster:${fast.id}`]: TUE_W3 }), logs, TUE_W3, 1)).toBeNull()
  })

  it('a new key comes back: the next weak week', () => {
    const dismissed = { 'weak:2': day(weekFirst(2), 1) }
    expect(nextSuggestion(planOf({ dismissed }), [log(W1)], day(weekFirst(2), 3), 1)).toBeNull()
    expect(nextSuggestion(planOf({ dismissed }), [log(W1)], day(weekFirst(3), 1), 1)).toMatchObject({ key: 'weak:3' })
  })

  it('no plan, or a plan this build does not read: nothing', () => {
    expect(nextSuggestion(null, [], W1, 1)).toBeNull()
    expect(nextSuggestion({ ...planOf(), version: 2 } as unknown as RunPlan, [], day(weekFirst(3), 1), 1)).toBeNull()
  })

  it('a plan saved without dismissed still reads', () => {
    const old = { ...planOf() } as Partial<RunPlan>
    delete old.dismissed
    expect(nextSuggestion(old as RunPlan, [log(W1)], day(weekFirst(2), 1), 1)).toMatchObject({ key: 'weak:2' })
  })
})

describe('nextSuggestion: history not known (final review I1 and I2)', () => {
  it('without the logs (no account, loading, failed read) skips rules 2 to 4, never the race', () => {
    // Nothing logged reads as a weak week; with the history unknown it must not.
    expect(nextSuggestion(planOf(), [], day(weekFirst(3), 1), 1)).toMatchObject({ key: 'weak:3' })
    expect(nextSuggestion(planOf(), null, day(weekFirst(3), 1), 1)).toBeNull()
    // Nor the faster rule from a run the screen happens to hold.
    expect(nextSuggestion(planOf({ vdot: 40, vdotSource: 'race' }), null, day(W1, 3), 1)).toBeNull()
    const RACE = day(weekFirst(6), 6)
    expect(nextSuggestion(planOf({ raceDate: RACE }), null, day(RACE, 1), 1)).toMatchObject({ kind: 'race_result' })
  })
})
