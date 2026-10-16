// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
const api = vi.hoisted(() => ({
  fetchHabits: vi.fn(), upsertHabit: vi.fn(), fetchChecks: vi.fn(), insertCheck: vi.fn(), deleteCheck: vi.fn(),
  fetchTargets: vi.fn(), fetchHistory: vi.fn()
}))
vi.mock('./habits-api', async orig => ({ ...(await orig<typeof import('./habits-api')>()), ...api }))
const progress = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => progress } }))

import { useHabits, startHabitsSync, droppedNoticeText } from './useHabits'
import { habitsOutbox } from './outbox'
import { toHabitError } from './habits-api'
import { useProfile } from '../profile/useProfile'
import { ME, OTHER, H1, H2, habitOf } from './test-habits'
import type { HabitCheck, HabitHistory } from './types'

// 12:00 in Sao Paulo (the zone used without a profile) on Wednesday 2026-10-07; the week started on Monday 5.
const NOW = new Date('2026-10-07T15:00:00Z')
const MON = '2026-10-05', TUE = '2026-10-06', TODAY = '2026-10-07'
const CACHE = 'perf_habits_v1', HISTORY = 'perf_habits_history_v1'
const cache = () => JSON.parse(localStorage.getItem(CACHE) || 'null')
const settle = () => new Promise(r => setTimeout(r, 0))
const history = (over: Partial<HabitHistory> = {}): HabitHistory =>
  ({ days: [], checks: [], targets: [], periods: [{ started_on: '2026-09-01', ended_on: null }], ...over })
const checkOf = (habit_id: string, day: string, counted: boolean | null = null): HabitCheck => ({ habit_id, day, counted })
const refused = (m: string) => Object.assign(new Error(m), { code: 'P0001' })

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear(); habitsOutbox.clear()
  useProfile.setState({ profile: null })
  useHabits.getState().reset()
  Object.values(api).forEach(f => f.mockReset().mockResolvedValue(undefined))
  progress.refresh.mockReset()
  api.fetchHabits.mockResolvedValue([]); api.fetchChecks.mockResolvedValue([]); api.fetchTargets.mockResolvedValue([])
  api.fetchHistory.mockResolvedValue(history())
})

async function bound() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  await useHabits.getState().bind(ME)
}

// H1 "Read" 3 a week with its frozen target; H2 "Walk" 2 a week, archived last week.
async function withHabits(checks: HabitCheck[] = []) {
  api.fetchHabits.mockResolvedValue([habitOf(), habitOf({ id: H2, name: 'Walk', per_week: 2, sort: 1, archived_at: '2026-09-30T10:00:00.000Z' })])
  api.fetchTargets.mockResolvedValue([{ habit_id: H1, week_start: MON, target: 3 }])
  api.fetchChecks.mockResolvedValue(checks)
  await bound()
}

describe('useHabits', () => {
  it('shows the saved copy at once and marks it stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
    const saved = { userId: ME, habits: [habitOf()], checks: [checkOf(H1, TODAY)], targets: { [H1]: 3 }, targetsWeek: MON, recent: history() }
    localStorage.setItem(CACHE, JSON.stringify(saved))
    let release!: (v: unknown[]) => void
    api.fetchHabits.mockReturnValue(new Promise(r => { release = r }))
    const p = useHabits.getState().bind(ME)
    const s = useHabits.getState()
    expect(s).toMatchObject({ userId: ME, status: 'ready', stale: true, habits: [habitOf()], checks: [checkOf(H1, TODAY)], targets: { [H1]: 3 } })
    release([]); await p
    expect(useHabits.getState()).toMatchObject({ stale: false, habits: [], checks: [] })
  })

  it('ignores a saved copy that belongs to someone else', () => {
    localStorage.setItem(CACHE, JSON.stringify({ userId: OTHER, habits: [habitOf()], checks: [], targets: {}, targetsWeek: MON, recent: null }))
    api.fetchHabits.mockReturnValue(new Promise(() => {}))
    void useHabits.getState().bind(ME)
    expect(useHabits.getState()).toMatchObject({ habits: [], status: 'loading' })
  })

  it('pulls the habits, the checks since Monday, the week targets and the last 62 days', async () => {
    const recent = history({ days: [{ day: '2026-10-04', checks: 1, valid: 1, xp: 116 }] })
    api.fetchHistory.mockResolvedValue(recent)
    await withHabits([checkOf(H1, MON, null)])
    expect(api.fetchChecks).toHaveBeenCalledWith(MON, TODAY)
    expect(api.fetchTargets).toHaveBeenCalledWith(MON)
    expect(api.fetchHistory).toHaveBeenCalledWith('2026-08-07', TODAY)
    const s = useHabits.getState()
    expect(s).toMatchObject({ status: 'ready', stale: false, checks: [checkOf(H1, MON)], targets: { [H1]: 3 }, recent })
    expect(s.habits.map(h => h.id)).toEqual([H1, H2])
    expect(s.active().map(h => h.id)).toEqual([H1])
    expect(cache()).toMatchObject({ userId: ME, targets: { [H1]: 3 }, recent })
    // Reading the history closes due days on the server, which can pay XP.
    expect(progress.refresh).toHaveBeenCalledTimes(1)
    await useHabits.getState().refresh()
    expect(progress.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the saved copy and marks it stale when the pull fails', async () => {
    localStorage.setItem(CACHE, JSON.stringify({ userId: ME, habits: [habitOf()], checks: [], targets: {}, targetsWeek: MON, recent: null }))
    api.fetchHistory.mockRejectedValue(new TypeError('Failed to fetch'))
    await bound()
    expect(useHabits.getState()).toMatchObject({ status: 'ready', stale: true, habits: [habitOf()] })
  })

  it('is an error without a saved copy, and the screen can still act', async () => {
    api.fetchHabits.mockRejectedValue(new TypeError('Failed to fetch'))
    await bound()
    expect(useHabits.getState().status).toBe('error')
    const h = useHabits.getState().saveHabit({ name: 'Read', icon: 'book', per_week: 3 })
    useHabits.getState().toggleCheck(h.id, TODAY)
    expect(useHabits.getState().active()).toEqual([h])
    expect(useHabits.getState().checks).toEqual([checkOf(h.id, TODAY)])
    // The next pull that works takes the screen out of the error.
    api.fetchHabits.mockResolvedValue([h])
    api.fetchChecks.mockResolvedValue([checkOf(h.id, TODAY)])
    await useHabits.getState().refresh()
    expect(useHabits.getState()).toMatchObject({ status: 'ready', stale: false })
  })

  it('checks optimistically and queues', async () => {
    await withHabits()
    let release!: () => void
    api.insertCheck.mockReturnValue(new Promise<void>(r => { release = r }))
    useHabits.getState().toggleCheck(H1, TODAY)
    expect(useHabits.getState().checks).toEqual([checkOf(H1, TODAY)])
    expect(cache().checks).toEqual([checkOf(H1, TODAY)])
    expect(habitsOutbox.pending(ME)).toEqual([{ op: 'check', habit_id: H1, day: TODAY }])
    await settle()
    expect(api.insertCheck).toHaveBeenCalledWith(H1, TODAY)
    release(); await settle()
    expect(habitsOutbox.pending(ME)).toEqual([])
    // The undo, the same day.
    useHabits.getState().toggleCheck(H1, TODAY)
    expect(useHabits.getState().checks).toEqual([])
    await settle()
    expect(api.deleteCheck).toHaveBeenCalledWith(H1, TODAY)
    // Only today and yesterday can change.
    useHabits.getState().toggleCheck(H1, MON)
    expect(useHabits.getState().checks).toEqual([])
    expect(habitsOutbox.pending(ME)).toEqual([])
  })

  it('lays what is still queued over what the server sent', async () => {
    await withHabits([checkOf(H1, TUE)])
    api.insertCheck.mockRejectedValue(new TypeError('Failed to fetch'))
    api.deleteCheck.mockRejectedValue(new TypeError('Failed to fetch'))
    api.upsertHabit.mockRejectedValue(new TypeError('Failed to fetch'))
    useHabits.getState().toggleCheck(H1, TUE)
    useHabits.getState().toggleCheck(H1, TODAY)
    const walk = useHabits.getState().saveHabit({ name: 'Walk', icon: 'footprints', per_week: 2 })
    await settle()
    await useHabits.getState().refresh()
    const s = useHabits.getState()
    expect(s.checks).toEqual([checkOf(H1, TODAY)])
    expect(s.habits.map(h => h.id)).toEqual([H1, H2, walk.id])
  })

  it('keeps a check made while a pull was on its way, and pulls again', async () => {
    await withHabits()
    let release!: (v: HabitHistory) => void
    api.fetchHistory.mockReturnValueOnce(new Promise(r => { release = r }))
    const first = useHabits.getState().refresh()
    await settle()
    expect(api.fetchHistory).toHaveBeenCalledTimes(2)
    // The tap lands after the reads went out; its insert goes and leaves the queue before they answer.
    useHabits.getState().toggleCheck(H1, TODAY)
    await settle()
    expect(api.insertCheck).toHaveBeenCalledWith(H1, TODAY)
    expect(habitsOutbox.pending(ME)).toEqual([])
    api.fetchChecks.mockResolvedValue([checkOf(H1, TODAY)])
    release(history())
    await first
    expect(useHabits.getState().checks).toEqual([checkOf(H1, TODAY)])
    // The second pull, started as the first one ended, reads the server with the check.
    await useHabits.getState().refresh()
    expect(api.fetchHistory).toHaveBeenCalledTimes(3)
    expect(useHabits.getState().checks).toEqual([checkOf(H1, TODAY)])
  })

  it('keeps a habit created while a pull was on its way', async () => {
    await withHabits()
    let release!: (v: unknown[]) => void
    api.fetchHabits.mockReturnValueOnce(new Promise(r => { release = r }))
    const first = useHabits.getState().refresh()
    await settle()
    const walk = useHabits.getState().saveHabit({ name: 'Walk', icon: 'footprints', per_week: 2 })
    await settle()
    expect(habitsOutbox.pending(ME)).toEqual([])
    release([habitOf()])
    await first
    expect(useHabits.getState().active().map(h => h.id)).toEqual([H1, walk.id])
  })

  it('lays a write that left the queue during the reads over their answer', async () => {
    await withHabits()
    // Queued while offline; the reads go out, and the minute tick sends it before they answer.
    api.insertCheck.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    useHabits.getState().toggleCheck(H1, TODAY)
    await settle()
    expect(habitsOutbox.pending(ME)).toHaveLength(1)
    api.insertCheck.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    let release!: (v: HabitHistory) => void
    api.fetchHistory.mockReturnValueOnce(new Promise(r => { release = r }))
    const pull = useHabits.getState().refresh()
    await settle()
    await useHabits.getState().flushPending()
    expect(habitsOutbox.pending(ME)).toEqual([])
    release(history())
    await pull
    expect(useHabits.getState().checks).toEqual([checkOf(H1, TODAY)])
  })

  it('raises the dropped notice once for closed days', async () => {
    await withHabits()
    // Back after three days: the check of the day before yesterday is still in the queue.
    habitsOutbox.enqueue(ME, { op: 'check', habit_id: H1, day: MON })
    habitsOutbox.enqueue(ME, { op: 'check', habit_id: H1, day: TODAY })
    api.insertCheck.mockImplementation(async (_h: string, day: string) => { if (day === MON) throw refused('day_closed') })
    await useHabits.getState().refresh()
    expect(useHabits.getState().droppedNotice).toBe(true)
    expect(api.insertCheck).toHaveBeenCalledTimes(2)
    expect(habitsOutbox.pending(ME)).toEqual([])
    useHabits.getState().dismissDropped()
    await useHabits.getState().refresh()
    await useHabits.getState().flushPending()
    expect(useHabits.getState().droppedNotice).toBe(false)
    expect(droppedNoticeText()).toBe('Some checks from days that already closed were not saved.')
  })

  it('uses the days-left target for a habit created offline', async () => {
    await withHabits()
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    api.upsertHabit.mockRejectedValue(new TypeError('Failed to fetch'))
    const h = useHabits.getState().saveHabit({ name: 'Stretch', icon: 'leaf', per_week: 7 })
    expect(h).toMatchObject({ id: '00000000-0000-4000-8000-000000000001', name: 'Stretch', per_week: 7, sort: 2, archived_at: null, updated_at: NOW.toISOString() })
    expect(habitsOutbox.pending(ME)).toEqual([{ op: 'habit', row: h }])
    // Wednesday: five days left, today included.
    const w = useHabits.getState().week(TODAY)
    expect(w.byHabit[h.id]).toEqual({ target: 5, done: 0, valid: 0 })
    expect(w.q).toBe(3 + 5)
    // A pull while it is still queued: the server has no target row for it yet.
    await useHabits.getState().refresh()
    expect(useHabits.getState().week(TODAY).byHabit[h.id].target).toBe(5)
    // A habit from before Monday whose week has not frozen yet counts with its N.
    useHabits.setState({ targets: {} })
    expect(useHabits.getState().week(TODAY).byHabit[H1].target).toBe(3)
  })

  it('edits a habit in place, keeping the week target', async () => {
    await withHabits()
    useHabits.setState({ targets: {} })
    const e = useHabits.getState().saveHabit({ id: H1, name: 'Read 20 pages', icon: 'book', per_week: 5 })
    expect(e).toMatchObject({ id: H1, name: 'Read 20 pages', per_week: 5, sort: 0, created_at: habitOf().created_at })
    expect(useHabits.getState().habits[0]).toEqual(e)
    // The new N counts from next week: this one stays at 3.
    expect(useHabits.getState().targets[H1]).toBe(3)
    expect(useHabits.getState().week(TODAY).byHabit[H1].target).toBe(3)
  })

  it('lowers the local target on archive', async () => {
    await withHabits([checkOf(H1, MON), checkOf(H1, TUE)])
    expect(useHabits.getState().week(TODAY)).toMatchObject({ q: 3, c: 2 })
    useHabits.getState().archiveHabit(H1)
    const s = useHabits.getState()
    expect(s.targets[H1]).toBe(2)
    expect(s.habits[0].archived_at).toBe(NOW.toISOString())
    expect(s.active()).toEqual([])
    expect(s.week(TODAY)).toMatchObject({ q: 2, c: 2 })
    expect(habitsOutbox.pending(ME)).toEqual([{ op: 'habit', row: s.habits[0] }])
    // Back the same week: never below the checks already counted, at most the days left.
    useHabits.getState().reactivateHabit(H1)
    expect(useHabits.getState().targets[H1]).toBe(3)
    expect(useHabits.getState().active().map(h => h.id)).toEqual([H1])
  })

  it('blocks the 21st active habit locally', async () => {
    api.fetchHabits.mockResolvedValue([
      ...Array.from({ length: 20 }, (_, i) => habitOf({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, sort: i })),
      habitOf({ id: H2, sort: 20, archived_at: '2026-09-30T10:00:00.000Z' })
    ])
    await bound()
    const e = (() => { try { useHabits.getState().saveHabit({ name: 'One more', icon: 'check', per_week: 1 }) } catch (x) { return x } })()
    expect(toHabitError(e)).toBe('too_many_habits')
    expect(() => useHabits.getState().reactivateHabit(H2)).toThrow()
    expect(useHabits.getState().active()).toHaveLength(20)
    expect(habitsOutbox.pending(ME)).toEqual([])
    // Editing one of the 20 is fine.
    expect(() => useHabits.getState().saveHabit({ id: '00000000-0000-4000-8000-000000000100', name: 'Read', icon: 'book', per_week: 4 })).not.toThrow()
  })

  it('moves a habit by swapping its sort with the neighbour', async () => {
    api.fetchHabits.mockResolvedValue([habitOf({ sort: 0 }), habitOf({ id: H2, name: 'Walk', sort: 1 })])
    await bound()
    useHabits.getState().move(H2, -1)
    expect(useHabits.getState().active().map(h => [h.id, h.sort])).toEqual([[H2, 0], [H1, 1]])
    expect(habitsOutbox.pending(ME).map(o => (o.op === 'habit' ? [o.row.id, o.row.sort] : null))).toEqual([[H2, 0], [H1, 1]])
    // Nothing above the first one.
    useHabits.getState().move(H2, -1)
    expect(habitsOutbox.pending(ME)).toHaveLength(2)
  })

  it('renumbers equal sorts before a move and writes only what changed', async () => {
    const H3 = '00000000-0000-0000-0000-0000000000c3'
    api.fetchHabits.mockResolvedValue([habitOf({ sort: 0 }), habitOf({ id: H2, sort: 0 }), habitOf({ id: H3, sort: 0 })])
    await bound()
    useHabits.getState().move(H3, -1)
    expect(useHabits.getState().active().map(h => [h.id, h.sort])).toEqual([[H1, 0], [H3, 1], [H2, 2]])
    // H1 already had 0: only the two others go.
    expect(habitsOutbox.pending(ME).map(o => (o.op === 'habit' ? [o.row.id, o.row.sort] : null))).toEqual([[H3, 1], [H2, 2]])
  })

  it('adds up the week and the XP it is on track for', async () => {
    await withHabits([checkOf(H1, MON), checkOf(H1, TUE), checkOf(H1, TODAY)])
    // Q 3, P 7: three checks of round(600 / 7) = 86, three days of 30 and the week bonus round(150 * 3 / 7) = 64.
    expect(useHabits.getState().week(TODAY)).toEqual({
      q: 3, c: 3, xp: 3 * 86 + 3 * 30 + 64,
      byHabit: { [H1]: { target: 3, done: 3, valid: 3 }, [H2]: { target: 0, done: 0, valid: 0 } }
    })
  })

  it('rereads on day change', async () => {
    // 23:59 of Sunday 11 October in Tokyo (still 14:59 UTC); the week started on Monday 5.
    useProfile.setState({ profile: { timezone: 'Asia/Tokyo' } as never })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-11T14:59:00Z'))
    await useHabits.getState().bind(ME)
    expect(api.fetchChecks).toHaveBeenLastCalledWith(MON, '2026-10-11')
    const stop = startHabitsSync()
    vi.advanceTimersByTime(60_000)
    await useHabits.getState().refresh()
    // Monday 00:00 in Tokyo: a new week, and Sunday is still yesterday, so it stays open.
    expect(api.fetchChecks).toHaveBeenLastCalledWith('2026-10-11', '2026-10-12')
    expect(api.fetchTargets).toHaveBeenLastCalledWith('2026-10-12')
    expect(api.fetchHistory).toHaveBeenLastCalledWith('2026-08-12', '2026-10-12')
    vi.advanceTimersByTime(60_000)
    expect(api.fetchChecks).toHaveBeenCalledTimes(2)
    stop()
  })

  it('reads a month once it has settled and keeps it per account', async () => {
    await bound()
    const aug = history({ days: [{ day: '2026-08-10', checks: 1, valid: 1, xp: 116 }] })
    api.fetchHistory.mockResolvedValue(aug)
    await expect(useHabits.getState().loadMonth('2026-08')).resolves.toEqual(aug)
    expect(api.fetchHistory).toHaveBeenLastCalledWith('2026-08-01', '2026-08-31')
    expect(JSON.parse(localStorage.getItem(HISTORY)!)).toMatchObject({ userId: ME, months: { '2026-08': { fetchedOn: TODAY, data: aug } } })
    api.fetchHistory.mockClear()
    await expect(useHabits.getState().loadMonth('2026-08')).resolves.toEqual(aug)
    expect(api.fetchHistory).not.toHaveBeenCalled()
    // The current month is asked again, up to today, and the saved copy answers when offline.
    const oct = history({ days: [{ day: '2026-10-02', checks: 1, valid: 1, xp: 116 }] })
    api.fetchHistory.mockResolvedValue(oct)
    await expect(useHabits.getState().loadMonth('2026-10')).resolves.toEqual(oct)
    expect(api.fetchHistory).toHaveBeenLastCalledWith('2026-10-01', TODAY)
    api.fetchHistory.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(useHabits.getState().loadMonth('2026-10')).resolves.toEqual(oct)
    await expect(useHabits.getState().loadMonth('2026-07')).resolves.toBeNull()
    await expect(useHabits.getState().loadMonth('2026-11')).resolves.toBeNull()
    // Another account never reads this copy.
    useHabits.getState().reset()
    await useHabits.getState().bind(OTHER)
    await expect(useHabits.getState().loadMonth('2026-08')).resolves.toBeNull()
  })

  it('drops everything on reset', async () => {
    api.fetchHistory.mockResolvedValue(history({ days: [{ day: '2026-10-04', checks: 1, valid: 1, xp: 116 }] }))
    await withHabits([checkOf(H1, TODAY)])
    useHabits.setState({ droppedNotice: true })
    let release!: (v: unknown) => void
    api.fetchHistory.mockReturnValue(new Promise(r => { release = r }))
    const late = useHabits.getState().refresh()
    useHabits.getState().reset()
    expect(useHabits.getState()).toMatchObject({ userId: null, status: 'idle', stale: false, habits: [], checks: [], targets: {}, recent: null, droppedNotice: false })
    expect(localStorage.getItem(CACHE)).toBeNull()
    // An answer for the previous account lands nowhere.
    release(history({ days: [{ day: '2026-10-05', checks: 1, valid: 1, xp: 116 }] })); await late
    expect(useHabits.getState().recent).toBeNull()
    expect(localStorage.getItem(CACHE)).toBeNull()
  })

  it('binds another account with its own data only', async () => {
    await withHabits()
    habitsOutbox.enqueue(ME, { op: 'check', habit_id: H1, day: TODAY })
    api.insertCheck.mockClear()
    useHabits.getState().reset()
    api.fetchHabits.mockResolvedValue([])
    await useHabits.getState().bind(OTHER)
    expect(useHabits.getState().habits).toEqual([])
    expect(api.insertCheck).not.toHaveBeenCalled()
    expect(habitsOutbox.pending(ME)).toHaveLength(1)
  })
})

describe('startHabitsSync', () => {
  it('pulls on focus back and on reconnect, sends the queue every minute, and stops', async () => {
    await bound()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.setSystemTime(NOW)
    const refresh = vi.spyOn(useHabits.getState(), 'refresh').mockResolvedValue()
    const flushPending = vi.spyOn(useHabits.getState(), 'flushPending').mockResolvedValue()
    const stop = startHabitsSync()
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(60_000)
    expect(flushPending).toHaveBeenCalledTimes(1)
    stop()
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(flushPending).toHaveBeenCalledTimes(1)
    refresh.mockRestore(); flushPending.mockRestore()
  })
})
