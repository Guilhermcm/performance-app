import { describe, it, expect } from 'vitest'
import cases from '../../../supabase/tests/fixtures/achievement-scenarios.json'
import { ACHIEVEMENTS, NUTRITION_METRICS, SLEEP_METRICS, achievementByCode, evaluateAchievements, type AchievementStats } from './achievements'

describe('achievement catalogue (client mirror)', () => {
  it.each(cases)('$name', c => {
    expect(evaluateAchievements(c.stats as AchievementStats, c.unlocked)).toEqual(c.expect)
  })

  it('has 42 badges in sort order with unique codes, the 10 of nutrition and the 10 of sleep private', () => {
    const own = [...NUTRITION_METRICS, ...SLEEP_METRICS]
    expect(ACHIEVEMENTS).toHaveLength(42)
    expect(new Set(ACHIEVEMENTS.map(a => a.code)).size).toBe(42)
    expect(ACHIEVEMENTS.filter(a => a.private).map(a => a.metric).every(m => own.includes(m))).toBe(true)
    expect(ACHIEVEMENTS.filter(a => a.private)).toHaveLength(20)
    expect(ACHIEVEMENTS.filter(a => own.includes(a.metric)).every(a => a.private)).toBe(true)
    expect(ACHIEVEMENTS.filter(a => SLEEP_METRICS.includes(a.metric)).map(a => [a.code, a.threshold, a.xp, a.sort])).toEqual([
      ['sleep_first_night', 1, 50, 400],
      ['sleep_nights_10', 10, 100, 410],
      ['sleep_nights_50', 50, 200, 420],
      ['sleep_nights_100', 100, 300, 430],
      ['sleep_nights_250', 250, 500, 440],
      ['sleep_week_target_1', 1, 75, 450],
      ['sleep_streak_4', 4, 150, 460],
      ['sleep_streak_12', 12, 400, 470],
      ['sleep_streak_26', 26, 800, 480],
      ['sleep_clock_7', 7, 100, 490],
    ])
    expect(ACHIEVEMENTS.map(a => a.sort)).toEqual([...ACHIEVEMENTS.map(a => a.sort)].sort((a, b) => a - b))
  })

  it('looks codes up', () => {
    expect(achievementByCode('streak_52')).toMatchObject({ metric: 'best_streak', threshold: 52, xp: 1500 })
    expect(achievementByCode('nope')).toBeUndefined()
  })
})
