// @vitest-environment happy-dom
// Where the plan stands on /plan (spec §6.4). A plan whose race falls early in the week ends the
// week before (final review I1), so the eve and race day are past its last week: they show the race,
// not "Plan finished" (final review fix 1, new finding).
import { describe, expect, it } from 'vitest'
import { fmtDate } from '../../lib/format.js'
import { planStatus } from './RunPlanEntry'
import { applyRunPlan, currentWeek, type RunState } from './run-actions'
import type { Answers } from './types'

const MONDAY = '2026-10-19'
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const state = (weekStart: 0 | 1): RunState => ({ weekStart, week: {}, routines: [], runPlan: null })
const tenK = (raceDate: string): Answers =>
  ({ goal: '10k', goalType: 'finish', raceDate, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: 0 })

describe('planStatus around an early-week race', () => {
  const cases: [string, 0 | 1, string][] = [
    ['a Tuesday race with Monday weeks', 1, addDays(MONDAY, 12 * 7 + 1)],
    ['a Monday race with Sunday weeks', 0, addDays(MONDAY, 12 * 7)],
  ]
  for (const [name, ws, raceDate] of cases) {
    it(`${name}: the race on the eve and on race day, "Plan finished" only after it`, () => {
      const plan = applyRunPlan(state(ws), tenK(raceDate), MONDAY)
      const eve = addDays(raceDate, -1)
      // Neither day is in a plan week.
      expect(currentWeek(plan, eve, ws)).toBeNull()
      expect(currentWeek(plan, raceDate, ws)).toBeNull()
      expect(planStatus(plan, eve, ws)).toBe('10 km · Race on ' + fmtDate(raceDate, false, false))
      expect(planStatus(plan, raceDate, ws)).toBe('10 km · Race day')
      expect(planStatus(plan, addDays(raceDate, 1), ws)).toBe('Plan finished')
    })
  }

  it('race day inside the last week shows the race too', () => {
    const raceDate = addDays(MONDAY, 12 * 7 - 1) // a Sunday, the last day of a Monday week
    const plan = applyRunPlan(state(1), tenK(raceDate), MONDAY)
    expect(currentWeek(plan, raceDate, 1)).toBe(plan.weeks.at(-1))
    expect(planStatus(plan, raceDate, 1)).toBe('10 km · Race day')
    expect(planStatus(plan, addDays(raceDate, -1), 1)).toBe(`10 km · Week ${plan.weeks.length} of ${plan.weeks.length}`)
  })

  it('a plan without a race date is finished after its last week', () => {
    const plan = applyRunPlan(state(1), { ...tenK(''), raceDate: undefined, weeks: 10 }, MONDAY)
    expect(planStatus(plan, addDays(MONDAY, 10 * 7), 1)).toBe('Plan finished')
  })
})
