import type { FoodItem } from './types'

let cache: Promise<FoodItem[]> | null = null

/** Loads the TACO table on demand (separate chunk); memoized. */
export function loadTaco(): Promise<FoodItem[]> {
  cache ??= import('./data/taco.json').then((m) => m.default as FoodItem[])
  return cache
}
