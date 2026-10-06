import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/nutrition-scenarios.json'
import { classifyDay } from './classify'
import { nutritionWeekAwards } from '../gamification/xp'

// The same scenarios run in supabase/tests/nutrition-parity.test.ts against the SQL.
describe('nutrition parity with the SQL fixture', () => {
  it.each(fixture.days)('classification: $name', d => {
    const t = d.totals
    expect(classifyDay({ kcal: t.kcal, protein_g: t.protein, carbs_g: t.carbs, fat_g: t.fat, meals: t.meals }, d.target)).toEqual(d.expect)
  })

  it.each(fixture.weeks)('xp: $name', w => {
    const days = w.days.map(d => ({
      on: d.on,
      classes: { logged: d.classes.includes('day_logged'), on_target: d.classes.includes('day_on_target'), balanced: d.classes.includes('macros_balanced') },
    }))
    expect(nutritionWeekAwards(days, w.target)).toEqual(w.awards)
  })
})
