import type { FoodItem } from './types'

let cache: Promise<FoodItem[]> | null = null
let measures: Promise<Record<string, { label: string; grams: number }[]>> | null = null

/** Loads the TACO table on demand (separate chunk); memoized. */
export function loadTaco(): Promise<FoodItem[]> {
  cache ??= import('./data/taco.json').then((m) => m.default as FoodItem[])
  return cache
}

/** Loads the suggested household measures (POF) by TACO id, on demand like the table; memoized. */
export function loadTacoMeasures(): Promise<Record<string, { label: string; grams: number }[]>> {
  measures ??= import('./data/taco-measures.json').then((m) => m.default as Record<string, { label: string; grams: number }[]>)
  return measures
}
