import type { FoodItem, FoodLog, NutritionTarget, UserFood } from './types'

export const ME = '00000000-0000-0000-0000-00000000000a'
export const OTHER = '00000000-0000-0000-0000-00000000000b'

let n = 0
export const logOf = (over: Partial<FoodLog> = {}): FoodLog => ({
  id: `log-${++n}`, day: '2026-10-05', meal: 'lunch', name: 'Arroz', brand: null, source: 'taco', source_id: 'taco-1',
  grams: 150, kcal: 190, protein_g: 4, carbs_g: 41, fat_g: 0.4, fiber_g: 1.2, updated_at: '2026-10-05T12:00:00.000Z', ...over
})

export const itemOf = (over: Partial<FoodItem> = {}): FoodItem => ({
  source: 'taco', source_id: 'taco-1', name: 'Arroz', brand: null,
  per100: { kcal: 128, protein: 2.5, carbs: 28, fat: 0.2 }, serving_g: null, serving_label: null, barcode: null, ...over
})

export const foodOf = (over: Partial<UserFood> = {}): UserFood =>
  ({ ...itemOf(), id: `food-${++n}`, favorite: false, updated_at: '2026-10-05T12:00:00.000Z', ...over })

export const targetOf = (over: Partial<NutritionTarget> = {}): NutritionTarget =>
  ({ valid_from: '2026-10-01', mode: 'auto', kcal: 2400, protein_g: 160, carbs_g: 270, fat_g: 70, ...over })
