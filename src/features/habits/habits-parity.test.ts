import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/habits-scenarios.json'
import { habitWeekAwards } from './week'

// The same scenarios run in supabase/tests against the SQL (award_xp and close_habit_days).
describe('habits parity with the SQL fixture', () => {
  it('has the ten scenarios', () => {
    expect(fixture.weeks).toHaveLength(10)
  })
  it.each(fixture.weeks)('awards: $name', w => {
    const awards = habitWeekAwards({ habits: w.habits, checks: w.checks })
    expect(awards).toEqual(w.awards)
    expect(awards.reduce((s, a) => s + a.amount, 0)).toBe(w.total)
  })
})
