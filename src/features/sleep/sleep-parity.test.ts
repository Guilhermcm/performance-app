import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/sleep-scenarios.json'
import { classifyNight } from './classify'
import { durationMin } from './time'

// The same scenarios run in supabase/tests against the SQL. The weekly XP scenarios run in
// gamification/xp.test.ts.
describe('sleep parity with the SQL fixture', () => {
  it.each(fixture.nights)('classification: $name', n => {
    const log = n.log && {
      bed_time: n.log.bed_time,
      duration_min: durationMin(n.log.bed_time, n.log.wake_time),
      quality: n.log.quality,
    }
    expect(classifyNight(log, n.target)).toEqual(n.expect)
  })
})
