import { describe, it, expect } from 'vitest'
import cases from '../../../supabase/tests/fixtures/achievement-scenarios.json'
import { ACHIEVEMENTS, NUTRITION_METRICS, achievementByCode, evaluateAchievements, type AchievementStats } from './achievements'

describe('achievement catalogue (client mirror)', () => {
  it.each(cases)('$name', c => {
    expect(evaluateAchievements(c.stats as AchievementStats, c.unlocked)).toEqual(c.expect)
  })

  it('has 32 badges in sort order with unique codes, the 10 of nutrition private', () => {
    expect(ACHIEVEMENTS).toHaveLength(32)
    expect(new Set(ACHIEVEMENTS.map(a => a.code)).size).toBe(32)
    expect(ACHIEVEMENTS.filter(a => a.private).map(a => a.metric).every(m => NUTRITION_METRICS.includes(m))).toBe(true)
    expect(ACHIEVEMENTS.filter(a => a.private)).toHaveLength(10)
    expect(ACHIEVEMENTS.filter(a => NUTRITION_METRICS.includes(a.metric)).every(a => a.private)).toBe(true)
    expect(ACHIEVEMENTS.map(a => a.sort)).toEqual([...ACHIEVEMENTS.map(a => a.sort)].sort((a, b) => a - b))
  })

  it('looks codes up', () => {
    expect(achievementByCode('streak_52')).toMatchObject({ metric: 'best_streak', threshold: 52, xp: 1500 })
    expect(achievementByCode('nope')).toBeUndefined()
  })
})
