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

  it('floors at the TMB when it is above 1200 (the TMB arm)', () => {
    // male 100 kg, 150 cm, 30 y: TMB = 1000 + 937.5 - 150 + 5 = 1792.5; tdee = 1792.5 * 1.2 = 2151.
    // fat_loss standard: 2151 * 0.8 = 1720.8 < TMB, so wanted = 1792.5 -> round to 10 = 1790.
    // protein 2.2 * 100 = 220; fat max(1790 * .25 / 9 = 49.7, 0.6 * 100) = 60; carbs (1790 - 880 - 540) / 4 = 92.5 -> 93.
    const t = computeTarget({ ...base, weight_kg: 100, height_cm: 150, goal: 'fat_loss', pace: 'standard', activity_level: 'sedentary' }, TODAY)
    expect(t).toMatchObject({ bmr: 1792.5, tdee: 2151, kcal: 1790, protein_g: 220, fat_g: 60, carbs_g: 93, adjust: 1790 - 2151 })
  })

  it('strength adds 5% (80 kg, moderate)', () => {
    // tdee = 1767.5 * 1.55 = 2739.625 (2740); * 1.05 = 2876.6 -> 2880. protein 1.8 * 80 = 144;
    // fat max(2880 * .25 / 9 = 80, 48) = 80; carbs (2880 - 576 - 720) / 4 = 396; adjust 2880 - 2740 = 140.
    const t = computeTarget({ ...base, goal: 'strength' }, TODAY)
    expect(t).toMatchObject({ kcal: 2880, protein_g: 144, fat_g: 80, carbs_g: 396, adjust: 140 })
  })

  it('fat loss at the gentle pace cuts 10% (80 kg, moderate)', () => {
    // tdee 2739.625 * 0.9 = 2465.66 -> 2470 (above the TMB 1767.5). protein 2.2 * 80 = 176;
    // fat max(2470 * .25 / 9 = 68.6, 48) -> 69; carbs (2470 - 704 - 621) / 4 = 286.25 -> 286; adjust 2470 - 2740 = -270.
    const t = computeTarget({ ...base, goal: 'fat_loss', pace: 'gentle' }, TODAY)
    expect(t).toMatchObject({ kcal: 2470, protein_g: 176, fat_g: 69, carbs_g: 286, adjust: -270 })
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
