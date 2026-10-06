import type { Macros, Per100 } from './types'

const one = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10

// Macros of `grams` of a food given per 100 g, rounded to one decimal.
export function portion(per100: Per100, grams: number): Macros & { fiber_g: number | null } {
  const k = grams / 100
  return {
    kcal: one(per100.kcal * k),
    protein_g: one(per100.protein * k),
    carbs_g: one(per100.carbs * k),
    fat_g: one(per100.fat * k),
    fiber_g: per100.fiber == null ? null : one(per100.fiber * k),
  }
}
