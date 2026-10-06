import { describe, it, expect } from 'vitest'
import { normalize, matches, searchLocal } from './search'
import type { FoodItem, UserFood } from './types'

const item = (name: string, source: FoodItem['source'] = 'taco', id: string | null = name): FoodItem => ({
  source, source_id: id, name, brand: null,
  per100: { kcal: 100, protein: 1, carbs: 1, fat: 1 }, serving_g: null, serving_label: null, barcode: null
})
const mine = (name: string, favorite = false): UserFood => ({
  ...item(name, 'custom', `u-${name}`), id: `u-${name}`, favorite, updated_at: '2026-10-05T00:00:00Z'
})
const taco = [item('Arroz, tipo 1, cozido'), item('Feijão, carioca, cozido'), item('Arroz, integral, cru')]

describe('normalize and matches', () => {
  it('strips accents, lowercases and collapses spaces', () => {
    expect(normalize('  Feijão   CARIOCA ')).toBe('feijao carioca')
  })
  it('requires every query word to prefix some name word', () => {
    expect(matches('arroz coz', 'Arroz, tipo 1, cozido')).toBe(true)
    expect(matches('roz', 'Arroz')).toBe(false)
    expect(matches('arroz xyz', 'Arroz, tipo 1, cozido')).toBe(false)
    expect(matches('', 'Arroz')).toBe(false)
  })
})

describe('searchLocal', () => {
  const src = { recents: [] as FoodItem[], foods: [] as UserFood[], taco }
  it('finds feijao and arroz coz in taco', () => {
    expect(searchLocal('feijao', src)[0].items[0].name).toBe('Feijão, carioca, cozido')
    const r = searchLocal('arroz coz', src)
    expect(r).toHaveLength(1)
    expect(r[0].key).toBe('taco')
    expect(r[0].items.map((i) => i.name)).toEqual(['Arroz, tipo 1, cozido'])
  })
  it('orders recent, favorite, mine, taco and dedupes to the first section', () => {
    const recent = item('Arroz, tipo 1, cozido')
    const fav = mine('Arroz da casa', true)
    const own = mine('Arroz caseiro')
    const r = searchLocal('arroz', { recents: [recent], foods: [own, fav], taco })
    expect(r.map((s) => s.key)).toEqual(['recent', 'favorite', 'mine', 'taco'])
    expect(r[3].items.map((i) => i.name)).toEqual(['Arroz, integral, cru'])
    expect(r[1].items[0].name).toBe('Arroz da casa')
  })
  it('Meus alimentos holds only custom foods; a starred one shows once, under Favoritos', () => {
    const snapshot: UserFood = { ...item('Arroz branco', 'taco', 'taco-9'), id: 'snap', favorite: false, updated_at: '2026-10-05T00:00:00Z' }
    const starredCustom = mine('Arroz da casa', true)
    const own = mine('Arroz caseiro')
    const r = searchLocal('arroz', { recents: [], foods: [snapshot, starredCustom, own], taco: [] })
    expect(r.map((x) => x.key)).toEqual(['favorite', 'mine'])
    expect(r[0].items.map((i) => i.name)).toEqual(['Arroz da casa'])
    expect(r[1].items.map((i) => i.name)).toEqual(['Arroz caseiro'])
    expect(r.flatMap((x) => x.items).some((i) => i.name === 'Arroz branco')).toBe(false)
  })
  it('respects the limit and omits empty sections', () => {
    const many = Array.from({ length: 50 }, (_, i) => item(`Arroz ${i}`, 'taco', `a${i}`))
    const r = searchLocal('arroz', { recents: [], foods: [], taco: many }, 10)
    expect(r.reduce((n, s) => n + s.items.length, 0)).toBe(10)
    expect(searchLocal('zzz', src)).toEqual([])
  })
  it('ranks names starting with the query first', () => {
    const r = searchLocal('cozido', { recents: [], foods: [], taco: [item('Batata, cozida'), item('Cozido de legumes')] })
    expect(r[0].items[0].name).toBe('Cozido de legumes')
  })
})
