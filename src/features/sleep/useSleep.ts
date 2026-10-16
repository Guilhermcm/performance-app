import { create } from 'zustand'
import * as api from './sleep-api'
import { sleepOutbox, type SleepOp } from './outbox'
import { SLEEP_CACHE_KEY, SLEEP_HISTORY_KEY } from './storage-keys'
import { durationMin } from './time'
import { targetAt } from './goal'
import { useProgress } from '../gamification/useProgress'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from '../nutrition/days'
import { isSettled, shiftMonth } from '../nutrition/history'
import { t } from '../../lib/i18n.js'
import type { SleepHistory, SleepLog, SleepNight, SleepPeriod, SleepTarget, SleepWeek } from './types'

// The closed nights kept on the phone: the widest range get_sleep_nights answers, ending today.
export const CLOSED_DAYS = 62
// How far back the morning card looks for the times to start from.
const LAST_LOGGED_DAYS = 14
// History months kept on the phone; the most recent stay.
const MAX_MONTHS = 24

// The text for droppedNotice, for the screen that shows it.
export const droppedNoticeText = (): string => t('Some nights from days that already closed were not saved.')

type Data = { logs: Record<string, SleepLog>; targets: SleepTarget[]; closed: SleepNight[]; periods: SleepPeriod[]; weeks: SleepWeek[] }
type Saved = Data & { userId: string }

const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(SLEEP_CACHE_KEY) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (userId: string, d: Data) => {
  try { localStorage.setItem(SLEEP_CACHE_KEY, JSON.stringify({ ...d, userId })) } catch { /* full or blocked */ }
}
const drop = () => { try { localStorage.removeItem(SLEEP_CACHE_KEY) } catch { /* ignore */ } }

// The calendar months already read, one account at a time, with the day each was read so a month
// whose rows have all closed (isSettled) is never asked again.
type SavedMonth = { fetchedOn: string; data: SleepHistory }
type HistoryCache = { userId: string; months: Record<string, SavedMonth> }

const readHistory = (userId: string): HistoryCache => {
  try {
    const c = JSON.parse(localStorage.getItem(SLEEP_HISTORY_KEY) || 'null')
    if (c && c.userId === userId && c.months && typeof c.months === 'object') return { userId, months: c.months }
  } catch { /* broken or blocked: start over */ }
  return { userId, months: {} }
}
const writeHistory = (c: HistoryCache) => {
  const keep = Object.keys(c.months).sort().slice(-MAX_MONTHS)
  const months = Object.fromEntries(keep.map(k => [k, c.months[k]]))
  try { localStorage.setItem(SLEEP_HISTORY_KEY, JSON.stringify({ ...c, months })) } catch { /* full or blocked */ }
}

const sortTargets = (ts: SleepTarget[]) => [...ts].sort((a, b) => (a.valid_from < b.valid_from ? -1 : 1))

// What the server sent for today and yesterday, with the writes it may not have heard about yet laid
// on top, oldest first (laying one it already has changes nothing). An op for an older night is left
// out: the server is about to refuse it.
function applyPending(ops: SleepOp[], logs: Record<string, SleepLog>, from: string): Record<string, SleepLog> {
  const out = { ...logs }
  for (const op of ops) {
    if (op.night < from) continue
    delete out[op.night]
    if (op.op === 'upsert' && op.row) out[op.night] = op.row
  }
  return out
}

// A closed night as a log, for the times the morning card starts from. It has no write time.
const logOfNight = (n: SleepNight): SleepLog | null =>
  n.logged && n.bed_time && n.wake_time && n.duration_min != null
    ? { night: n.night, bed_time: n.bed_time, wake_time: n.wake_time, duration_min: n.duration_min, quality: n.quality, note: n.note, updated_at: '' }
    : null

export type SleepStore = {
  userId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  stale: boolean
  // Today and yesterday, the nights that can still change, by night.
  logs: Record<string, SleepLog>
  targets: SleepTarget[]
  // The closed nights of the last 62 days, oldest first.
  closed: SleepNight[]
  periods: SleepPeriod[]
  weeks: SleepWeek[]
  // Some queued nights were refused for good (a night that closed meanwhile); raised once per drop.
  droppedNotice: boolean
  bind(userId: string): Promise<void>
  refresh(): Promise<void>
  // Sends what is waiting in the queue, if anything; no pull.
  flushPending(): Promise<void>
  reset(): void
  dismissDropped(): void
  saveNight(input: Omit<SleepLog, 'duration_min' | 'updated_at'>): SleepLog
  removeNight(night: string): void
  setTarget(t: Omit<SleepTarget, 'valid_from'>, validFrom: string): Promise<void>
  targetOn(night: string): SleepTarget | null
  // The most recent logged night from today - 14 to today, from the open logs and the closed nights.
  // Only to prefill a form: a closed night comes back with updated_at '' (it has no row to keep), so
  // never pass the result itself to saveNight or the queue.
  lastLogged(today: string): SleepLog | null
  // A calendar month (YYYY-MM) up to today; null for a month still to come, or offline with no saved copy.
  loadMonth(month: string): Promise<SleepHistory | null>
}

const empty = (): Data => ({ logs: {}, targets: [], closed: [], periods: [], weeks: [] })

// Bumped by reset() and bind(): an answer from before a sign-out must not land in the next account's store.
let generation = 0
let refreshing: Promise<void> | null = null
// Bumped by every local change. A pull that started before one read the server without it (its op
// may even have gone and left the queue meanwhile), so its answer is dropped and the pull runs again.
let writes = 0
let pullAgain = false

const todayNow = () => todayIn(useProfile.getState().profile?.timezone)

export const useSleep = create<SleepStore>((set, get) => {
  const persist = () => {
    const { userId, logs, targets, closed, periods, weeks } = get()
    if (userId) save(userId, { logs, targets, closed, periods, weeks })
  }

  // The outbox is the queue; this only wakes it and takes in what happened to it.
  const flush = async () => {
    const userId = get().userId
    if (!userId) return
    const gen = generation
    const r = await sleepOutbox.flush(userId)
    if (gen !== generation) return
    if (r.dropped > 0) set({ droppedNotice: true })
  }
  const queue = (op: SleepOp) => {
    const userId = get().userId
    if (!userId) return
    sleepOutbox.enqueue(userId, op)
    void flush()
  }

  return {
    userId: null,
    status: 'idle',
    stale: false,
    ...empty(),
    droppedNotice: false,

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // what is waiting in the queue goes out and the nights are pulled.
    bind(userId) {
      if (get().userId === userId) return Promise.resolve()
      const saved = readSaved(userId)
      generation++
      refreshing = null
      pullAgain = false
      set({
        userId, droppedNotice: false,
        status: saved ? 'ready' : 'loading', stale: !!saved,
        logs: saved?.logs ?? {}, targets: saved?.targets ?? [], closed: saved?.closed ?? [],
        periods: saved?.periods ?? [], weeks: saved?.weeks ?? []
      })
      return get().refresh()
    },

    refresh() {
      if (refreshing) return refreshing
      const userId = get().userId
      if (!userId) return Promise.resolve()
      const gen = generation
      const seen = writes
      const job = (async () => {
        // A queue that cannot go now must not stop the pull; it is tried again on the next refresh.
        try { await flush() } catch { /* kept for the next refresh */ }
        if (gen !== generation) return
        // What is still queued now may go out while the reads are on their way, and leave the queue.
        const queued = sleepOutbox.pending(userId)
        const today = todayNow()
        const yesterday = shiftDay(today, -1)
        const before = new Set(get().closed.map(n => n.night))
        try {
          const [logs, targets, history] = await Promise.all([
            api.fetchLogs(yesterday, today), api.fetchTargets(), api.fetchNights(shiftDay(today, -(CLOSED_DAYS - 1)), today)
          ])
          if (gen !== generation) return
          if (writes !== seen) { pullAgain = true; return }
          const byNight = Object.fromEntries(logs.map(l => [l.night, l]))
          set({
            logs: applyPending([...queued, ...sleepOutbox.pending(userId)], byNight, yesterday), targets: sortTargets(targets),
            closed: history.nights, periods: history.periods, weeks: history.weeks, status: 'ready', stale: false
          })
          persist()
          // Fetching the nights closes the due ones on the server, which can pay XP.
          if (history.nights.some(n => !before.has(n.night))) void useProgress.getState().refresh()
        } catch {
          if (gen !== generation) return
          set(s => ({ status: s.status === 'ready' ? 'ready' : 'error', stale: s.status === 'ready' }))
        }
      })().finally(() => {
        if (gen !== generation) return
        refreshing = null
        if (pullAgain) { pullAgain = false; void get().refresh() }
      })
      refreshing = job
      return job
    },

    async flushPending() {
      const userId = get().userId
      if (userId && sleepOutbox.pending(userId).length) await flush()
    },

    reset() {
      generation++
      refreshing = null
      pullAgain = false
      drop()
      set({ userId: null, status: 'idle', stale: false, ...empty(), droppedNotice: false })
    },

    dismissDropped() { set({ droppedNotice: false }) },

    saveNight(input) {
      const log: SleepLog = { ...input, duration_min: durationMin(input.bed_time, input.wake_time), updated_at: new Date().toISOString() }
      writes++
      set(s => ({ logs: { ...s.logs, [log.night]: log } }))
      persist()
      queue({ op: 'upsert', night: log.night, row: log })
      return log
    },

    removeNight(night) {
      writes++
      set(s => {
        const logs = { ...s.logs }
        delete logs[night]
        return { logs }
      })
      persist()
      queue({ op: 'delete', night })
    },

    async setTarget(t, validFrom) {
      const target: SleepTarget = { ...t, valid_from: validFrom }
      await api.insertTarget(target)
      writes++
      set(s => ({ targets: sortTargets([...s.targets.filter(x => x.valid_from !== validFrom), target]) }))
      persist()
    },

    targetOn(night) {
      return targetAt(get().targets, night)
    },

    lastLogged(today) {
      const from = shiftDay(today, -LAST_LOGGED_DAYS)
      const inRange = (night: string) => night >= from && night <= today
      // An open log speaks for its night over the closed copy.
      let best: SleepLog | null = null
      for (const l of Object.values(get().logs)) if (inRange(l.night) && (!best || l.night > best.night)) best = l
      for (const n of get().closed) {
        if (!inRange(n.night) || (best && n.night <= best.night)) continue
        best = logOfNight(n) ?? best
      }
      return best
    },

    async loadMonth(month) {
      const userId = get().userId
      if (!userId) return null
      const gen = generation
      const today = todayNow()
      const from = `${month}-01`
      if (from > today) return null
      const last = shiftDay(`${shiftMonth(month, 1)}-01`, -1)
      const saved = readHistory(userId).months[month]
      if (saved && isSettled(month, saved.fetchedOn)) return saved.data
      try {
        const data = await api.fetchNights(from, last < today ? last : today)
        if (gen !== generation) return null
        const c = readHistory(userId)
        c.months[month] = { fetchedOn: today, data }
        writeHistory(c)
        return data
      } catch {
        return gen === generation ? saved?.data ?? null : null
      }
    }
  }
})

// Pull again when the app comes back to the screen or the network returns; the refresh sends the
// queue first. On each minute boundary: when the local day (profile time zone) has turned, pull
// again, since a tab left open across midnight gets no focus or network event and every screen
// needs the new today and yesterday (and yesterday's yesterday closed); otherwise a visible tab
// with something waiting sends it (no pull). Returns the cleanup.
export function startSleepSync(): () => void {
  let day = todayNow()
  const run = () => { day = todayNow(); void useSleep.getState().refresh() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  const tick = () => {
    if (todayNow() !== day) return run()
    if (document.visibilityState === 'visible') void useSleep.getState().flushPending()
  }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  // The first tick lands on the next minute boundary, so the day turns at 00:00, not up to a minute late.
  let timer: number | undefined
  const first = window.setTimeout(() => { tick(); timer = window.setInterval(tick, 60_000) }, 60_000 - (Date.now() % 60_000))
  return () => {
    window.clearTimeout(first)
    if (timer !== undefined) window.clearInterval(timer)
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
