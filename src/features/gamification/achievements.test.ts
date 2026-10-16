import { describe, it, expect } from 'vitest'
import cases from '../../../supabase/tests/fixtures/achievement-scenarios.json'
import { ACHIEVEMENTS, HABITS_METRICS, NUTRITION_METRICS, SLEEP_METRICS, achievementByCode, evaluateAchievements, type AchievementStats } from './achievements'

describe('achievement catalogue (client mirror)', () => {
  it.each(cases)('$name', c => {
    expect(evaluateAchievements(c.stats as AchievementStats, c.unlocked)).toEqual(c.expect)
  })

  it('has 52 badges in sort order with unique codes, the 10 of nutrition, sleep and habits private', () => {
    const own = [...NUTRITION_METRICS, ...SLEEP_METRICS, ...HABITS_METRICS]
    expect(ACHIEVEMENTS).toHaveLength(52)
    expect(new Set(ACHIEVEMENTS.map(a => a.code)).size).toBe(52)
    expect(ACHIEVEMENTS.filter(a => a.private).map(a => a.metric).every(m => own.includes(m))).toBe(true)
    expect(ACHIEVEMENTS.filter(a => a.private)).toHaveLength(30)
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
    expect(ACHIEVEMENTS.filter(a => HABITS_METRICS.includes(a.metric)).map(a => [a.code, a.metric, a.threshold, a.xp, a.sort])).toEqual([
      ['habits_first_check', 'habits_checks', 1, 50, 500],
      ['habits_checks_50', 'habits_checks', 50, 100, 510],
      ['habits_checks_200', 'habits_checks', 200, 200, 520],
      ['habits_checks_500', 'habits_checks', 500, 300, 530],
      ['habits_checks_1000', 'habits_checks', 1000, 500, 540],
      ['habits_week_target_1', 'habits_week_targets', 1, 75, 550],
      ['habits_streak_4', 'habits_best_streak', 4, 150, 560],
      ['habits_streak_12', 'habits_best_streak', 12, 400, 570],
      ['habits_streak_26', 'habits_best_streak', 26, 800, 580],
      ['habits_iron_8', 'habits_iron_best_run', 8, 200, 590],
    ])
    expect(ACHIEVEMENTS.map(a => a.sort)).toEqual([...ACHIEVEMENTS.map(a => a.sort)].sort((a, b) => a - b))
  })

  it('looks codes up', () => {
    expect(achievementByCode('streak_52')).toMatchObject({ metric: 'best_streak', threshold: 52, xp: 1500 })
    expect(achievementByCode('nope')).toBeUndefined()
  })
})
