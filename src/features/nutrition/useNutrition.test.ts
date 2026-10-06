// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
const api = vi.hoisted(() => ({
  fetchLogs: vi.fn(), fetchFoods: vi.fn(), fetchTargets: vi.fn(), fetchDays: vi.fn(), insertTarget: vi.fn(),
  upsertLog: vi.fn(), deleteLog: vi.fn(), upsertFood: vi.fn(), deleteFood: vi.fn(),
  fetchMeasures: vi.fn(), upsertMeasure: vi.fn(), deleteMeasure: vi.fn()
}))
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), ...api }))
const progress = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => progress } }))

import { useNutrition, startNutritionSync } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { clearOutbox, pending } from './outbox'
import { clearNutritionLocal } from './sign-out'
import { ME, OTHER, foodOf, itemOf, logOf, measureOf, targetOf } from './test-nutrition'

const TODAY = '2026-10-05', YESTERDAY = '2026-10-04'
const cache = () => JSON.parse(localStorage.getItem('perf_nutrition_v1') || 'null')
const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear(); clearOutbox()
  useNutrition.getState().reset()
  Object.values(api).forEach(f => f.mockReset().mockResolvedValue(undefined))
  progress.refresh.mockReset()
  api.fetchLogs.mockResolvedValue([]); api.fetchFoods.mockResolvedValue([]); api.fetchTargets.mockResolvedValue([]); api.fetchMeasures.mockResolvedValue([])
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

  it('copies from logs handed in, for days older than the ones kept on the phone', async () => {
    await bound()
    const old = logOf({ id: 'r1', day: '2026-09-15', meal: 'lunch', source: 'custom', source_id: null, name: 'Tapioca', grams: 80, kcal: 210 })
    const dinner = logOf({ id: 'r2', day: '2026-09-15', meal: 'dinner', name: 'Sopa' })
    expect(useNutrition.getState().copyMeal('2026-09-15', 'lunch', TODAY, 'breakfast', [old, dinner])).toBe(1)
    expect(useNutrition.getState().logs[TODAY][0]).toMatchObject({ meal: 'breakfast', source: 'custom', name: 'Tapioca', grams: 80, kcal: 210 })
    expect(useNutrition.getState().copyDay('2026-09-15', TODAY, [old, dinner])).toBe(2)
    expect(useNutrition.getState().logs[TODAY]).toHaveLength(3)
  })

  it('marks recents so the portion can name the last amount, and keeps that mark out of saved foods', async () => {
    await bound()
    api.fetchLogs.mockResolvedValue([logOf({ day: TODAY, source_id: 'taco-3', name: 'Feijão', grams: 120, kcal: 90 })])
    await useNutrition.getState().refresh()
    const [r] = useNutrition.getState().recents()
    expect(r).toMatchObject({ recent: true, serving_g: 120 })
    useNutrition.getState().toggleFavorite(r)
    expect(useNutrition.getState().foods[0]).not.toHaveProperty('recent')
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

  it('says why items were dropped: day_closed only when every drop was a closed day', async () => {
    await bound()
    const add = () => { const { id, updated_at, ...rest } = logOf({ day: TODAY }); useNutrition.getState().addLog(rest) }
    api.upsertLog.mockRejectedValueOnce(Object.assign(new Error('day_closed'), { code: 'P0001' }))
    add(); await settle(); await settle()
    expect(useNutrition.getState()).toMatchObject({ droppedNotice: true, droppedReason: 'day_closed' })
    useNutrition.getState().dismissDropped()
    expect(useNutrition.getState().droppedReason).toBeNull()
    api.upsertLog.mockRejectedValueOnce(Object.assign(new Error('too_many_items'), { code: 'P0001' }))
    add(); await settle(); await settle()
    expect(useNutrition.getState()).toMatchObject({ droppedNotice: true, droppedReason: 'refused' })
    api.upsertLog.mockRejectedValueOnce(Object.assign(new Error('day_closed'), { code: 'P0001' }))
    add(); await settle(); await settle()
    expect(useNutrition.getState().droppedReason).toBe('refused')
  })

  it("pulls the window of the profile's day, not the device's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T16:30:00Z'))
    useProfile.setState({ profile: { timezone: 'Asia/Tokyo' } as never })
    await useNutrition.getState().bind(ME)
    expect(api.fetchLogs).toHaveBeenLastCalledWith('2026-09-22', '2026-10-06')
    useNutrition.getState().reset()
    useProfile.setState({ profile: { timezone: 'America/Sao_Paulo' } as never })
    await useNutrition.getState().bind(ME)
    expect(api.fetchLogs).toHaveBeenLastCalledWith('2026-09-21', '2026-10-05')
    useProfile.setState({ profile: null })
  })

  it("does not write the previous account's pull under the next one", async () => {
    const mineA = logOf({ id: 'of-a', day: TODAY }), mineB = logOf({ id: 'of-b', day: TODAY })
    let releaseA!: (v: unknown[]) => void
    api.fetchLogs.mockReturnValueOnce(new Promise(r => { releaseA = r })).mockResolvedValueOnce([mineB])
    const a = useNutrition.getState().bind(ME)
    await settle()
    const b = useNutrition.getState().bind(OTHER)
    releaseA([mineA])
    await Promise.all([a, b])
    const s = useNutrition.getState()
    expect(s.userId).toBe(OTHER)
    expect(Object.values(s.logs).flat().map(l => l.id)).toEqual(['of-b'])
    expect(s.status).toBe('ready')
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

describe('sign-out with unsent items', () => {
  it("keeps A's ops across sign-out, never sends them for B, and sends them when A returns", async () => {
    await bound()
    api.upsertLog.mockRejectedValue(new TypeError('Failed to fetch'))
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    const a = useNutrition.getState().addLog(rest)
    await settle()
    expect(pending(ME)).toHaveLength(1)

    // what main.jsx does on SIGNED_OUT
    useNutrition.getState().reset(); clearNutritionLocal()
    expect(pending(ME)).toHaveLength(1)

    api.upsertLog.mockReset().mockResolvedValue(undefined)
    await useNutrition.getState().bind(OTHER)
    await settle()
    expect(api.upsertLog).not.toHaveBeenCalled()
    expect(pending(OTHER)).toEqual([])
    expect(Object.values(useNutrition.getState().logs).flat()).toEqual([])
    expect(pending(ME)).toHaveLength(1)

    useNutrition.getState().reset(); clearNutritionLocal()
    await useNutrition.getState().bind(ME)
    expect(api.upsertLog).toHaveBeenCalledTimes(1)
    expect(api.upsertLog.mock.calls[0][0].id).toBe(a.id)
    expect(pending(ME)).toEqual([])
  })

  it("shows A's unsent item in the diary when the pull does not have it yet", async () => {
    await bound()
    api.upsertLog.mockRejectedValue(new TypeError('Failed to fetch'))
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    const a = useNutrition.getState().addLog(rest)
    await settle()
    useNutrition.getState().reset(); clearNutritionLocal()
    await useNutrition.getState().bind(ME)
    expect(useNutrition.getState().logs[TODAY].map(l => l.id)).toEqual([a.id])
  })

  it('flushes the account pending ops on bind', async () => {
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    const l = { ...rest, id: 'x1', updated_at: '2026-10-05T12:00:00.000Z' }
    const { enqueue } = await import('./outbox')
    enqueue(ME, { kind: 'log', op: 'upsert', id: 'x1', row: l })
    await useNutrition.getState().bind(ME)
    expect(api.upsertLog).toHaveBeenCalledTimes(1)
    expect(pending(ME)).toEqual([])
  })
})

describe('startNutritionSync', () => {
  const vis = (v: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  it('every 60 s only sends a waiting outbox, in a visible tab, without pulling; stop clears it', async () => {
    await bound()
    api.upsertLog.mockRejectedValue(new TypeError('Failed to fetch'))
    const { id, updated_at, ...rest } = logOf({ day: TODAY })
    useNutrition.getState().addLog(rest)
    await settle()
    vi.useFakeTimers()
    api.upsertLog.mockClear(); api.fetchFoods.mockClear()
    const stop = startNutritionSync()
    await vi.advanceTimersByTimeAsync(59_000)
    expect(api.upsertLog).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(api.upsertLog).toHaveBeenCalledTimes(1)
    expect(api.fetchFoods).not.toHaveBeenCalled()
    vis('hidden')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.upsertLog).toHaveBeenCalledTimes(1)
    vis('visible')
    api.upsertLog.mockResolvedValue(undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(api.upsertLog).toHaveBeenCalledTimes(2)
    // outbox now empty: nothing more is sent
    await vi.advanceTimersByTimeAsync(120_000)
    expect(api.upsertLog).toHaveBeenCalledTimes(2)
    expect(api.fetchFoods).not.toHaveBeenCalled()
    stop()
    vi.useRealTimers()
  })
})

describe('measures', () => {
  const draft = { food_key: 'taco:1', label: 'concha', grams: 120 }
  const failing = () => api.upsertMeasure.mockRejectedValue(new TypeError('Failed to fetch'))

  it('pulls measures with the diary and keeps them in the saved copy', async () => {
    const m = measureOf({ id: 'm1' })
    api.fetchMeasures.mockResolvedValue([m])
    await bound()
    expect(useNutrition.getState().measures).toEqual([m])
    expect(cache().measures).toEqual([m])
    useNutrition.getState().reset()
    api.fetchMeasures.mockReturnValue(new Promise(() => {}))
    localStorage.setItem('perf_nutrition_v1', JSON.stringify({ userId: ME, logs: {}, foods: [], targets: [], closed: [], measures: [m] }))
    void useNutrition.getState().bind(ME)
    expect(useNutrition.getState().measures).toEqual([m])
  })

  it('keeps the cached measures and still loads the rest when the measures request fails', async () => {
    const cached = measureOf({ id: 'cached' })
    const log = logOf({ id: 'l1', day: TODAY })
    const food = foodOf({ id: 'f1' })
    localStorage.setItem('perf_nutrition_v1', JSON.stringify({ userId: ME, logs: {}, foods: [], targets: [], closed: [], measures: [cached] }))
    api.fetchLogs.mockResolvedValue([log]); api.fetchFoods.mockResolvedValue([food])
    api.fetchMeasures.mockRejectedValue(new Error('relation "food_measures" does not exist'))
    await bound()
    const s = useNutrition.getState()
    expect(s.status).toBe('ready')
    expect(s.stale).toBe(false)
    expect(s.logs[TODAY]).toEqual([log])
    expect(s.foods).toEqual([food])
    expect(s.measures).toEqual([cached])
    expect(cache().measures).toEqual([cached])
  })

  it('reads a saved copy from before measures existed', async () => {
    localStorage.setItem('perf_nutrition_v1', JSON.stringify({ userId: ME, logs: {}, foods: [], targets: [], closed: [] }))
    api.fetchMeasures.mockReturnValue(new Promise(() => {}))
    void useNutrition.getState().bind(ME)
    expect(useNutrition.getState().measures).toEqual([])
  })

  it('adds a measure at once, trimmed, and sends it', async () => {
    await bound()
    const m = useNutrition.getState().addMeasure({ ...draft, label: '  concha ' })
    expect(m).toMatchObject({ food_key: 'taco:1', label: 'concha', grams: 120, updated_at: new Date().toISOString() })
    expect(m.id).toBeTruthy()
    expect(useNutrition.getState().measures).toEqual([m])
    expect(useNutrition.getState().measuresFor('taco:1')).toEqual([m])
    expect(useNutrition.getState().measuresFor('taco:2')).toEqual([])
    expect(cache().measures).toEqual([m])
    await settle()
    expect(api.upsertMeasure).toHaveBeenCalledWith(m)
    expect(pending(ME)).toEqual([])
  })

  it('creates offline and sends when the network is back', async () => {
    await bound()
    failing()
    const m = useNutrition.getState().addMeasure(draft)
    await settle()
    expect(pending(ME)).toEqual([{ kind: 'measure', op: 'upsert', id: m.id, row: m }])
    expect(useNutrition.getState().measures).toEqual([m])
    // the pull does not erase what the server has not heard yet
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().measures).toEqual([m])
    api.upsertMeasure.mockReset().mockResolvedValue(undefined)
    await useNutrition.getState().flushPending()
    expect(api.upsertMeasure).toHaveBeenCalledWith(m)
    expect(pending(ME)).toEqual([])
  })

  it('updates label and grams but never the food, and removes', async () => {
    await bound()
    const m = useNutrition.getState().addMeasure(draft)
    vi.setSystemTime(new Date(2026, 9, 5, 12, 5, 0))
    useNutrition.getState().updateMeasure(m.id, { label: ' escumadeira ', grams: 85, food_key: 'taco:99', id: 'zzz' })
    const [u] = useNutrition.getState().measures
    expect(u).toEqual({ id: m.id, food_key: 'taco:1', label: 'escumadeira', grams: 85, updated_at: new Date().toISOString() })
    await settle()
    expect(api.upsertMeasure).toHaveBeenLastCalledWith(u)
    useNutrition.getState().updateMeasure('missing', { grams: 1 })
    useNutrition.getState().removeMeasure(m.id)
    expect(useNutrition.getState().measures).toEqual([])
    await settle()
    expect(api.deleteMeasure).toHaveBeenCalledWith(m.id)
  })

  it('a measure deleted offline stays gone after a pull that still has it', async () => {
    const m = measureOf({ id: 'm1' })
    api.fetchMeasures.mockResolvedValue([m])
    await bound()
    api.deleteMeasure.mockRejectedValue(new TypeError('Failed to fetch'))
    useNutrition.getState().removeMeasure('m1')
    await settle()
    await useNutrition.getState().refresh()
    expect(useNutrition.getState().measures).toEqual([])
  })

  it("does not show one person's measures to another account", async () => {
    await bound()
    failing()
    const m = useNutrition.getState().addMeasure(draft)
    await settle()
    useNutrition.getState().reset(); clearNutritionLocal()
    expect(cache()).toBeNull()
    api.upsertMeasure.mockReset().mockResolvedValue(undefined)
    await useNutrition.getState().bind(OTHER)
    await settle()
    expect(useNutrition.getState().measures).toEqual([])
    expect(api.upsertMeasure).not.toHaveBeenCalled()
    expect(pending(ME)).toHaveLength(1)
    // a saved copy that belongs to someone else is ignored too
    useNutrition.getState().reset()
    localStorage.setItem('perf_nutrition_v1', JSON.stringify({ userId: ME, logs: {}, foods: [], targets: [], closed: [], measures: [m] }))
    api.fetchMeasures.mockReturnValue(new Promise(() => {}))
    void useNutrition.getState().bind(OTHER)
    expect(useNutrition.getState().measures).toEqual([])
    // and A sends them on return; the server has them by the time of the pull
    useNutrition.getState().reset()
    api.fetchMeasures.mockResolvedValue([m])
    await useNutrition.getState().bind(ME)
    expect(api.upsertMeasure).toHaveBeenCalledWith(m)
    expect(useNutrition.getState().measures).toEqual([m])
  })

  it('drops a refused measure with the existing notice', async () => {
    await bound()
    api.upsertMeasure.mockRejectedValue(Object.assign(new Error('too_many_measures'), { code: 'P0001' }))
    useNutrition.getState().addMeasure(draft)
    await settle()
    expect(pending(ME)).toEqual([])
    expect(useNutrition.getState().droppedNotice).toBe(true)
    expect(useNutrition.getState().droppedReason).toBe('refused')
  })

  it('drops an item_immutable refusal too', async () => {
    await bound()
    api.upsertMeasure.mockRejectedValueOnce(Object.assign(new Error('item_immutable'), { code: 'P0001' }))
    useNutrition.getState().addMeasure(draft)
    await settle()
    expect(pending(ME)).toEqual([])
    expect(useNutrition.getState().droppedReason).toBe('refused')
  })
})
