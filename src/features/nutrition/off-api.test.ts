import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { offToItem, searchOff, productByCode, _clearOffCache } from './off-api'

const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as Response
const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true })

beforeEach(() => { _clearOffCache(); setOnline(true) })
afterEach(() => { vi.unstubAllGlobals(); setOnline(true) })

describe('offToItem', () => {
  it('uses kcal when present', () => {
    const it = offToItem({ code: '7891234567890', product_name: 'Whey', brands: 'Marca, Outra', nutriments: { 'energy-kcal_100g': 400, proteins_100g: 80, carbohydrates_100g: 5, fat_100g: 6, fiber_100g: 1 }, serving_quantity: '30', serving_size: '30 g' })
    expect(it).toMatchObject({ source: 'off', source_id: '7891234567890', barcode: '7891234567890', name: 'Whey', brand: 'Marca', serving_g: 30, serving_label: '30 g' })
    expect(it!.per100).toEqual({ kcal: 400, protein: 80, carbs: 5, fat: 6, fiber: 1 })
  })
  it('converts kJ only by 4.184', () => {
    const it = offToItem({ code: '1', product_name: 'X', nutriments: { energy_100g: 418.4 } })
    expect(it!.per100.kcal).toBeCloseTo(100, 5)
    expect(it!.per100.protein).toBe(0)
    expect(it!.per100.fiber).toBeNull()
  })
  it('accepts numeric strings with comma', () => {
    const it = offToItem({ code: '1', product_name: 'X', nutriments: { 'energy-kcal_100g': '120,5', proteins_100g: '12,5' } })
    expect(it!.per100.kcal).toBe(120.5)
    expect(it!.per100.protein).toBe(12.5)
  })
  it('discards without kcal or without a name, falls back to product_name_pt', () => {
    expect(offToItem({ code: '1', product_name: 'X', nutriments: { proteins_100g: 3 } })).toBeNull()
    expect(offToItem({ code: '1', product_name: '  ', nutriments: { 'energy-kcal_100g': 10 } })).toBeNull()
    expect(offToItem({ code: '1', product_name: '', product_name_pt: 'Pão', nutriments: { 'energy-kcal_100g': 10 } })!.name).toBe('Pão')
    expect(offToItem(null)).toBeNull()
    expect(offToItem({ product_name: 'X', nutriments: { 'energy-kcal_100g': 10 } })).toBeNull()
    expect(offToItem({ code: '1', product_name: 'X' })).toBeNull()
  })
})

describe('offToItem sanitising', () => {
  const k = { 'energy-kcal_100g': 100 }
  const mk = (over: Record<string, unknown> = {}, n: Record<string, unknown> = {}) =>
    offToItem({ code: '7891234567890', product_name: 'X', nutriments: { ...k, ...n }, ...over })
  it('truncates name to 120, brand to 80 and serving label to 40, trimmed', () => {
    const it = mk({ product_name: 'a'.repeat(119) + ' ' + 'b'.repeat(30), brands: 'm'.repeat(90) + ',z', serving_size: 's'.repeat(39) + ' ' + 'x'.repeat(9) })!
    expect(it.name).toHaveLength(119)
    expect(it.brand).toHaveLength(80)
    expect(it.serving_label).toHaveLength(39)
  })
  it('keeps the barcode only when it has 8 to 14 digits', () => {
    expect(mk()!.barcode).toBe('7891234567890')
    expect(mk({ code: '12345678' })!.barcode).toBe('12345678')
    expect(mk({ code: '1234567' })!.barcode).toBeNull()
    expect(mk({ code: '123456789012345' })!.barcode).toBeNull()
    expect(mk({ code: 'abc12345678' })!.barcode).toBeNull()
    expect(mk({ code: '1234567' })!.source_id).toBe('1234567')
  })
  it('discards implausible kcal', () => {
    expect(mk({}, { 'energy-kcal_100g': 901 })).toBeNull()
    expect(mk({}, { 'energy-kcal_100g': 900 })).not.toBeNull()
    expect(mk({}, { 'energy-kcal_100g': -1 })).toBeNull()
    expect(mk({}, { 'energy-kcal_100g': undefined, energy_100g: 4000 })).toBeNull()
  })
  it('discards macros outside 0..100 or summing over 100', () => {
    expect(mk({}, { proteins_100g: 101 })).toBeNull()
    expect(mk({}, { carbohydrates_100g: -0.1 })).toBeNull()
    expect(mk({}, { fat_100g: 100.5 })).toBeNull()
    expect(mk({}, { proteins_100g: 40, carbohydrates_100g: 40, fat_100g: 20.1 })).toBeNull()
    expect(mk({}, { proteins_100g: 40, carbohydrates_100g: 40, fat_100g: 20 })).not.toBeNull()
  })
  it('nulls a serving above 2000 g or not positive', () => {
    expect(mk({ serving_quantity: 2001 })!.serving_g).toBeNull()
    expect(mk({ serving_quantity: 2000 })!.serving_g).toBe(2000)
    expect(mk({ serving_quantity: 0 })!.serving_g).toBeNull()
    expect(mk({ serving_quantity: -5 })!.serving_g).toBeNull()
  })
})

describe('aborted requests', () => {
  it('are not errors to show: both calls answer aborted', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
    expect(await searchOff('abort me', new AbortController().signal)).toEqual({ error: 'aborted' })
    expect(await productByCode('7891234567890')).toEqual({ error: 'aborted' })
  })
  it('also when the signal is already aborted', async () => {
    const c = new AbortController(); c.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await searchOff('abort two', c.signal)).toEqual({ error: 'aborted' })
    expect(await productByCode('7891234567890', c.signal)).toEqual({ error: 'aborted' })
  })
  it('an aborted search is not cached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('a'), { name: 'AbortError' })))
    await searchOff('same')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ products: [{ code: '1', product_name: 'A', nutriments: { 'energy-kcal_100g': 5 } }] })))
    expect(await searchOff('same')).toMatchObject({ items: [{ name: 'A' }] })
  })
})

describe('searchOff', () => {
  it('uses the cgi/search.pl endpoint and drops products without kcal', async () => {
    const f = vi.fn().mockResolvedValue(json({ products: [
      { code: '1', product_name: 'A', nutriments: { 'energy-kcal_100g': 50 } },
      { code: '2', product_name: 'B', nutriments: {} }
    ] }))
    vi.stubGlobal('fetch', f)
    const r = await searchOff('arroz')
    expect(r).toMatchObject({ items: [{ name: 'A' }] })
    const url = String(f.mock.calls[0][0])
    expect(url).toContain('https://world.openfoodfacts.org/cgi/search.pl?')
    expect(url).toContain('search_terms=arroz')
    expect(url).toContain('page_size=20')
  })
  it('maps 429 to rate_limited and other failures to failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 429)))
    expect(await searchOff('a')).toEqual({ error: 'rate_limited' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 500)))
    expect(await searchOff('b')).toEqual({ error: 'failed' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')))
    expect(await searchOff('c')).toEqual({ error: 'failed' })
  })
  it('returns offline without fetching', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f); setOnline(false)
    expect(await searchOff('arroz')).toEqual({ error: 'offline' })
    expect(f).not.toHaveBeenCalled()
  })
  it('caches by term for the session', async () => {
    const f = vi.fn().mockResolvedValue(json({ products: [] })); vi.stubGlobal('fetch', f)
    await searchOff('Arroz'); await searchOff(' arroz ')
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('productByCode', () => {
  it('returns the item, null when status 0 or no kcal, errors otherwise', async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ status: 1, product: { code: '9', product_name: 'P', nutriments: { 'energy-kcal_100g': 9 } } }))
      .mockResolvedValueOnce(json({ status: 0 }, 404))
      .mockResolvedValueOnce(json({ status: 1, product: { code: '9', product_name: 'P', nutriments: {} } }))
      .mockResolvedValueOnce(json({}, 500))
    vi.stubGlobal('fetch', f)
    expect(await productByCode('9')).toMatchObject({ name: 'P' })
    expect(String(f.mock.calls[0][0])).toContain('/api/v2/product/9.json')
    expect(await productByCode('8')).toBeNull()
    expect(await productByCode('7')).toBeNull()
    expect(await productByCode('6')).toEqual({ error: 'failed' })
    setOnline(false)
    expect(await productByCode('5')).toEqual({ error: 'offline' })
  })
})
