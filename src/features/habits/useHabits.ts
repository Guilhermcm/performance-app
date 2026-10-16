import { create } from 'zustand'
import * as api from './habits-api'
import { habitsOutbox, type HabitOp } from './outbox'
import { HABITS_CACHE_KEY, HABITS_HISTORY_KEY } from './storage-keys'
import { canMark, habitWeekAwards, newTarget, weekSummary } from './week'
import { weekStartOf } from '../gamification/xp'
import { useProgress } from '../gamification/useProgress'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from '../nutrition/days'
import { isSettled, shiftMonth } from '../nutrition/history'
import { classify } from '@/lib/supabase-errors'
import { t } from '../../lib/i18n.js'
import type { Habit, HabitCheck, HabitHistory } from './types'

// The closed days kept on the phone for habitRun: the widest range get_habit_history answers, ending today.
export const RECENT_DAYS = 62
// The server refuses a 21st active habit (too_many_habits); the store refuses it first.
export const MAX_ACTIVE_HABITS = 20
// History months kept on the phone; the most recent stay.
const MAX_MONTHS = 24

// Why queued writes were dropped: 'day_closed' only when every drop was a closed day (as in useNutrition).
export type DroppedReason = 'day_closed' | 'refused'

// The text for droppedNotice, for the screen that shows it: a closed day says so; any other refusal
// (the pillar was off that day, an archived habit, too many habits) gets the general words.
export const droppedNoticeText = (reason: DroppedReason | null): string =>
  reason === 'day_closed' ? t('Some checks from days that already closed were not saved.') : t('Some checks could not be saved.')

type Targets = Record<string, number>
type Data = { habits: Habit[]; checks: HabitCheck[]; targets: Targets; targetsWeek: string | null; recent: HabitHistory | null }
type Saved = Data & { userId: string }

const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(HABITS_CACHE_KEY) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (userId: string, d: Data) => {
  try { localStorage.setItem(HABITS_CACHE_KEY, JSON.stringify({ ...d, userId })) } catch { /* full or blocked */ }
}
const drop = () => { try { localStorage.removeItem(HABITS_CACHE_KEY) } catch { /* ignore */ } }

// The calendar months already read, one account at a time, with the day each was read so a month
// whose rows have all closed (isSettled) is never asked again.
type SavedMonth = { fetchedOn: string; data: HabitHistory }
type HistoryCache = { userId: string; months: Record<string, SavedMonth> }

const readHistory = (userId: string): HistoryCache => {
  try {
    const c = JSON.parse(localStorage.getItem(HABITS_HISTORY_KEY) || 'null')
    if (c && c.userId === userId && c.months && typeof c.months === 'object') return { userId, months: c.months }
  } catch { /* broken or blocked: start over */ }
  return { userId, months: {} }
}
const writeHistory = (c: HistoryCache) => {
  const keep = Object.keys(c.months).sort().slice(-MAX_MONTHS)
  const months = Object.fromEntries(keep.map(k => [k, c.months[k]]))
  try { localStorage.setItem(HABITS_HISTORY_KEY, JSON.stringify({ ...c, months })) } catch { /* full or blocked */ }
}

const timezone = () => useProfile.getState().profile?.timezone
const todayNow = () => todayIn(timezone())

// List order, as the server sorts: habits.sort, then the id.
const byOrder = (a: Habit, b: Habit) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byDay = (a: HabitCheck, b: HabitCheck) =>
  a.day < b.day ? -1 : a.day > b.day ? 1 : a.habit_id < b.habit_id ? -1 : a.habit_id > b.habit_id ? 1 : 0
const keyOf = (habitId: string, day: string) => habitId + '|' + day

const createdOn = (h: Habit): string => {
  try { return todayIn(timezone(), new Date(h.created_at)) } catch { return '' }
}

// This week's target of a habit (plan decision 10): its frozen row; without one, an archived habit
// has none, a habit from before Monday gets its N (what freeze_habit_targets will write) and one
// created this week, the days left counting today (what the server gives it when the creation lands).
function targetOf(h: Habit, targets: Targets, today: string): number {
  if (Object.hasOwn(targets, h.id)) return targets[h.id]
  if (h.archived_at) return 0
  return createdOn(h) <= weekStartOf(today) ? h.per_week : newTarget(h.per_week, today)
}

// What habits_targets_sync (0026) does to this week's row when a habit changes, on the phone. A new
// habit gets no row: targetOf answers for it.
function retarget(prev: Habit | undefined, next: Habit, targets: Targets, checks: HabitCheck[], today: string): void {
  if (!prev) return
  if (!prev.archived_at && next.archived_at) {
    // Archived: down to the checks already made this week, so it cannot keep the week from 100%.
    const ws = weekStartOf(today)
    const done = checks.filter(c => c.habit_id === next.id && c.day >= ws && c.day <= today).length
    targets[next.id] = Math.min(targetOf(prev, targets, today), done)
  } else if (prev.archived_at && !next.archived_at) {
    // Reactivated: as if created today, never below what the week already had.
    targets[next.id] = Math.max(targets[next.id] ?? 0, newTarget(next.per_week, today))
  } else if (!next.archived_at && next.per_week !== prev.per_week) {
    // A new N counts from next week: this week keeps the old one.
    targets[next.id] = targetOf(prev, targets, today)
  }
}

// What the server sent, with the writes it may not have heard about yet laid on top, oldest first
// (laying one it already has changes nothing). A check op for a day before yesterday is left out:
// the server is about to refuse it.
function applyPending(ops: HabitOp[], d: Pick<Data, 'habits' | 'checks' | 'targets'>, today: string): Pick<Data, 'habits' | 'checks' | 'targets'> {
  const yesterday = shiftDay(today, -1)
  const habits = new Map(d.habits.map(h => [h.id, h]))
  const checks = new Map(d.checks.map(c => [keyOf(c.habit_id, c.day), c]))
  for (const op of ops) {
    if (op.op === 'habit' || op.op === 'sort' || op.day < yesterday) continue
    const k = keyOf(op.habit_id, op.day)
    if (op.op === 'uncheck') checks.delete(k)
    else if (!checks.has(k)) checks.set(k, { habit_id: op.habit_id, day: op.day, counted: null })
  }
  const laid = [...checks.values()].sort(byDay)
  const targets = { ...d.targets }
  for (const op of ops) {
    if (op.op === 'sort') {
      // A reorder moves the habit and touches nothing else of it.
      const h = habits.get(op.id)
      if (h) habits.set(op.id, { ...h, sort: op.sort })
      continue
    }
    if (op.op !== 'habit') continue
    retarget(habits.get(op.row.id), op.row, targets, laid, today)
    habits.set(op.row.id, op.row)
  }
  return { habits: [...habits.values()].sort(byOrder), checks: laid, targets }
}

export type HabitsStore = {
  userId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  stale: boolean
  // Active and archived, in list order.
  habits: Habit[]
  // From min(Monday, yesterday) to today (plan decision 10), oldest first.
  checks: HabitCheck[]
  // The frozen targets of the week starting on targetsWeek, by habit id, with the local changes on top.
  targets: Targets
  targetsWeek: string | null
  // get_habit_history(today - 61, today), for habitRun.
  recent: HabitHistory | null
  // Some queued writes were refused for good (a day that closed meanwhile); raised once per drop.
  droppedNotice: boolean
  droppedReason: DroppedReason | null
  bind(userId: string): Promise<void>
  refresh(): Promise<void>
  // Sends what is waiting in the queue, if anything; no pull.
  flushPending(): Promise<void>
  reset(): void
  dismissDropped(): void
  // Creates (a new id from crypto.randomUUID) or edits. A 21st active habit throws the server's own
  // too_many_habits refusal (toHabitError reads it).
  saveHabit(input: Pick<Habit, 'name' | 'icon' | 'per_week'> & { id?: string }): Habit
  archiveHabit(id: string): void
  // Throws too_many_habits like saveHabit.
  reactivateHabit(id: string): void
  // Moves an active habit one place up (-1) or down (1) (plan decision 13): the active habits are
  // renumbered 0..n-1 in the new order, and each one whose sort changed queues its sort alone.
  move(id: string, dir: -1 | 1): void
  // Today, and yesterday while it is inside a period of the pillar (canMark); any other day is left as it is.
  toggleCheck(habitId: string, day: string): void
  active(): Habit[]
  // The week of `today`: Q, C and the XP it is on track for over every check (plan decision 12).
  week(today: string): { q: number; c: number; xp: number; byHabit: Record<string, { target: number; done: number; valid: number }> }
  // A calendar month (YYYY-MM) up to today; null for a month still to come, or offline with no saved copy.
  loadMonth(month: string): Promise<HabitHistory | null>
}

const empty = (): Data => ({ habits: [], checks: [], targets: {}, targetsWeek: null, recent: null })

const tooManyHabits = () => classify({ code: 'P0001', message: 'too_many_habits' })

// Bumped by reset() and bind(): an answer from before a sign-out must not land in the next account's store.
let generation = 0
let refreshing: Promise<void> | null = null
// Bumped by every local change. A pull that started before one read the server without it (its op
// may even have gone and left the queue meanwhile), so its answer is dropped and the pull runs again.
let writes = 0
let pullAgain = false

export const useHabits = create<HabitsStore>((set, get) => {
  const persist = () => {
    const { userId, habits, checks, targets, targetsWeek, recent } = get()
    if (userId) save(userId, { habits, checks, targets, targetsWeek, recent })
  }

  // The outbox is the queue; this only wakes it and takes in what happened to it.
  const flush = async () => {
    const userId = get().userId
    if (!userId) return
    const gen = generation
    const r = await habitsOutbox.flush(userId)
    if (gen !== generation) return
    if (r.dropped > 0) {
      const onlyClosed = r.reasons.every(x => x === 'day_closed') && get().droppedReason !== 'refused'
      set({ droppedNotice: true, droppedReason: onlyClosed ? 'day_closed' : 'refused' })
    }
  }
  const queue = (op: HabitOp) => {
    const userId = get().userId
    if (!userId) return
    habitsOutbox.enqueue(userId, op)
    void flush()
  }

  // This week's targets as a copy to change: a saved copy from an earlier week has none yet.
  const weekTargets = (today: string): Targets => {
    const { targets, targetsWeek } = get()
    return targetsWeek === weekStartOf(today) ? { ...targets } : {}
  }

  // Writes a habit locally, adjusts this week's target the way the server will, and queues it.
  const write = (next: Habit) => {
    const today = todayNow()
    const { habits, checks } = get()
    const targets = weekTargets(today)
    retarget(habits.find(h => h.id === next.id), next, targets, checks, today)
    writes++
    set({ habits: [...habits.filter(h => h.id !== next.id), next].sort(byOrder), targets, targetsWeek: weekStartOf(today) })
    persist()
    queue({ op: 'habit', row: next })
  }

  return {
    userId: null,
    status: 'idle',
    stale: false,
    ...empty(),
    droppedNotice: false,
    droppedReason: null,

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // what is waiting in the queue goes out and everything is pulled.
    bind(userId) {
      if (get().userId === userId) return Promise.resolve()
      const saved = readSaved(userId)
      generation++
      refreshing = null
      pullAgain = false
      set({
        userId, droppedNotice: false, droppedReason: null,
        status: saved ? 'ready' : 'loading', stale: !!saved,
        habits: saved?.habits ?? [], checks: saved?.checks ?? [], targets: saved?.targets ?? {},
        targetsWeek: saved?.targetsWeek ?? null, recent: saved?.recent ?? null
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
        // What is still queued now may go out while the reads are on their way, and leave the queue:
        // laid over the answer if it went, left out if the server refused it (review T7).
        const queued = habitsOutbox.pending(userId)
        const refused = new Set<string>()
        const stop = habitsOutbox.onRefused((u, op) => { if (u === userId) refused.add(JSON.stringify(op)) })
        const today = todayNow()
        const yesterday = shiftDay(today, -1)
        const week = weekStartOf(today)
        const before = new Set(get().recent?.days.map(d => d.day) ?? [])
        try {
          const [habits, checks, targets, recent] = await Promise.all([
            api.fetchHabits(), api.fetchChecks(week < yesterday ? week : yesterday, today), api.fetchTargets(week),
            api.fetchHistory(shiftDay(today, -(RECENT_DAYS - 1)), today)
          ]).finally(stop)
          if (gen !== generation) return
          if (writes !== seen) { pullAgain = true; return }
          const server = { habits, checks, targets: Object.fromEntries(targets.map(x => [x.habit_id, x.target])) }
          const ops = [...queued.filter(op => !refused.has(JSON.stringify(op))), ...habitsOutbox.pending(userId)]
          set({ ...applyPending(ops, server, today), targetsWeek: week, recent, status: 'ready', stale: false })
          persist()
          // Reading the history closes the due days on the server, which can pay XP.
          if (recent.days.some(d => !before.has(d.day))) void useProgress.getState().refresh()
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
      if (userId && habitsOutbox.pending(userId).length) await flush()
    },

    reset() {
      generation++
      refreshing = null
      pullAgain = false
      drop()
      set({ userId: null, status: 'idle', stale: false, ...empty(), droppedNotice: false, droppedReason: null })
    },

    dismissDropped() { set({ droppedNotice: false, droppedReason: null }) },

    saveHabit(input) {
      const now = new Date().toISOString()
      const fields = { name: input.name.trim(), icon: input.icon, per_week: input.per_week }
      const { habits } = get()
      const old = input.id ? habits.find(h => h.id === input.id) : undefined
      if (old) {
        const habit: Habit = { ...old, ...fields, updated_at: now }
        write(habit)
        return habit
      }
      if (get().active().length >= MAX_ACTIVE_HABITS) throw tooManyHabits()
      const sort = habits.reduce((m, h) => Math.max(m, h.sort + 1), 0)
      const habit: Habit = { id: input.id ?? crypto.randomUUID(), ...fields, sort, archived_at: null, created_at: now, updated_at: now }
      write(habit)
      return habit
    },

    archiveHabit(id) {
      const h = get().habits.find(x => x.id === id)
      if (!h || h.archived_at) return
      const now = new Date().toISOString()
      write({ ...h, archived_at: now, updated_at: now })
    },

    reactivateHabit(id) {
      const h = get().habits.find(x => x.id === id)
      if (!h || !h.archived_at) return
      if (get().active().length >= MAX_ACTIVE_HABITS) throw tooManyHabits()
      write({ ...h, archived_at: null, updated_at: new Date().toISOString() })
    },

    move(id, dir) {
      const list = get().active()
      const i = list.findIndex(h => h.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return
      // The new order numbered 0..n-1, so equal or spread sorts cannot leave a tie; only the habits
      // whose sort changed are written.
      const order = [...list]
      ;[order[i], order[j]] = [order[j], order[i]]
      const now = new Date().toISOString()
      const moved = new Map(order.flatMap((h, sort) => (h.sort !== sort ? [[h.id, sort] as const] : [])))
      if (!moved.size) return
      writes++
      set({ habits: get().habits.map(h => (moved.has(h.id) ? { ...h, sort: moved.get(h.id)! } : h)).sort(byOrder) })
      persist()
      // Only the sort goes (review M2): a full row from this copy could undo another device's archive or rename.
      for (const [id, sort] of moved) queue({ op: 'sort', id, sort, updated_at: now })
    },

    toggleCheck(habitId, day) {
      const today = todayNow()
      if (!canMark(day, today, get().recent?.periods ?? null)) return
      const { checks } = get()
      const had = checks.some(c => c.habit_id === habitId && c.day === day)
      writes++
      set({
        checks: had
          ? checks.filter(c => !(c.habit_id === habitId && c.day === day))
          : [...checks, { habit_id: habitId, day, counted: null }].sort(byDay)
      })
      persist()
      queue({ op: had ? 'uncheck' : 'check', habit_id: habitId, day })
    },

    active() {
      return get().habits.filter(h => !h.archived_at)
    },

    week(today) {
      const ws = weekStartOf(today)
      const { habits, targetsWeek } = get()
      const rows = targetsWeek === ws ? get().targets : {}
      const targets = Object.fromEntries(habits.map(h => [h.id, targetOf(h, rows, today)]))
      const checks = get().checks.filter(c => c.day >= ws && c.day <= today)
      const { q, c, byHabit } = weekSummary(checks, targets, habits)
      const awards = habitWeekAwards({
        habits: habits.map(h => ({ id: h.id, sort: h.sort, target: targets[h.id] })),
        checks: checks.map(x => ({ habit: x.habit_id, day: x.day }))
      })
      return { q, c, xp: awards.reduce((s, a) => s + a.amount, 0), byHabit }
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
        const data = await api.fetchHistory(from, last < today ? last : today)
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
// needs the new today and yesterday (and a new week on Monday); otherwise a visible tab with
// something waiting sends it (no pull). Returns the cleanup.
export function startHabitsSync(): () => void {
  let day = todayNow()
  const run = () => { day = todayNow(); void useHabits.getState().refresh() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  const tick = () => {
    if (todayNow() !== day) return run()
    if (document.visibilityState === 'visible') void useHabits.getState().flushPending()
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
