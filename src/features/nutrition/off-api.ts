import type { FoodItem } from './types'

// Text search uses cgi/search.pl; the search.openfoodfacts.org comparison is pending live access.
const FIELDS = 'code,product_name,product_name_pt,brands,nutriments,serving_quantity,serving_size'
const BASE = 'https://world.openfoodfacts.org'

export type OffResult = { items: FoodItem[] } | { error: 'rate_limited' | 'offline' | 'failed' }

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function offToItem(p: unknown): FoodItem | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  const code = str(o.code) || (typeof o.code === 'number' ? String(o.code) : '')
  const name = str(o.product_name) || str(o.product_name_pt)
  if (!code || !name) return null
  const n = (o.nutriments && typeof o.nutriments === 'object' ? o.nutriments : {}) as Record<string, unknown>
  const kj = num(n.energy_100g) ?? num(n['energy-kj_100g'])
  const kcal = num(n['energy-kcal_100g']) ?? (kj != null ? kj / 4.184 : null)
  if (kcal == null) return null
  const serving = num(o.serving_quantity)
  return {
    source: 'off',
    source_id: code,
    name,
    brand: str(o.brands).split(',')[0].trim() || null,
    per100: {
      kcal,
      protein: num(n.proteins_100g) ?? 0,
      carbs: num(n.carbohydrates_100g) ?? 0,
      fat: num(n.fat_100g) ?? 0,
      fiber: num(n.fiber_100g)
    },
    serving_g: serving != null && serving > 0 ? serving : null,
    serving_label: str(o.serving_size) || null,
    barcode: code
  }
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

const cache = new Map<string, OffResult>()
export function _clearOffCache() { cache.clear() }

export async function searchOff(q: string, signal?: AbortSignal): Promise<OffResult> {
  const term = q.trim().toLowerCase()
  if (!term) return { items: [] }
  const hit = cache.get(term)
  if (hit) return hit
  if (isOffline()) return { error: 'offline' }
  try {
    const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&json=1&page_size=20&cc=br&lc=pt&fields=${FIELDS}`
    const res = await fetch(url, { signal })
    if (res.status === 429) return { error: 'rate_limited' }
    if (!res.ok) return { error: 'failed' }
    const body = (await res.json()) as { products?: unknown[] }
    const items = (Array.isArray(body.products) ? body.products : []).map(offToItem).filter((i): i is FoodItem => i != null)
    const r = { items }
    cache.set(term, r)
    return r
  } catch {
    return { error: 'failed' }
  }
}

export async function productByCode(code: string, signal?: AbortSignal): Promise<FoodItem | null | { error: 'offline' | 'failed' }> {
  if (isOffline()) return { error: 'offline' }
  try {
    const res = await fetch(`${BASE}/api/v2/product/${encodeURIComponent(code.trim())}.json?fields=${FIELDS}`, { signal })
    if (res.status === 404) return null
    if (!res.ok) return { error: 'failed' }
    const body = (await res.json()) as { status?: number; product?: unknown }
    if (body.status === 0 || !body.product) return null
    return offToItem({ code, ...(body.product as object) })
  } catch {
    return { error: 'failed' }
  }
}
