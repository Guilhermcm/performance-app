import { loadTacoMeasures } from './taco'
import type { FoodItem, FoodLog, Measure, MeasureOption, UserFood } from './types'

type Suggested = { label: string; grams: number }

// Same shape the server checks in food_measures.food_key.
const ID = /^[A-Za-z0-9-]{1,64}$/

const isSaved = (i: FoodItem | UserFood | FoodLog): i is UserFood => 'favorite' in i && typeof (i as UserFood).id === 'string'

// The key a personal measure is stored under: the TACO id, the OFF barcode, or `custom:<user_foods.id>`.
// Quick entries, imports and anything without a stable id (a custom food not saved yet, a log of one)
// have none, so no measure can be made for them.
export function foodKey(item: FoodItem | UserFood | FoodLog): string | null {
  const { source } = item
  if (source !== 'taco' && source !== 'off' && source !== 'custom') return null
  // A saved custom food is known by its row id; the FoodLog id and the item name never count.
  const id = source === 'custom' && isSaved(item) ? item.id : item.source_id
  return id && ID.test(id) ? `${source}:${id}` : null
}

const norm = (s: string) => s.trim().toLowerCase()

// The chips of a food in the order the portion row shows them: personal, suggested, the label
// serving, last time. A suggested measure a personal one repeats by name is hidden. `personal` is
// what measuresFor(foodKey(item)) returns.
export function mergeMeasures(personal: Measure[], suggested: Suggested[], item: FoodItem): MeasureOption[] {
  const out: MeasureOption[] = personal.map(m => ({ label: m.label, grams: m.grams, kind: 'personal', id: m.id }))
  const taken = new Set(personal.map(m => norm(m.label)))
  for (const s of suggested) {
    if (!taken.has(norm(s.label))) out.push({ label: s.label, grams: s.grams, kind: 'suggested' })
  }
  const g = item.serving_g
  if (g != null && g > 0) {
    // From recents() serving_g is the amount logged last time; otherwise it is the label's own serving.
    if (item.recent) out.push({ label: `${g} g`, grams: g, kind: 'last' })
    else if (item.serving_label) out.push({ label: item.serving_label, grams: g, kind: 'serving' })
  }
  return out
}

// Suggested measures by TACO id, loaded on demand with the TACO data.
export function loadSuggested(): Promise<Record<string, Suggested[]>> {
  return loadTacoMeasures()
}
