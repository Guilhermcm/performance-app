// Day classification (spec 6.2), mirrored from classify_nutrition_day in 0010_nutrition_close.sql.
// The SQL uses exact numeric; here values are scaled to integers so 90%, 110% and 120% of a target
// land exactly on the bound instead of drifting by a float ulp. Bounds are inclusive.
import type { DayClass, DayTotals, FoodLog, Macros } from './types'

const SCALE = 1000
const scaled = (n: number) => Math.round(n * SCALE)

export function classifyDay(t: DayTotals, target: Macros): DayClass {
  const kcal = scaled(t.kcal)
  const tk = scaled(target.kcal)
  const logged = t.meals >= 2 && 2 * kcal >= tk
  const on_target = logged && 10 * Math.abs(kcal - tk) <= tk && scaled(t.protein_g) >= scaled(target.protein_g)
  const tc = scaled(target.carbs_g)
  const tf = scaled(target.fat_g)
  const balanced =
    on_target &&
    5 * Math.abs(scaled(t.carbs_g) - tc) <= tc &&
    5 * Math.abs(scaled(t.fat_g) - tf) <= tf
  return { logged, on_target, balanced }
}

// Meals count once each, however many items they hold.
export function dayTotals(logs: FoodLog[]): DayTotals {
  const sum = (pick: (l: FoodLog) => number) => Math.round(logs.reduce((n, l) => n + pick(l), 0) * SCALE) / SCALE
  return {
    kcal: sum(l => l.kcal),
    protein_g: sum(l => l.protein_g),
    carbs_g: sum(l => l.carbs_g),
    fat_g: sum(l => l.fat_g),
    meals: new Set(logs.map(l => l.meal)).size,
  }
}
