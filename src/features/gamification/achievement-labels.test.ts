import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS } from './achievements'
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
    const nutrition = ACHIEVEMENTS.filter(a => a.private)
    expect(nutrition).toHaveLength(10)
    const titles = nutrition.map(a => ACHIEVEMENT_TEXT[a.code].title())
    expect(new Set(titles).size).toBe(10)
    expect(ACHIEVEMENT_TEXT.nutrition_days_50.title()).toBe('50 days on target')
    expect(ACHIEVEMENT_TEXT.nutrition_streak_12.detail()).toBe('Meet your weekly nutrition goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.protein_7.title()).toBe('Protein week')
  })

  it('puts the threshold in the counted badges', () => {
    expect(ACHIEVEMENT_TEXT.workouts_50.title()).toBe('50 workouts')
    expect(ACHIEVEMENT_TEXT.streak_12.detail()).toBe('Meet your weekly goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.level_25.title()).toBe('Level 25')
  })

  it('never falls back to the raw code', () => {
    expect(achievementTitle('first_pr')).toBe('First PR')
    expect(achievementTitle('from_the_future')).toBe('New achievement')
  })
})
