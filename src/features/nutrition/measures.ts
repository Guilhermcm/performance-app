import { loadTacoMeasures } from './taco'
import { keyOf } from './useNutrition'
import { fmtDecimal } from './labels'
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

// The key for the portion sheet. A recent or a logged custom food carries no row id (the diary
// stores custom items with source_id null), so it is found among the saved foods the same way the
// favourite star finds it: by name and brand. A custom food that is not saved has no key.
export function measureKey(item: FoodItem | UserFood, foods: UserFood[]): string | null {
  const k = foodKey(item)
  if (k || item.source !== 'custom') return k
  const want = keyOf(item)
  const saved = foods.find(f => f.source === 'custom' && keyOf(f) === want)
  return saved ? foodKey(saved) : null
}

// Words that end a measure's head: "colher | de servir", "copo | de requeijão".
const PREP = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'para', 'em', 'no', 'na', 'à', 'ao'])
const ACCENT = /[áéíóúâêôãõ]/

function pluralWord(w: string): string {
  if (/\d/.test(w)) return w
  const low = w.toLowerCase()
  if (low === 'pão') return w.slice(0, -2) + 'ães'
  if (low.endsWith('ão')) return w.slice(0, -2) + 'ões'
  if (/[aeiouáéíóúâêô]$/.test(low)) return w + 's'
  if (/[rz]$/.test(low)) return w + 'es'
  if (low.endsWith('m')) return w.slice(0, -1) + 'ns'
  const stem = w.slice(0, -2)
  if (low.endsWith('al')) return stem + 'ais'
  if (low.endsWith('ol')) return stem + 'óis'
  if (low.endsWith('ul')) return stem + 'uis'
  if (low.endsWith('el')) return stem + (ACCENT.test(stem) ? 'eis' : 'éis')
  if (low.endsWith('il')) return stem + (ACCENT.test(stem) ? 'eis' : 'is')
  return w
}

// Plural of a Portuguese measure name: the words before the first preposition change
// ("colher de servir" -> "colheres de servir", "copo americano" -> "copos americanos").
export function pluralPt(label: string): string {
  const words = label.split(' ')
  let head = true
  return words.map(w => {
    if (!head || !w) return w
    if (PREP.has(w.toLowerCase())) { head = false; return w }
    return pluralWord(w)
  }).join(' ')
}

// "2 colheres de servir": a count and a measure name. Portuguese names agree with the count (singular
// below 2, as in pt-BR); a name the app cannot inflect is multiplied instead ("2 × scoop").
export function countedMeasure(qty: number, label: string, portuguese: boolean): string {
  const n = fmtDecimal(qty)
  if (!portuguese) return `${n} × ${label}`
  return `${n} ${qty >= 2 ? pluralPt(label) : label}`
}
