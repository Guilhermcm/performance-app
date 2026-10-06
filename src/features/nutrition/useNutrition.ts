import { create } from 'zustand'
import * as api from './nutrition-api'
import { enqueue, flushOutbox, pending, type OutboxOp } from './outbox'
import { useProgress } from '../gamification/useProgress'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from './days'
import type { FoodItem, FoodLog, Meal, Measure, NutritionDay, NutritionTarget, UserFood } from './types'

const CACHE = 'perf_nutrition_v1'
// Days of logs kept on the phone; "Copy from" asks the server for the older ones.
export const WINDOW_DAYS = 14
const RECENTS = 50

type Saved = { userId: string; logs: Record<string, FoodLog[]>; foods: UserFood[]; targets: NutritionTarget[]; closed: NutritionDay[]; measures?: Measure[] }
type Data = Required<Pick<Saved, 'logs' | 'foods' | 'targets' | 'closed' | 'measures'>>

const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (userId: string, d: Data) => {
  try { localStorage.setItem(CACHE, JSON.stringify({ ...d, userId })) } catch { /* full or blocked */ }
}
const drop = () => { try { localStorage.removeItem(CACHE) } catch { /* ignore */ } }

const groupByDay = (logs: FoodLog[]): Record<string, FoodLog[]> => {
  const out: Record<string, FoodLog[]> = {}
  for (const l of logs) (out[l.day] ??= []).push(l)
  return out
}
const sortTargets = (t: NutritionTarget[]) => [...t].sort((a, b) => (a.valid_from < b.valid_from ? -1 : 1))

// What the server sent, with the changes it has not heard about yet laid on top.
function applyPending(userId: string, logs: Record<string, FoodLog[]>, foods: UserFood[], measures: Measure[]): { logs: Record<string, FoodLog[]>; foods: UserFood[]; measures: Measure[] } {
  let all = Object.values(logs).flat()
  let fs = foods
  let ms = measures
  for (const op of pending(userId) as OutboxOp[]) {
    if (op.kind === 'log') {
      all = all.filter(l => l.id !== op.id)
      if (op.op === 'upsert') all.push(op.row as FoodLog)
    } else if (op.kind === 'measure') {
      ms = ms.filter(m => m.id !== op.id)
      if (op.op === 'upsert') ms = [...ms, op.row as Measure]
    } else {
      fs = fs.filter(f => f.id !== op.id)
      if (op.op === 'upsert') fs = [op.row as UserFood, ...fs]
    }
  }
  return { logs: groupByDay(all), foods: fs, measures: ms }
}

// One food across sources: its id at the source, or its name and brand when it has none.
export const keyOf = (i: { source: string; source_id: string | null; name: string; brand: string | null }) =>
  i.source_id ? `${i.source}:${i.source_id}` : `${i.source}:${i.name.trim().toLowerCase()}|${(i.brand ?? '').trim().toLowerCase()}`

const uuid = () => crypto.randomUUID()

export type NutritionStore = {
  userId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  stale: boolean
  logs: Record<string, FoodLog[]>
  foods: UserFood[]
  targets: NutritionTarget[]
  closed: NutritionDay[]
  measures: Measure[]
  droppedNotice: boolean
  // Why items were dropped, so the screen picks the text: 'day_closed' only when every drop was a closed day.
  droppedReason: 'day_closed' | 'refused' | null
  bind(userId: string): Promise<void>
  refresh(): Promise<void>
  // Sends what is waiting in the outbox, if anything; no pull.
  flushPending(): Promise<void>
  reset(): void
  dismissDropped(): void
  addLog(l: Omit<FoodLog, 'id' | 'updated_at'>): FoodLog
  updateLog(id: string, patch: Partial<FoodLog>): void
  removeLog(id: string): FoodLog | undefined
  restoreLog(l: FoodLog): void
  // `source`: the logs of `fromDay` when the phone does not keep that day (fetched for the copy).
  copyMeal(fromDay: string, fromMeal: Meal, toDay: string, toMeal: Meal, source?: FoodLog[]): number
  copyDay(fromDay: string, toDay: string, source?: FoodLog[]): number
  saveFood(f: Omit<UserFood, 'id' | 'updated_at'>): UserFood
  toggleFavorite(item: FoodItem): void
  setTarget(t: Omit<NutritionTarget, 'valid_from'>, validFrom: string): Promise<void>
  targetOn(day: string): NutritionTarget | null
  recents(): FoodItem[]
  // Personal household measures. The food a measure belongs to never changes: a patch to food_key or id is ignored.
  addMeasure(m: Omit<Measure, 'id' | 'updated_at'>): Measure
  updateMeasure(id: string, patch: Partial<Measure>): void
  removeMeasure(id: string): void
  // Smallest first, like the suggested ones.
  measuresFor(key: string): Measure[]
}

const empty = () => ({ logs: {} as Record<string, FoodLog[]>, foods: [] as UserFood[], targets: [] as NutritionTarget[], closed: [] as NutritionDay[], measures: [] as Measure[] })

// Bumped by reset(): an answer from before a sign-out must not land in the next account's store.
let generation = 0
let refreshing: Promise<void> | null = null

export const useNutrition = create<NutritionStore>((set, get) => {
  const persist = () => {
    const { userId, logs, foods, targets, closed, measures } = get()
    if (userId) save(userId, { logs, foods, targets, closed, measures })
  }

  // The outbox is the queue; this only wakes it and takes in what happened to it.
  const flush = async () => {
    const userId = get().userId
    if (!userId) return
    const gen = generation
    const r = await flushOutbox(userId)
    if (gen !== generation) return
    if (r.dropped > 0) {
      const onlyClosed = r.reasons.every(x => x === 'day_closed') && get().droppedReason !== 'refused'
      set({ droppedNotice: true, droppedReason: onlyClosed ? 'day_closed' : 'refused' })
    }
  }
  const queue = (op: OutboxOp) => {
    const userId = get().userId
    if (!userId) return
    enqueue(userId, op)
    void flush()
  }

  const putLogs = (fn: (logs: Record<string, FoodLog[]>) => Record<string, FoodLog[]>) => {
    set(s => ({ logs: fn(s.logs) }))
    persist()
  }
  const putLog = (l: FoodLog) => putLogs(logs => ({ ...logs, [l.day]: [...(logs[l.day] ?? []).filter(x => x.id !== l.id), l] }))
  const find = (id: string) => Object.values(get().logs).flat().find(l => l.id === id)
  const putFood = (f: UserFood) => {
    set(s => ({ foods: [f, ...s.foods.filter(x => x.id !== f.id)] }))
    persist()
  }
  const putMeasure = (m: Measure) => {
    set(s => ({ measures: [...s.measures.filter(x => x.id !== m.id), m] }))
    persist()
  }
  const stamp = (): string => new Date().toISOString()

  const copyLogs = (from: FoodLog[], toDay: string, mealOf: (l: FoodLog) => Meal): number => {
    const now = stamp()
    const copies = from.map(l => ({ ...l, id: uuid(), day: toDay, meal: mealOf(l), updated_at: now }))
    if (!copies.length) return 0
    putLogs(logs => ({ ...logs, [toDay]: [...(logs[toDay] ?? []), ...copies] }))
    for (const c of copies) queue({ kind: 'log', op: 'upsert', id: c.id, row: c })
    return copies.length
  }

  return {
    userId: null,
    status: 'idle',
    stale: false,
    ...empty(),
    droppedNotice: false,
    droppedReason: null,

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // what is waiting in the queue goes out and the diary is pulled.
    bind(userId) {
      if (get().userId === userId) return Promise.resolve()
      const saved = readSaved(userId)
      // An answer still in flight for the previous account must not land under this one.
      generation++
      refreshing = null
      set({
        userId, droppedNotice: false, droppedReason: null,
        status: saved ? 'ready' : 'loading', stale: !!saved,
        logs: saved?.logs ?? {}, foods: saved?.foods ?? [], targets: saved?.targets ?? [], closed: saved?.closed ?? [], measures: saved?.measures ?? []
      })
      return get().refresh()
    },

    refresh() {
      if (refreshing) return refreshing
      const userId = get().userId
      if (!userId) return Promise.resolve()
      const gen = generation
      const job = (async () => {
        await flush()
        if (gen !== generation) return
        const today = todayIn(useProfile.getState().profile?.timezone)
        const from = shiftDay(today, -WINDOW_DAYS)
        const before = new Set(get().closed.map(d => d.day))
        try {
          const [logs, foods, targets, days, measures] = await Promise.all([
            api.fetchLogs(from, today), api.fetchFoods(), api.fetchTargets(), api.fetchDays(from, today),
            // Measures are a side feature: if they cannot load, the diary still does and keeps its copy.
            api.fetchMeasures().catch(() => get().measures)
          ])
          if (gen !== generation) return
          const merged = applyPending(userId, groupByDay(logs), foods, measures)
          set({ ...merged, targets: sortTargets(targets), closed: days.days, status: 'ready', stale: false })
          persist()
          // Fetching days closes the due ones on the server, which can award XP.
          if (days.days.some(d => !before.has(d.day))) void useProgress.getState().refresh()
        } catch {
          if (gen !== generation) return
          set(s => ({ status: s.status === 'ready' ? 'ready' : 'error', stale: s.status === 'ready' }))
        }
      })().finally(() => { if (gen === generation) refreshing = null })
      refreshing = job
      return job
    },

    async flushPending() {
      const userId = get().userId
      if (userId && pending(userId).length) await flush()
    },

    reset() {
      generation++
      refreshing = null
      drop()
      set({ userId: null, status: 'idle', stale: false, ...empty(), droppedNotice: false, droppedReason: null })
    },

    dismissDropped() { set({ droppedNotice: false, droppedReason: null }) },

    addLog(l) {
      const log: FoodLog = { ...l, id: uuid(), updated_at: stamp() }
      putLog(log)
      queue({ kind: 'log', op: 'upsert', id: log.id, row: log })
      return log
    },

    updateLog(id, patch) {
      const cur = find(id)
      if (!cur) return
      // The day never moves: the server refuses it, a move is a delete plus an add.
      const log: FoodLog = { ...cur, ...patch, id, day: cur.day, updated_at: stamp() }
      putLog(log)
      queue({ kind: 'log', op: 'upsert', id, row: log })
    },

    removeLog(id) {
      const cur = find(id)
      if (!cur) return undefined
      putLogs(logs => ({ ...logs, [cur.day]: (logs[cur.day] ?? []).filter(x => x.id !== id) }))
      queue({ kind: 'log', op: 'delete', id })
      return cur
    },

    restoreLog(l) {
      const log = { ...l, updated_at: stamp() }
      putLog(log)
      queue({ kind: 'log', op: 'upsert', id: log.id, row: log })
    },

    copyMeal(fromDay, fromMeal, toDay, toMeal, source) {
      return copyLogs((source ?? get().logs[fromDay] ?? []).filter(l => l.meal === fromMeal), toDay, () => toMeal)
    },

    copyDay(fromDay, toDay, source) {
      return copyLogs(source ?? get().logs[fromDay] ?? [], toDay, l => l.meal)
    },

    saveFood(f) {
      const food: UserFood = { ...f, id: uuid(), updated_at: stamp() }
      putFood(food)
      queue({ kind: 'food', op: 'upsert', id: food.id, row: food })
      return food
    },

    toggleFavorite(item) {
      const key = keyOf(item)
      const cur = get().foods.find(f => keyOf(f) === key)
      // A recent's mark only names the portion shortcut; it is no part of the food.
      const { recent: _recent, ...plain } = item
      const food: UserFood = cur
        ? { ...cur, favorite: !cur.favorite, updated_at: stamp() }
        : { ...plain, id: uuid(), favorite: true, updated_at: stamp() }
      putFood(food)
      queue({ kind: 'food', op: 'upsert', id: food.id, row: food })
    },

    async setTarget(t, validFrom) {
      const target: NutritionTarget = { ...t, valid_from: validFrom }
      await api.insertTarget(target)
      set(s => ({ targets: sortTargets([...s.targets.filter(x => x.valid_from !== validFrom), target]) }))
      persist()
    },

    targetOn(day) {
      let found: NutritionTarget | null = null
      for (const t of get().targets) if (t.valid_from <= day && (!found || t.valid_from > found.valid_from)) found = t
      return found
    },

    addMeasure(m) {
      const measure: Measure = { id: uuid(), food_key: m.food_key, label: m.label.trim(), grams: m.grams, updated_at: stamp() }
      putMeasure(measure)
      queue({ kind: 'measure', op: 'upsert', id: measure.id, row: measure })
      return measure
    },

    updateMeasure(id, patch) {
      const cur = get().measures.find(m => m.id === id)
      if (!cur) return
      const measure: Measure = {
        ...cur,
        label: patch.label === undefined ? cur.label : patch.label.trim(),
        grams: patch.grams === undefined ? cur.grams : patch.grams,
        updated_at: stamp()
      }
      putMeasure(measure)
      queue({ kind: 'measure', op: 'upsert', id, row: measure })
    },

    removeMeasure(id) {
      if (!get().measures.some(m => m.id === id)) return
      set(s => ({ measures: s.measures.filter(m => m.id !== id) }))
      persist()
      queue({ kind: 'measure', op: 'delete', id })
    },

    measuresFor(key) {
      return get().measures.filter(m => m.food_key === key).sort((a, b) => a.grams - b.grams || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    },

    // Distinct foods from the saved window, newest first. Quick entries have no food behind them.
    recents() {
      const all = Object.values(get().logs).flat()
        .filter(l => l.source !== 'quick' && l.source !== 'import')
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
      const seen = new Set<string>()
      const out: FoodItem[] = []
      for (const l of all) {
        const k = keyOf(l)
        if (seen.has(k)) continue
        seen.add(k)
        const g = l.grams && l.grams > 0 ? l.grams : 100
        const per = (v: number) => Math.round((v * 100 / g) * 10) / 10
        out.push({
          source: l.source as FoodItem['source'], source_id: l.source_id, name: l.name, brand: l.brand,
          per100: { kcal: per(l.kcal), protein: per(l.protein_g), carbs: per(l.carbs_g), fat: per(l.fat_g), fiber: l.fiber_g == null ? null : per(l.fiber_g) },
          serving_g: l.grams, serving_label: null, barcode: null, recent: true
        })
        if (out.length === RECENTS) break
      }
      return out
    }
  }
})

// Pull again when the app comes back to the screen or the network returns; the refresh sends
// the outbox first. Returns the cleanup.
export function startNutritionSync(): () => void {
  const run = () => { void useNutrition.getState().refresh() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  // A write that failed with the network up and no event after it still gets another try: the
  // tick only sends the outbox (no pull), and only for a visible tab with something waiting.
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void useNutrition.getState().flushPending()
  }, 60_000)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
