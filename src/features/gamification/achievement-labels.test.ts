import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS, NUTRITION_METRICS, SLEEP_METRICS } from './achievements'
import { ACHIEVEMENT_TEXT, achievementTitle } from './achievement-labels'

describe('achievement labels', () => {
  it('names and describes every badge of the catalogue', () => {
    for (const a of ACHIEVEMENTS) {
      const text = ACHIEVEMENT_TEXT[a.code]
      expect(text, a.code).toBeTruthy()
      expect(text.title().trim(), a.code).not.toBe('')
      expect(text.detail().trim(), a.code).not.toBe('')
    }
  })

  it('gives the 10 nutrition badges their own text', () => {
    const nutrition = ACHIEVEMENTS.filter(a => NUTRITION_METRICS.includes(a.metric))
    expect(nutrition).toHaveLength(10)
    const titles = nutrition.map(a => ACHIEVEMENT_TEXT[a.code].title())
    expect(new Set(titles).size).toBe(10)
    expect(ACHIEVEMENT_TEXT.nutrition_days_50.title()).toBe('50 days on target')
    expect(ACHIEVEMENT_TEXT.nutrition_streak_12.detail()).toBe('Meet your weekly nutrition goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.protein_7.title()).toBe('Protein week')
  })

  it('gives the 10 sleep badges their own text, without a dash as a pause', () => {
    const sleep = ACHIEVEMENTS.filter(a => SLEEP_METRICS.includes(a.metric))
    expect(sleep).toHaveLength(10)
    const titles = sleep.map(a => ACHIEVEMENT_TEXT[a.code].title())
    expect(new Set(titles).size).toBe(10)
    for (const a of sleep) {
      const { title, detail } = ACHIEVEMENT_TEXT[a.code]
      expect(title().trim(), a.code).not.toBe('')
      expect(detail().trim(), a.code).not.toBe('')
      expect(title() + ' ' + detail(), a.code).not.toMatch(/[—–]|\s-\s/)
    }
    expect(ACHIEVEMENT_TEXT.sleep_first_night.title()).toBe('First night')
    expect(ACHIEVEMENT_TEXT.sleep_nights_50.title()).toBe('50 nights on target')
    expect(ACHIEVEMENT_TEXT.sleep_week_target_1.title()).toBe('Sleep goal met')
    expect(ACHIEVEMENT_TEXT.sleep_streak_12.title()).toBe('12 weeks of sleep')
    expect(ACHIEVEMENT_TEXT.sleep_streak_12.detail()).toBe('Meet your weekly sleep goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.sleep_clock_7.title()).toBe('Clock on time')
  })

  it('puts the threshold in the counted badges', () => {
    expect(ACHIEVEMENT_TEXT.workouts_50.title()).toBe('50 training days')
    expect(ACHIEVEMENT_TEXT.streak_12.detail()).toBe('Meet your weekly goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.level_25.title()).toBe('Level 25')
  })

  it('counts training days, not finished workouts, since check-ins (spec 5.1)', () => {
    expect(ACHIEVEMENT_TEXT.first_workout.detail()).toBe('Log your first training day.')
    expect(ACHIEVEMENT_TEXT.workouts_100.detail()).toBe('Log 100 training days.')
  })

  it('never falls back to the raw code', () => {
    expect(achievementTitle('first_pr')).toBe('First PR')
    expect(achievementTitle('from_the_future')).toBe('New achievement')
  })
})
