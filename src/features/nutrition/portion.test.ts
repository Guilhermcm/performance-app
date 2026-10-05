import { describe, it, expect } from 'vitest'
import { portion } from './portion'

describe('portion', () => {
  it('scales per 100 g and rounds to one decimal', () => {
    expect(portion({ kcal: 130, protein: 2.5, carbs: 28, fat: 0.3, fiber: 0.4 }, 150))
      .toEqual({ kcal: 195, protein_g: 3.8, carbs_g: 42, fat_g: 0.5, fiber_g: 0.6 })
  })
  it('keeps fiber null when unknown', () => {
    expect(portion({ kcal: 100, protein: 1, carbs: 1, fat: 1 }, 50).fiber_g).toBeNull()
  })
})
