import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/nutrition-scenarios.json'
import { classifyDay, dayTotals } from './classify'
import type { FoodLog } from './types'

const fromFixture = (t: (typeof fixture.days)[number]['totals']) => ({
  kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat, meals: t.meals,
})

describe('classifyDay', () => {
  it.each(fixture.days)('$name', d => {
    expect(classifyDay(fromFixture(d.totals), d.target)).toEqual(d.expect)
  })
})

describe('dayTotals', () => {
  it('sums and counts distinct meals', () => {
    const log = (meal: FoodLog['meal'], kcal: number): FoodLog => ({
      id: meal + kcal, day: '2026-10-05', meal, name: 'x', brand: null, source: 'quick', source_id: null,
      grams: null, fiber_g: null, updated_at: '', kcal, protein_g: 0.1, carbs_g: 0.2, fat_g: 0.3,
    })
    expect(dayTotals([log('lunch', 100), log('lunch', 50), log('dinner', 25)])).toEqual({
      kcal: 175, protein_g: 0.3, carbs_g: 0.6, fat_g: 0.9, meals: 2,
    })
  })
})
