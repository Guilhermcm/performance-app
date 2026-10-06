import type { FoodItem, UserFood } from './types'

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Every query word is a prefix of some word in the name. */
export function matches(query: string, name: string): boolean {
  const q = normalize(query).split(' ').filter(Boolean)
  if (!q.length) return false
  const words = normalize(name).split(' ')
  return q.every((w) => words.some((n) => n.startsWith(w)))
}

export type SearchSection = { key: 'recent' | 'favorite' | 'mine' | 'taco'; items: FoodItem[] }

const keyOf = (i: FoodItem) => `${i.source}:${i.source_id ?? normalize(i.name)}`

export function searchLocal(
  q: string,
  src: { recents: FoodItem[]; foods: UserFood[]; taco: FoodItem[] },
  limit = 30
): SearchSection[] {
  const nq = normalize(q)
  const rank = (a: FoodItem, b: FoodItem) => {
    const sa = normalize(a.name).startsWith(nq) ? 0 : 1
    const sb = normalize(b.name).startsWith(nq) ? 0 : 1
    return sa - sb
  }
  const groups: SearchSection[] = [
    { key: 'recent', items: src.recents },
    { key: 'favorite', items: src.foods.filter((f) => f.favorite) },
    { key: 'mine', items: src.foods.filter((f) => !f.favorite) },
    { key: 'taco', items: src.taco }
  ]
  const seen = new Set<string>()
  let left = limit
  const out: SearchSection[] = []
  for (const g of groups) {
    if (left <= 0) break
    const items = g.items.filter((i) => matches(q, i.name)).sort(rank).filter((i) => {
      const k = keyOf(i)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, left)
    if (items.length) { out.push({ key: g.key, items }); left -= items.length }
  }
  return out
}
