import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS } from './achievements'
import { ACHIEVEMENT_TEXT } from './achievement-labels'

describe('achievement labels', () => {
  it('names and describes every badge of the catalogue', () => {
    for (const a of ACHIEVEMENTS) {
      const text = ACHIEVEMENT_TEXT[a.code]
      expect(text, a.code).toBeTruthy()
      expect(text.title().trim(), a.code).not.toBe('')
      expect(text.detail().trim(), a.code).not.toBe('')
    }
  })

  it('puts the threshold in the counted badges', () => {
    expect(ACHIEVEMENT_TEXT.workouts_50.title()).toBe('50 workouts')
    expect(ACHIEVEMENT_TEXT.streak_12.detail()).toBe('Meet your weekly goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.level_25.title()).toBe('Level 25')
  })
})
