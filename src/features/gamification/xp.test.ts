import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/xp-scenarios.json'
import { levelFor, replay, sessionXp, streakAfter, weekStartOf, WEEK_MAX, type XpEvent } from './xp'

describe('xp rules (client mirror)', () => {
  it.each(fixture.levels)('levelFor($xp)', l => {
    expect(levelFor(l.xp)).toEqual({ level: l.level, into: l.into, need: l.need })
  })

  it.each(fixture.weeks)('$name', s => {
    const targets = s.targets as Record<string, number>
    const awards = replay(s.events as XpEvent[], week => targets[week])
    expect(awards).toEqual(s.awards)
    expect(awards.reduce((n, a) => n + a.amount, 0)).toBe(s.total)
  })

  it.each(fixture.streaks)('streak: $name', s => {
    expect(streakAfter(s.hits)).toEqual({ current: s.current, best: s.best, shields: s.shields })
  })

  it('planned sessions add up to 600 and the weekly max is 960 for every T', () => {
    for (let t = 1; t <= 7; t++) {
      let sum = 0
      for (let k = 1; k <= t; k++) sum += sessionXp(t, k)
      expect(sum, `T=${t}`).toBe(600)
    }
    expect(WEEK_MAX).toBe(960)
  })

  it('weeks start on Monday', () => {
    expect(['2026-10-05', '2026-10-11', '2026-10-12'].map(weekStartOf)).toEqual(['2026-10-05', '2026-10-05', '2026-10-12'])
  })
})
