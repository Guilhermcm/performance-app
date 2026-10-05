import { describe, it, expect } from 'vitest'
import { suggestStarterPlan } from './starter-suggest'

describe('suggestStarterPlan', () => {
  it.each([
    [{ days: 1, level: 'beginner', goal: 'hypertrophy' }, 'full-body'],
    [{ days: 3, level: 'beginner', goal: 'hypertrophy' }, 'full-body'],
    [{ days: 3, level: 'advanced', goal: 'hypertrophy' }, 'full-body'],
    [{ days: 3, level: 'beginner', goal: 'strength' }, '5x5'],
    [{ days: 3, level: 'intermediate', goal: 'strength' }, '5x5'],
    [{ days: 3, level: 'advanced', goal: 'strength' }, 'full-body'],
    [{ days: 2, level: 'intermediate', goal: 'strength' }, '5x5'],
    [{ days: 4, level: 'beginner', goal: 'fat_loss' }, 'upper-lower'],
    [{ days: 4, level: 'advanced', goal: 'strength' }, 'upper-lower'],
    [{ days: 5, level: 'beginner', goal: 'hypertrophy' }, 'upper-lower'],
    [{ days: 5, level: 'intermediate', goal: 'hypertrophy' }, 'ppl'],
    [{ days: 7, level: 'advanced', goal: 'conditioning' }, 'ppl']
  ] as const)('%j → %s', (input, plan) => {
    expect(suggestStarterPlan(input)).toBe(plan)
  })

  it('treats a missing level as beginner and a missing goal as hypertrophy', () => {
    expect(suggestStarterPlan({ days: 5, level: null, goal: null })).toBe('upper-lower')
  })
})
