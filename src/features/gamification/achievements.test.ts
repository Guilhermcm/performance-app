import { describe, it, expect } from 'vitest'
import cases from '../../../supabase/tests/fixtures/achievement-scenarios.json'
import { ACHIEVEMENTS, achievementByCode, evaluateAchievements, type AchievementStats } from './achievements'

describe('achievement catalogue (client mirror)', () => {
  it.each(cases)('$name', c => {
    expect(evaluateAchievements(c.stats as AchievementStats, c.unlocked)).toEqual(c.expect)
  })

  it('has 22 badges in sort order with unique codes', () => {
    expect(ACHIEVEMENTS).toHaveLength(22)
    expect(new Set(ACHIEVEMENTS.map(a => a.code)).size).toBe(22)
    expect(ACHIEVEMENTS.map(a => a.sort)).toEqual([...ACHIEVEMENTS.map(a => a.sort)].sort((a, b) => a - b))
  })

  it('looks codes up', () => {
    expect(achievementByCode('streak_52')).toMatchObject({ metric: 'best_streak', threshold: 52, xp: 1500 })
    expect(achievementByCode('nope')).toBeUndefined()
  })
})
