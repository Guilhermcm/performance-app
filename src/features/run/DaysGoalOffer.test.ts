// @vitest-environment happy-dom
// The days count behind the weekly goal offer (spec §6.3): strength days and the runs of next week.
import { describe, expect, it } from 'vitest'
import { trainingDays } from './DaysGoalOffer'
import type { RunState } from './run-actions'
import type { RunPlan, Session } from './types'

const easy = (id: string, day: number): Session => ({ id, type: 'easy', day, blocks: [{ zone: 'easy', min: 30 }] })
const plan = (startDate: string, weeks: number): RunPlan => ({
  version: 1, goal: '5k', goalType: 'finish', startDate, weekStart: 1,
  answers: { goal: '5k', reference: { kind: 'none' }, days: 2, longDay: 0 }, vdotSource: null, dismissed: {},
  weeks: Array.from({ length: weeks }, (_, i) => ({ index: i + 1, phase: 'base', recovery: false, sessions: [easy(`w${i + 1}-s1`, 2), easy(`w${i + 1}-s2`, 4)] })),
})
const S = (runPlan: RunPlan): RunState => ({ week: { 1: ['a'], 3: ['b'] }, routines: [], weekStart: 1, runPlan })

// Wednesday 14 October 2026; next week starts on Monday the 19th.
const TODAY = '2026-10-14'

describe('trainingDays', () => {
  it('counts strength days and next week\'s runs', () => {
    expect(trainingDays(S(plan('2026-10-12', 4)), TODAY)).toBe(4)
  })
  it('counts the first week of a plan that starts after next week', () => {
    expect(trainingDays(S(plan('2026-11-09', 4)), TODAY)).toBe(4)
  })
  it('counts no runs when next week is past the plan\'s end (R2 M6-2)', () => {
    expect(trainingDays(S(plan('2026-10-12', 1)), TODAY)).toBe(2)
  })
})
