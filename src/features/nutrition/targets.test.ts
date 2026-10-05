import { describe, it, expect } from 'vitest'
import { bmr, computeTarget, fitCarbs, macroGap, missingTargetInput, type TargetInput } from './targets'

const TODAY = '2026-10-05'
const base: TargetInput = {
  birth_date: '1996-10-05', sex: 'male', height_cm: 178, weight_kg: 80,
  goal: 'hypertrophy', activity_level: 'moderate', pace: 'standard',
}

describe('computeTarget', () => {
  it('matches the spec example', () => {
    const t = computeTarget(base, TODAY)
    expect(t).toMatchObject({ kcal: 3010, protein_g: 160, carbs_g: 404, fat_g: 84, bmr: 1767.5, tdee: 2740 })
  })

  it('female and other use their own constants', () => {
    expect(bmr({ ...base, sex: 'female' }, TODAY)).toBe(1767.5 - 166)
    expect(bmr({ ...base, sex: 'other' }, TODAY)).toBe(1767.5 - 83)
  })

  it('floors the kcal at max(TMB, 1200)', () => {
    const t = computeTarget({ ...base, sex: 'female', weight_kg: 40, height_cm: 150, goal: 'fat_loss', activity_level: 'sedentary' }, TODAY)
    expect(t.kcal).toBe(1200)
  })

  it('keeps fat at 0.6 g/kg at least', () => {
    const t = computeTarget({ ...base, weight_kg: 100, goal: 'fat_loss', pace: 'standard', activity_level: 'sedentary', height_cm: 150 }, TODAY)
    expect(t.fat_g).toBeGreaterThanOrEqual(60)
  })

  it('stays inside the database limits at 400 kg', () => {
    const t = computeTarget({ ...base, weight_kg: 400 }, TODAY)
    expect(t.protein_g).toBe(400)
    expect(t.kcal).toBeLessThanOrEqual(6000)
    expect(t.carbs_g).toBe(Math.min(900, Math.max(0, Math.round((t.kcal - 4 * t.protein_g - 9 * t.fat_g) / 4))))
  })

  it('counts age on the day: a birthday tomorrow is one year less', () => {
    const tomorrow = bmr({ ...base, birth_date: '1996-10-06' }, TODAY)
    expect(tomorrow).toBe(1767.5 + 5)
  })
})

describe('missingTargetInput', () => {
  it('lists what the profile lacks', () => {
    expect(missingTargetInput({ birth_date: '1990-01-01', sex: 'male', height_cm: 170, weight_kg: 70, activity_level: 'light', goal: null })).toEqual(['goal'])
  })
})

describe('macro gap', () => {
  it('measures the share and fitCarbs closes it', () => {
    const m = { kcal: 2000, protein_g: 150, carbs_g: 300, fat_g: 60 }
    expect(macroGap(m)).toBeCloseTo(Math.abs(600 + 1200 + 540 - 2000) / 2000)
    expect(macroGap(fitCarbs(m))).toBeLessThan(0.01)
  })
})
