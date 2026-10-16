import { create } from 'zustand'
import * as api from './trackers-api'
import { trackersOutbox, type TrackerOp } from './outbox'
import { TRACKERS_CACHE_KEY } from './storage-keys'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from '../nutrition/days'
import { classify } from '@/lib/supabase-errors'
import { t } from '../../lib/i18n.js'
import type { Tracker, TrackerEntry } from './types'

// The server refuses a 31st active tracker (too_many_trackers); the store refuses it first.
export const MAX_ACTIVE_TRACKERS = 30
// The entries kept on the phone (plan decision 5): today and the 89 days before it, every tracker.
export const WINDOW_DAYS = 90

// Why queued writes were dropped: one rule only when every drop was that rule. option_in_use is an
// edit saved again with the options the server kept, not a loss.
export type DroppedReason = 'tracker_archived' | 'future_day' | 'option_in_use' | 'refused'

export const droppedNoticeText = (reason: DroppedReason): string =>
  reason === 'tracker_archived' ? t('Some entries for archived trackers were not saved.')
    : reason === 'future_day' ? t('Some entries dated after today were not saved.')
      : reason === 'option_in_use' ? t('An option you removed has older entries, so it was kept.')
        : t('Some tracker changes could not be saved.')

const SPECIFIC: readonly string[] = ['tracker_archived', 'future_day', 'option_in_use']
const reasonOf = (details: string[]): DroppedReason => {
  const all = new Set(details)
  const [only] = all
  return all.size === 1 && SPECIFIC.includes(only) ? (only as DroppedReason) : 'refused'
}

// An edit refused with option_in_use (it removed an option whose entries are older than the 90 days
// the phone holds), made again on the server's copy: the same fields and options, in the edit's
// order, with the options the server still has and the edit removed put back at the end.
function keepOptions(edit: Tracker, server: Tracker): Tracker {
  const ids = new Set((edit.options ?? []).map(o => o.id))
  return {
    ...server, name: edit.name, icon: edit.icon, unit: edit.unit, decimals: edit.decimals, aggregate: edit.aggregate,
    options: [...(edit.options ?? []), ...(server.options ?? []).filter(o => !ids.has(o.id))], updated_at: new Date().toISOString()
  }
}

type Data = { trackers: Tracker[]; entries: TrackerEntry[]; from: string }
type Saved = Data & { userId: string }

const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(TRACKERS_CACHE_KEY) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (userId: string, d: Data) => {
  try { localStorage.setItem(TRACKERS_CACHE_KEY, JSON.stringify({ ...d, userId })) } catch { /* full or blocked */ }
}
const drop = () => { try { localStorage.removeItem(TRACKERS_CACHE_KEY) } catch { /* ignore */ } }

const timezone = () => useProfile.getState().profile?.timezone
const todayNow = () => todayIn(timezone())
const windowStart = (today: string) => shiftDay(today, -(WINDOW_DAYS - 1))

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
// List order, as the server sorts: trackers.sort, then the id.
const byOrder = (a: Tracker, b: Tracker) => a.sort - b.sort || cmp(a.id, b.id)
// Oldest first: day, then the local time, then the id.
const byTime = (a: TrackerEntry, b: TrackerEntry) => cmp(a.day, b.day) || cmp(a.at, b.at) || cmp(a.id, b.id)

// What the server sent, with the writes it may not have heard about yet laid on top, oldest first
// (laying one it already has changes nothing).
function applyPending(ops: TrackerOp[], d: Pick<Data, 'trackers' | 'entries'>): Pick<Data, 'trackers' | 'entries'> {
  const trackers = new Map(d.trackers.map(x => [x.id, x]))
  const entries = new Map(d.entries.map(x => [x.id, x]))
  for (const op of ops) {
    if (op.op === 'tracker') trackers.set(op.row.id, op.row)
    else if (op.op === 'sort') {
      // A reorder moves the tracker and touches nothing else of it.
      const x = trackers.get(op.id)
      if (x) trackers.set(op.id, { ...x, sort: op.sort })
    } else if (op.op === 'entry') entries.set(op.row.id, op.row)
    else entries.delete(op.id)
  }
  return { trackers: [...trackers.values()].sort(byOrder), entries: [...entries.values()].sort(byTime) }
}

export type TrackerInput = Partial<Tracker> & Pick<Tracker, 'name' | 'icon' | 'kind'>
export type EntryInput = Omit<TrackerEntry, 'id' | 'updated_at'> & { id?: string }

export type TrackersStore = {
  userId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  // Active and archived, in list order.
  trackers: Tracker[]
  // Every tracker's entries from `from` on, oldest first.
  entries: TrackerEntry[]
  // The first day of the window: today - 89 in the profile time zone, as of the last pull.
  from: string
  // Some queued writes were refused for good; the words for it, raised once per drop.
  droppedNotice: string | null
  bind(userId: string): Promise<void>
  refresh(): Promise<void>
  // Sends what is waiting in the queue, if anything; a pull follows only when something was refused.
  flushPending(): Promise<void>
  reset(): void
  dismissDropped(): void
  active(): Tracker[]
  archived(): Tracker[]
  // Creates (a new id from crypto.randomUUID, at the end of the list) or edits the fields a sheet
  // edits; kind, sort, archive and creation never change here. A 31st active tracker throws the
  // server's own too_many_trackers refusal (toTrackerError reads it).
  saveTracker(input: TrackerInput): Tracker
  archiveTracker(id: string): void
  // Throws too_many_trackers like saveTracker.
  reactivateTracker(id: string): void
  // Moves an active tracker one place up (-1) or down (1): the active trackers are renumbered
  // 0..n-1 in the new order, and each one whose sort changed queues its sort alone.
  move(id: string, delta: -1 | 1): void
  // Creates or edits (same id) an entry with the value as it comes; the sheet rounds it.
  saveEntry(input: EntryInput): TrackerEntry
  deleteEntry(id: string): void
  entriesOf(trackerId: string): TrackerEntry[]
  // The latest entry of the window, by day and time.
  lastEntryOf(trackerId: string): TrackerEntry | null
}

const empty = (): Data => ({ trackers: [], entries: [], from: '' })

const tooManyTrackers = () => classify({ code: 'P0001', message: 'too_many_trackers' })

// Bumped by reset() and bind(): an answer from before a sign-out must not land in the next account's store.
let generation = 0
let refreshing: Promise<void> | null = null
// Bumped by every local change. A pull that started before one read the server without it (its op
// may even have gone and left the queue meanwhile), so its answer is dropped and the pull runs again.
let writes = 0
let pullAgain = false
// Tracker edits refused with option_in_use, waiting for the next pull to be made again (keepOptions).
let retries: Tracker[] = []

export const useTrackers = create<TrackersStore>((set, get) => {
  const persist = () => {
    const { userId, trackers, entries, from } = get()
    if (userId) save(userId, { trackers, entries, from })
  }

  // The outbox is the queue; this only wakes it and takes in what it refused: an entry whose write
  // was refused leaves the screen at once (unless a newer write of it waits), the notice goes up,
  // and a pull brings back the server's copy of anything else (`pull` is false inside a refresh,
  // whose reads come next anyway).
  const flush = async (pull: boolean) => {
    const userId = get().userId
    if (!userId) return
    const gen = generation
    const refused: { op: TrackerOp; detail: string }[] = []
    const stop = trackersOutbox.onRefused((u, op, detail) => { if (u === userId) refused.push({ op, detail }) })
    try { await trackersOutbox.flush(userId) } finally { stop() }
    if (gen !== generation || !refused.length) return
    // An edit refused for an option that still has entries goes again once the pull brings the
    // server's options; one already made again that is refused anyway is a plain refusal.
    const details = refused.map(({ op, detail }) => {
      if (op.op !== 'tracker' || detail !== 'option_in_use') return detail
      if (op.kept) return 'refused'
      retries.push(op.row)
      return detail
    })
    const waiting = new Set(trackersOutbox.pending(userId).flatMap(op => (op.op === 'entry' ? [op.row.id] : op.op === 'delete' ? [op.id] : [])))
    const gone = new Set(refused.flatMap(({ op }) => (op.op === 'entry' && !waiting.has(op.row.id) ? [op.row.id] : [])))
    const text = droppedNoticeText(reasonOf(details))
    const shown = get().droppedNotice
    set(s => ({
      entries: gone.size ? s.entries.filter(e => !gone.has(e.id)) : s.entries,
      droppedNotice: shown && shown !== text ? droppedNoticeText('refused') : text
    }))
    persist()
    if (pull) void get().refresh()
  }
  const queue = (op: TrackerOp) => {
    const userId = get().userId
    if (!userId) return
    trackersOutbox.enqueue(userId, op)
    void flush(true)
  }

  const write = (next: Tracker, kept = false) => {
    writes++
    set({ trackers: [...get().trackers.filter(x => x.id !== next.id), next].sort(byOrder) })
    persist()
    queue(kept ? { op: 'tracker', row: next, kept: true } : { op: 'tracker', row: next })
  }

  return {
    userId: null,
    status: 'idle',
    ...empty(),
    droppedNotice: null,

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // what is waiting in the queue goes out and everything is pulled.
    bind(userId) {
      if (get().userId === userId) return Promise.resolve()
      const saved = readSaved(userId)
      generation++
      refreshing = null
      pullAgain = false
      retries = []
      set({
        userId, droppedNotice: null, status: saved ? 'ready' : 'loading',
        trackers: saved?.trackers ?? [], entries: saved?.entries ?? [], from: saved?.from ?? windowStart(todayNow())
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
        try { await flush(false) } catch { /* kept for the next refresh */ }
        if (gen !== generation) return
        // What is still queued now may go out while the reads are on their way, and leave the queue:
        // laid over the answer if it went, left out if the server refused it.
        const queued = trackersOutbox.pending(userId)
        const refused = new Set<string>()
        const stop = trackersOutbox.onRefused((u, op) => { if (u === userId) refused.add(JSON.stringify(op)) })
        const from = windowStart(todayNow())
        try {
          const [trackers, entries] = await Promise.all([api.fetchTrackers(), api.fetchEntries(from)]).finally(stop)
          if (gen !== generation) return
          if (writes !== seen) { pullAgain = true; return }
          const ops = [...queued.filter(op => !refused.has(JSON.stringify(op))), ...trackersOutbox.pending(userId)]
          set({ ...applyPending(ops, { trackers, entries }), from, status: 'ready' })
          persist()
          const edits = retries
          retries = []
          for (const edit of edits) {
            const server = trackers.find(x => x.id === edit.id)
            if (server) write(keepOptions(edit, server), true)
          }
        } catch {
          if (gen !== generation) return
          set(s => ({ status: s.status === 'ready' ? 'ready' : 'error' }))
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
      if (userId && trackersOutbox.pending(userId).length) await flush(true)
    },

    reset() {
      generation++
      refreshing = null
      pullAgain = false
      retries = []
      drop()
      set({ userId: null, status: 'idle', ...empty(), droppedNotice: null })
    },

    dismissDropped() { set({ droppedNotice: null }) },

    active() {
      return get().trackers.filter(x => !x.archived_at)
    },

    archived() {
      return get().trackers.filter(x => x.archived_at)
    },

    saveTracker(input) {
      const now = new Date().toISOString()
      const { trackers } = get()
      const old = input.id ? trackers.find(x => x.id === input.id) : undefined
      const pick = <K extends 'unit' | 'decimals' | 'aggregate' | 'options'>(k: K, fallback: Tracker[K]): Tracker[K] =>
        input[k] !== undefined ? (input[k] as Tracker[K]) : fallback
      if (old) {
        const tracker: Tracker = {
          ...old, name: input.name.trim(), icon: input.icon, unit: pick('unit', old.unit), decimals: pick('decimals', old.decimals),
          aggregate: pick('aggregate', old.aggregate), options: pick('options', old.options), updated_at: now
        }
        write(tracker)
        return tracker
      }
      if (get().active().length >= MAX_ACTIVE_TRACKERS) throw tooManyTrackers()
      const sort = trackers.reduce((m, x) => Math.max(m, x.sort + 1), 0)
      const tracker: Tracker = {
        id: input.id ?? crypto.randomUUID(), name: input.name.trim(), icon: input.icon, kind: input.kind,
        unit: pick('unit', null), decimals: pick('decimals', null), aggregate: pick('aggregate', null), options: pick('options', null),
        sort, archived_at: null, created_at: now, updated_at: now
      }
      write(tracker)
      return tracker
    },

    archiveTracker(id) {
      const x = get().trackers.find(y => y.id === id)
      if (!x || x.archived_at) return
      const now = new Date().toISOString()
      write({ ...x, archived_at: now, updated_at: now })
    },

    reactivateTracker(id) {
      const x = get().trackers.find(y => y.id === id)
      if (!x || !x.archived_at) return
      if (get().active().length >= MAX_ACTIVE_TRACKERS) throw tooManyTrackers()
      write({ ...x, archived_at: null, updated_at: new Date().toISOString() })
    },

    move(id, delta) {
      const list = get().active()
      const i = list.findIndex(x => x.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= list.length) return
      // The new order numbered 0..n-1, so equal or spread sorts cannot leave a tie; only the trackers
      // whose sort changed are written.
      const order = [...list]
      ;[order[i], order[j]] = [order[j], order[i]]
      const now = new Date().toISOString()
      const moved = new Map(order.flatMap((x, sort) => (x.sort !== sort ? [[x.id, sort] as const] : [])))
      if (!moved.size) return
      writes++
      set({ trackers: get().trackers.map(x => (moved.has(x.id) ? { ...x, sort: moved.get(x.id)! } : x)).sort(byOrder) })
      persist()
      // Only the sort goes: a full row from this copy could undo another device's archive or rename.
      for (const [tid, sort] of moved) queue({ op: 'sort', id: tid, sort, updated_at: now })
    },

    saveEntry(input) {
      const entry: TrackerEntry = {
        id: input.id ?? crypto.randomUUID(), tracker_id: input.tracker_id, day: input.day, at: input.at,
        value: input.value, minutes: input.minutes, option: input.option, note: input.note, updated_at: new Date().toISOString()
      }
      writes++
      set({ entries: [...get().entries.filter(e => e.id !== entry.id), entry].sort(byTime) })
      persist()
      queue({ op: 'entry', row: entry })
      return entry
    },

    deleteEntry(id) {
      if (!get().entries.some(e => e.id === id)) return
      writes++
      set({ entries: get().entries.filter(e => e.id !== id) })
      persist()
      queue({ op: 'delete', id })
    },

    entriesOf(trackerId) {
      return get().entries.filter(e => e.tracker_id === trackerId)
    },

    lastEntryOf(trackerId) {
      const list = get().entriesOf(trackerId)
      return list.length ? list[list.length - 1] : null
    }
  }
})

// Pull again when the app comes back to the screen or the network returns; the refresh sends the
// queue first. On each minute boundary: when the local day (profile time zone) has turned, pull
// again, since the 90-day window moves and a tab left open across midnight gets no focus or network
// event; otherwise a visible tab with something waiting sends it (no pull). Returns the cleanup.
export function startTrackersSync(): () => void {
  let day = todayNow()
  const run = () => { day = todayNow(); void useTrackers.getState().refresh() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  const tick = () => {
    if (todayNow() !== day) return run()
    if (document.visibilityState === 'visible') void useTrackers.getState().flushPending()
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
