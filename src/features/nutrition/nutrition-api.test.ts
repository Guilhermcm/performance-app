import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import * as api from './nutrition-api'
import { foodOf, logOf, measureOf, targetOf } from './test-nutrition'

function chain(result: { data?: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy }
    }
  })
  return { proxy, calls }
}

beforeEach(() => { h.rpc.mockReset(); h.from.mockReset() })

describe('nutrition api', () => {
  it('upserts a log with its own updated_at and no user id', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    const l = logOf({ id: 'a' })
    await api.upsertLog(l)
    expect(h.from).toHaveBeenCalledWith('food_logs')
    const [name, [row]] = c.calls.find(x => x[0] === 'upsert')! as [string, [Record<string, unknown>]]
    expect(name).toBe('upsert')
    expect(row).toMatchObject({ id: 'a', day: l.day, kcal: l.kcal, updated_at: l.updated_at })
    expect(row).not.toHaveProperty('user_id')
  })

  it('reads logs of a range and maps rows', async () => {
    const c = chain({ data: [{ ...logOf({ id: 'a' }), user_id: 'u', created_at: 'x', kcal: '190' }], error: null })
    h.from.mockReturnValue(c.proxy)
    const out = await api.fetchLogs('2026-09-21', '2026-10-05')
    expect(c.calls).toContainEqual(['gte', ['day', '2026-09-21']])
    expect(c.calls).toContainEqual(['lte', ['day', '2026-10-05']])
    expect(out[0].kcal).toBe(190)
    expect(out[0]).not.toHaveProperty('user_id')
  })

  it('maps saved foods to and from per 100 g columns', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.upsertFood(foodOf({ id: 'f' }))
    const row = (c.calls.find(x => x[0] === 'upsert')![1] as [Record<string, unknown>])[0]
    expect(row).toMatchObject({ id: 'f', kcal_100g: 128, protein_100g: 2.5, carbs_100g: 28, fat_100g: 0.2 })

    const d = chain({ data: [{ id: 'f', user_id: 'u', source: 'custom', source_id: null, barcode: null, favorite: true, name: 'Bolo', brand: null,
      kcal_100g: 300, protein_100g: 5, carbs_100g: 50, fat_100g: 9, serving_g: 60, serving_label: '1 fatia', created_at: 'x', updated_at: 'y' }], error: null })
    h.from.mockReturnValue(d.proxy)
    expect((await api.fetchFoods())[0]).toEqual({
      id: 'f', source: 'custom', source_id: null, barcode: null, favorite: true, name: 'Bolo', brand: null,
      per100: { kcal: 300, protein: 5, carbs: 50, fat: 9 }, serving_g: 60, serving_label: '1 fatia', updated_at: 'y'
    })
  })

  it('deletes by id and inserts targets', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.deleteLog('a')
    expect(c.calls).toContainEqual(['eq', ['id', 'a']])
    await api.insertTarget(targetOf({ valid_from: '2026-10-06' }))
    expect(h.from).toHaveBeenLastCalledWith('nutrition_targets')
  })

  it('upserts a measure with its own updated_at and no user id, and deletes by id', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.upsertMeasure(measureOf({ id: 'm', food_key: 'taco:1', label: 'concha', grams: 117.5 }))
    expect(h.from).toHaveBeenCalledWith('food_measures')
    const row = (c.calls.find(x => x[0] === 'upsert')![1] as [Record<string, unknown>])[0]
    expect(row).toEqual({ id: 'm', food_key: 'taco:1', label: 'concha', grams: 117.5, updated_at: '2026-10-05T12:00:00.000Z' })
    await api.deleteMeasure('m')
    expect(c.calls).toContainEqual(['eq', ['id', 'm']])
  })

  it('reads measures and turns numeric grams into numbers', async () => {
    const c = chain({ data: [{ id: 'm', user_id: 'u', food_key: 'off:789', label: 'copo', grams: '200.0', created_at: 'x', updated_at: 'y' }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchMeasures()).resolves.toEqual([{ id: 'm', food_key: 'off:789', label: 'copo', grams: 200, updated_at: 'y' }])
    expect(h.from).toHaveBeenCalledWith('food_measures')
  })

  it('treats too_many_measures as a refusal for good', async () => {
    expect(api.isRefused({ message: 'too_many_measures' })).toBe(true)
    const c = chain({ error: { code: 'P0001', message: 'too_many_measures' } }); h.from.mockReturnValue(c.proxy)
    await expect(api.upsertMeasure(measureOf())).rejects.toMatchObject({ refused: true, reason: 'refused' })
  })

  it('calls get_nutrition_days with the range', async () => {
    h.rpc.mockResolvedValue({ data: { target: null, days: [] }, error: null })
    await expect(api.fetchDays('2026-09-21', '2026-10-05')).resolves.toEqual({ target: null, days: [], weeks: [] })
    expect(h.rpc).toHaveBeenCalledWith('get_nutrition_days', { p_from: '2026-09-21', p_to: '2026-10-05' })
  })

  it('turns server errors into typed codes and the rest into network', async () => {
    expect(api.toNutritionError({ message: 'day_closed' })).toBe('day_closed')
    expect(api.toNutritionError({ message: 'too_many_items' })).toBe('too_many_items')
    expect(api.toNutritionError(new TypeError('Failed to fetch'))).toBe('network')
    const c = chain({ error: { message: 'day_closed' } }); h.from.mockReturnValue(c.proxy)
    await expect(api.upsertLog(logOf())).rejects.toMatchObject({ code: 'day_closed' })
    expect(api.isRefused({ message: 'item_immutable' })).toBe(true)
    expect(api.isRefused({ message: 'boom' })).toBe(false)
  })
})
