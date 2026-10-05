// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const api = vi.hoisted(() => ({
  fetchLogs: vi.fn(), fetchFoods: vi.fn(), fetchTargets: vi.fn(), fetchDays: vi.fn(), insertTarget: vi.fn(),
  upsertLog: vi.fn(), deleteLog: vi.fn(), upsertFood: vi.fn(), deleteFood: vi.fn()
}))
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), ...api }))
const progress = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => progress } }))

import { useNutrition } from './useNutrition'
import { clearOutbox } from './outbox'
import { ME, foodOf, itemOf, logOf, targetOf } from './test-nutrition'

const TODAY = '2026-10-05', YESTERDAY = '2026-10-04'
const cache = () => JSON.parse(localStorage.getItem('perf_nutrition_v1') || 'null')
const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear(); clearOutbox()
  useNutrition.getState().reset()
  Object.values(api).forEach(f => f.mockReset().mockResolvedValue(undefined))
  progress.refresh.mockReset()
  api.fetchLogs.mockResolvedValue([]); api.fetchFoods.mockResolvedValue([]); api.fetchTargets.mockResolvedValue([])
  api.fetchDays.mockResolvedValue({ target: null, days: [] })
})

async function bound() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0))
  await useNutrition.getState().bind(ME)
}

describe('useNutrition', () => {
  it('shows the saved copy at once and marks it stale', async () => {
    const l = logOf({ id: 'a', day: TODAY })
    localStorage.setItem('perf_nutrition_v1', JSON.stringify({ userId: ME, logs: { [TODAY]: [l] }, foods: [], targets: [targetOf()], closed: [] }))
    let release!: (v: unknown[]) => void
    api.fetchLogs.mockReturnValue(new Promise(r => { release = r }))
    const p = useNutrition.getState().bind(ME)
    const s = useNutrition.getState()
    expect(s.userId).toBe(ME)
    expect(s.status).toBe('ready'); expect(s.stale).toBe(true)
    expect(s.logs[TODAY]).toEqual([l])
    release([]); await p
    expect(useNutrition.getState().stale).toBe(false)
    expect(useNutrition.getState().logs[TODAY] ?? []).toEqual([])
  })

  it('ignores a saved copy that belongs to someone else', async () => {
    localStorage.setItem('perf_nutrition_v1', JSON.stringify({ userId: 'x', logs: { [TODAY]: [logOf()] }, foods: [], targets: [], closed: [] }))
    api.fetchLogs.mockReturnValue(new Promise(() => {}))
    void useNutrition.getState().bind(ME)
    expect(useNutrition.getState().logs).toEqual({})
    expect(useNutrition.getState().status).toBe('loading')
  })

  it('adds items locally before the server answers', async () => {
    await bound()
    let release!: () => void
    api.upsertLog.mockReturnValue(new Promise<void>(r => { release = r }))
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    const added = useNutrition.getState().addLog(rest)
    expect(added.id).toBeTruthy(); expect(added.updated_at).toBe(new Date().toISOString())
    expect(useNutrition.getState().logs[TODAY]).toEqual([added])
    expect(cache().logs[TODAY]).toHaveLength(1)
    await settle()
    expect(api.upsertLog).toHaveBeenCalledWith(added)
    release(); await settle()
  })

  it('updates and removes items, and restores a removed one', async () => {
    await bound()
    const { id, updated_at, ...rest } = logOf({ day: TODAY, grams: 100, kcal: 100 })
    const a = useNutrition.getState().addLog(rest)
    useNutrition.getState().updateLog(a.id, { kcal: 250 })
    expect(useNutrition.getState().logs[TODAY][0].kcal).toBe(250)
    const gone = useNutrition.getState().removeLog(a.id)!
    expect(gone.kcal).toBe(250)
    expect(useNutrition.getState().logs[TODAY]).toEqual([])
    useNutrition.getState().restoreLog(gone)
    expect(useNutrition.getState().logs[TODAY]).toHaveLength(1)
    expect(useNutrition.getState().removeLog('nope')).toBeUndefined()
  })

  it('copies a meal as new items keeping origin and nutrients', async () => {
    await bound()
    const src = logOf({ id: 's1', day: YESTERDAY, meal: 'lunch', source: 'off', source_id: '789', name: 'Whey', brand: 'X', grams: 30, kcal: 120, protein_g: 24 })
    const other = logOf({ id: 's2', day: YESTERDAY, meal: 'dinner' })
    api.fetchLogs.mockResolvedValue([src, other])
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().copyMeal(YESTERDAY, 'lunch', TODAY, 'snack')).toBe(1)
    const [copy] = useNutrition.getState().logs[TODAY]
    expect(copy.id).not.toBe('s1')
    expect(copy).toMatchObject({ day: TODAY, meal: 'snack', source: 'off', source_id: '789', name: 'Whey', brand: 'X', grams: 30, kcal: 120, protein_g: 24 })
    expect(useNutrition.getState().logs[YESTERDAY]).toHaveLength(2)
  })

  it('copies a whole day', async () => {
    await bound()
    api.fetchLogs.mockResolvedValue([logOf({ day: YESTERDAY, meal: 'lunch' }), logOf({ day: YESTERDAY, meal: 'dinner' })])
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().copyDay(YESTERDAY, TODAY)).toBe(2)
    expect(useNutrition.getState().logs[TODAY].map(l => l.meal).sort()).toEqual(['dinner', 'lunch'])
    expect(useNutrition.getState().copyDay('2026-01-01', TODAY)).toBe(0)
  })

  it('lists 50 distinct recents, newest first', async () => {
    await bound()
    const logs = Array.from({ length: 60 }, (_, i) =>
      logOf({ day: i < 30 ? TODAY : YESTERDAY, source_id: `t${i % 55}`, name: `Item ${i % 55}`, grams: 100, kcal: 100,
        updated_at: new Date(2026, 9, 5, 0, 0, i).toISOString() }))
    logs.push(logOf({ source: 'quick', source_id: null, name: 'Quick', grams: null }))
    api.fetchLogs.mockResolvedValue(logs)
    await useNutrition.getState().refresh()
    const r = useNutrition.getState().recents()
    expect(r).toHaveLength(50)
    expect(new Set(r.map(x => x.source_id)).size).toBe(50)
    expect(r[0].name).toBe('Item 4')
    expect(r.some(x => x.name === 'Quick')).toBe(false)
    expect(r[0].per100.kcal).toBe(100)
  })

  it('finds the target in force on a day', async () => {
    await bound()
    api.fetchTargets.mockResolvedValue([targetOf({ valid_from: '2026-10-01', kcal: 2000 }), targetOf({ valid_from: '2026-10-06', kcal: 2200 })])
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().targetOn(TODAY)?.kcal).toBe(2000)
    expect(useNutrition.getState().targetOn('2026-10-06')?.kcal).toBe(2200)
    expect(useNutrition.getState().targetOn('2026-09-01')).toBeNull()
  })

  it('stores a new target and saves foods and favorites', async () => {
    await bound()
    await useNutrition.getState().setTarget({ kcal: 2300, protein_g: 150, carbs_g: 250, fat_g: 70, mode: 'auto' }, '2026-10-06')
    expect(api.insertTarget).toHaveBeenCalledWith({ kcal: 2300, protein_g: 150, carbs_g: 250, fat_g: 70, mode: 'auto', valid_from: '2026-10-06' })
    expect(useNutrition.getState().targetOn('2026-10-06')?.kcal).toBe(2300)

    const { id, updated_at, favorite, ...food } = foodOf({ source: 'custom', source_id: null, name: 'Bolo' })
    const f = useNutrition.getState().saveFood({ ...food, favorite: false })
    expect(useNutrition.getState().foods).toEqual([f])
    useNutrition.getState().toggleFavorite(itemOf({ source: 'custom', source_id: null, name: 'Bolo' }))
    expect(useNutrition.getState().foods[0].favorite).toBe(true)
    useNutrition.getState().toggleFavorite(itemOf({ source_id: 'taco-9', name: 'Feijão' }))
    expect(useNutrition.getState().foods).toHaveLength(2)
    expect(useNutrition.getState().foods.find(x => x.name === 'Feijão')?.favorite).toBe(true)
  })

  it('raises the dropped notice once', async () => {
    await bound()
    api.upsertLog.mockRejectedValueOnce(Object.assign(new Error('day_closed'), { code: 'day_closed' }))
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    useNutrition.getState().addLog(rest)
    await settle(); await settle()
    expect(useNutrition.getState().droppedNotice).toBe(true)
    useNutrition.getState().dismissDropped()
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().droppedNotice).toBe(false)
  })

  it('keeps unsent changes over what the server returns', async () => {
    await bound()
    api.upsertLog.mockRejectedValue(new TypeError('Failed to fetch'))
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    const a = useNutrition.getState().addLog(rest)
    await settle()
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().logs[TODAY].map(l => l.id)).toEqual([a.id])
  })

  it('marks the copy stale when the server cannot be reached', async () => {
    await bound()
    api.fetchLogs.mockRejectedValue(new TypeError('Failed to fetch'))
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().stale).toBe(true)
    expect(useNutrition.getState().status).toBe('ready')
  })

  it('drops everything on reset', async () => {
    await bound()
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    api.upsertLog.mockRejectedValue(new TypeError('Failed to fetch'))
    useNutrition.getState().addLog(rest)
    useNutrition.getState().reset()
    const s = useNutrition.getState()
    expect(s.userId).toBeNull(); expect(s.logs).toEqual({}); expect(s.foods).toEqual([]); expect(s.targets).toEqual([])
    expect(s.status).toBe('idle')
    expect(cache()).toBeNull()
  })
})
