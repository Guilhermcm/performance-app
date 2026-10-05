import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS, NUTRITION_METRICS } from './achievements'
import { ACHIEVEMENT_TEXT } from './achievement-labels'

describe('achievement labels', () => {
  it('names and describes every badge of the catalogue', () => {
    // The nutrition badges get their text with the nutrition screens (phase 2a, Task 12).
    for (const a of ACHIEVEMENTS.filter(x => !NUTRITION_METRICS.includes(x.metric))) {
      const text = ACHIEVEMENT_TEXT[a.code]
      expect(text, a.code).toBeTruthy()
      expect(text!.title().trim(), a.code).not.toBe('')
      expect(text!.detail().trim(), a.code).not.toBe('')
    }
  })

  it('puts the threshold in the counted badges', () => {
    expect(ACHIEVEMENT_TEXT.workouts_50.title()).toBe('50 workouts')
    expect(ACHIEVEMENT_TEXT.streak_12.detail()).toBe('Meet your weekly goal 12 weeks in a row.')
    expect(ACHIEVEMENT_TEXT.level_25.title()).toBe('Level 25')
  })
})
