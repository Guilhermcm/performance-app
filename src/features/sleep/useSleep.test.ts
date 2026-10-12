// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
const api = vi.hoisted(() => ({
  fetchLogs: vi.fn(), fetchTargets: vi.fn(), fetchNights: vi.fn(), insertTarget: vi.fn(), upsertLog: vi.fn(), deleteLog: vi.fn()
}))
vi.mock('./sleep-api', async orig => ({ ...(await orig<typeof import('./sleep-api')>()), ...api }))
const progress = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => progress } }))

import { useSleep, startSleepSync, droppedNoticeText } from './useSleep'
import { sleepOutbox } from './outbox'
import { ME, OTHER, logOf, nightOf, targetOf } from './test-sleep'
import type { SleepHistory } from './types'

// 12:00 in Sao Paulo (the zone used without a profile) on 2026-10-05.
const NOW = new Date('2026-10-05T15:00:00Z')
const TODAY = '2026-10-05', YESTERDAY = '2026-10-04'
const CACHE = 'perf_sleep_v1', HISTORY = 'perf_sleep_history_v1'
const cache = () => JSON.parse(localStorage.getItem(CACHE) || 'null')
const settle = () => new Promise(r => setTimeout(r, 0))
const history = (over: Partial<SleepHistory> = {}): SleepHistory => ({ nights: [], weeks: [], periods: [{ started_on: '2026-09-01', ended_on: null }], ...over })
const refused = (m: string) => Object.assign(new Error(m), { code: 'P0001' })

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear(); sleepOutbox.clear()
  useSleep.getState().reset()
  Object.values(api).forEach(f => f.mockReset().mockResolvedValue(undefined))
  progress.refresh.mockReset()
  api.fetchLogs.mockResolvedValue([]); api.fetchTargets.mockResolvedValue([]); api.fetchNights.mockResolvedValue(history())
})

async function bound() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  await useSleep.getState().bind(ME)
}

describe('useSleep', () => {
  it('shows the saved copy at once and marks it stale', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
    const l = logOf({ night: TODAY })
    localStorage.setItem(CACHE, JSON.stringify({ userId: ME, logs: { [TODAY]: l }, targets: [targetOf()], closed: [nightOf()], periods: [], weeks: [] }))
    let release!: (v: unknown[]) => void
    api.fetchLogs.mockReturnValue(new Promise(r => { release = r }))
    const p = useSleep.getState().bind(ME)
    const s = useSleep.getState()
    expect(s.userId).toBe(ME)
    expect(s.status).toBe('ready'); expect(s.stale).toBe(true)
    expect(s.logs[TODAY]).toEqual(l)
    expect(s.targets).toEqual([targetOf()])
    release([]); await p
    expect(useSleep.getState().stale).toBe(false)
    expect(useSleep.getState().logs).toEqual({})
  })

  it('ignores a saved copy that belongs to someone else', () => {
    localStorage.setItem(CACHE, JSON.stringify({ userId: OTHER, logs: { [TODAY]: logOf() }, targets: [], closed: [], periods: [], weeks: [] }))
    api.fetchLogs.mockReturnValue(new Promise(() => {}))
    void useSleep.getState().bind(ME)
    expect(useSleep.getState().logs).toEqual({})
    expect(useSleep.getState().status).toBe('loading')
  })

  it('pulls today and yesterday, the targets and the closed nights of the last 62 days', async () => {
    const l = logOf({ night: YESTERDAY })
    const n = nightOf({ night: '2026-10-01' })
    api.fetchLogs.mockResolvedValue([l])
    api.fetchTargets.mockResolvedValue([targetOf({ valid_from: '2026-10-06' }), targetOf()])
    api.fetchNights.mockResolvedValue(history({ nights: [n], weeks: [{ start: '2026-09-28', target_hit: true }] }))
    await bound()
    expect(api.fetchLogs).toHaveBeenCalledWith(YESTERDAY, TODAY)
    expect(api.fetchNights).toHaveBeenCalledWith('2026-08-05', TODAY)
    const s = useSleep.getState()
    expect(s).toMatchObject({ status: 'ready', stale: false, logs: { [YESTERDAY]: l }, closed: [n], weeks: [{ start: '2026-09-28', target_hit: true }] })
    expect(s.periods).toEqual([{ started_on: '2026-09-01', ended_on: null }])
    expect(s.targets.map(t => t.valid_from)).toEqual(['2026-10-01', '2026-10-06'])
    expect(cache()).toMatchObject({ userId: ME, logs: { [YESTERDAY]: l }, closed: [n] })
    // Pulling the nights closes due ones on the server, which can pay XP.
    expect(progress.refresh).toHaveBeenCalledTimes(1)
    await useSleep.getState().refresh()
    expect(progress.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the saved copy and marks it stale when the pull fails', async () => {
    localStorage.setItem(CACHE, JSON.stringify({ userId: ME, logs: { [TODAY]: logOf({ night: TODAY }) }, targets: [], closed: [], periods: [], weeks: [] }))
    api.fetchNights.mockRejectedValue(new TypeError('Failed to fetch'))
    await bound()
    expect(useSleep.getState()).toMatchObject({ status: 'ready', stale: true })
    expect(useSleep.getState().logs[TODAY]).toBeTruthy()
  })

  it('is an error without a saved copy when the pull fails', async () => {
    api.fetchTargets.mockRejectedValue(new TypeError('Failed to fetch'))
    await bound()
    expect(useSleep.getState().status).toBe('error')
  })

  it('saves a night locally before the server answers', async () => {
    await bound()
    let release!: () => void
    api.upsertLog.mockReturnValue(new Promise<void>(r => { release = r }))
    const saved = useSleep.getState().saveNight({ night: TODAY, bed_time: '23:30', wake_time: '07:10', quality: 4, note: null })
    expect(saved).toEqual({ night: TODAY, bed_time: '23:30', wake_time: '07:10', duration_min: 460, quality: 4, note: null, updated_at: NOW.toISOString() })
    expect(useSleep.getState().logs[TODAY]).toEqual(saved)
    expect(cache().logs[TODAY]).toEqual(saved)
    expect(sleepOutbox.pending(ME)).toEqual([{ op: 'upsert', night: TODAY, row: saved }])
    await settle()
    expect(api.upsertLog).toHaveBeenCalledWith(saved)
    release(); await settle()
    expect(sleepOutbox.pending(ME)).toEqual([])
  })

  it('removes a night locally and queues the delete', async () => {
    api.fetchLogs.mockResolvedValue([logOf({ night: YESTERDAY })])
    await bound()
    useSleep.getState().removeNight(YESTERDAY)
    expect(useSleep.getState().logs).toEqual({})
    expect(cache().logs).toEqual({})
    await settle()
    expect(api.deleteLog).toHaveBeenCalledWith(YESTERDAY)
  })

  it('lays what is still queued over what the server sent', async () => {
    await bound()
    api.upsertLog.mockRejectedValue(new TypeError('Failed to fetch'))
    const saved = useSleep.getState().saveNight({ night: TODAY, bed_time: '23:00', wake_time: '07:00', quality: null, note: null })
    await settle()
    api.fetchLogs.mockResolvedValue([logOf({ night: TODAY, bed_time: '22:00' })])
    await useSleep.getState().refresh()
    expect(useSleep.getState().logs[TODAY]).toEqual(saved)
  })

  it('raises the dropped notice once for closed nights', async () => {
    await bound()
    // Back after three days: the night of the day before yesterday is still in the queue.
    sleepOutbox.enqueue(ME, { op: 'upsert', night: '2026-10-03', row: logOf({ night: '2026-10-03' }) })
    sleepOutbox.enqueue(ME, { op: 'upsert', night: TODAY, row: logOf({ night: TODAY }) })
    api.upsertLog.mockImplementation(async (l: { night: string }) => { if (l.night === '2026-10-03') throw refused('night_closed') })
    await useSleep.getState().refresh()
    expect(useSleep.getState().droppedNotice).toBe(true)
    expect(api.upsertLog).toHaveBeenCalledTimes(2)
    expect(sleepOutbox.pending(ME)).toEqual([])
    useSleep.getState().dismissDropped()
    await useSleep.getState().refresh()
    await useSleep.getState().flushPending()
    expect(useSleep.getState().droppedNotice).toBe(false)
    expect(droppedNoticeText()).toBe('Some nights from days that already closed were not saved.')
  })

  it('picks the last logged night of the last 14', async () => {
    const closed = [
      nightOf({ night: '2026-09-20', bed_time: '22:00', wake_time: '06:00' }),
      nightOf({ night: '2026-09-21', bed_time: '22:30', wake_time: '06:30', duration_min: 480, quality: 3 }),
      nightOf({ night: '2026-09-25', logged: false, bed_time: null, wake_time: null, duration_min: null })
    ]
    api.fetchNights.mockResolvedValue(history({ nights: closed }))
    await bound()
    const s = useSleep.getState()
    expect(s.lastLogged(TODAY)).toMatchObject({ night: '2026-09-21', bed_time: '22:30', wake_time: '06:30', duration_min: 480, quality: 3 })
    expect(s.lastLogged('2026-10-06')).toBeNull()
    const today = s.saveNight({ night: TODAY, bed_time: '23:10', wake_time: '07:00', quality: null, note: null })
    expect(useSleep.getState().lastLogged(TODAY)).toEqual(today)
    // a night after the asked day does not count
    expect(useSleep.getState().lastLogged(YESTERDAY)).toMatchObject({ night: '2026-09-21' })
  })

  it('reads the target in force on a night', async () => {
    api.fetchTargets.mockResolvedValue([targetOf({ valid_from: '2026-10-01', goal_min: 480 }), targetOf({ valid_from: '2026-10-06', goal_min: 450 })])
    await bound()
    const s = useSleep.getState()
    expect(s.targetOn('2026-09-30')).toBeNull()
    expect(s.targetOn('2026-10-01')?.goal_min).toBe(480)
    expect(s.targetOn(TODAY)?.goal_min).toBe(480)
    expect(s.targetOn('2026-10-06')?.goal_min).toBe(450)
  })

  it('writes a target and keeps them in order', async () => {
    api.fetchTargets.mockResolvedValue([targetOf()])
    await bound()
    await useSleep.getState().setTarget({ goal_min: 450, bed_target: '22:30' }, '2026-10-06')
    expect(api.insertTarget).toHaveBeenCalledWith({ valid_from: '2026-10-06', goal_min: 450, bed_target: '22:30' })
    expect(useSleep.getState().targets.map(t => t.valid_from)).toEqual(['2026-10-01', '2026-10-06'])
    expect(cache().targets).toHaveLength(2)
    api.insertTarget.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(useSleep.getState().setTarget({ goal_min: 420, bed_target: '22:30' }, '2026-10-06')).rejects.toBeTruthy()
    expect(useSleep.getState().targetOn('2026-10-06')?.goal_min).toBe(450)
  })

  it('reads a month once it has settled and keeps it per account', async () => {
    await bound()
    // Every row of August (up to Sunday 6 September) had closed by today: read once, then kept.
    const aug = history({ nights: [nightOf({ night: '2026-08-10' })] })
    api.fetchNights.mockResolvedValue(aug)
    await expect(useSleep.getState().loadMonth('2026-08')).resolves.toEqual(aug)
    expect(api.fetchNights).toHaveBeenLastCalledWith('2026-08-01', '2026-08-31')
    expect(JSON.parse(localStorage.getItem(HISTORY)!)).toMatchObject({ userId: ME, months: { '2026-08': { fetchedOn: TODAY, data: aug } } })
    api.fetchNights.mockClear()
    await expect(useSleep.getState().loadMonth('2026-08')).resolves.toEqual(aug)
    expect(api.fetchNights).not.toHaveBeenCalled()

    // The current month (and September, whose last row ends on 4 October) is asked again, up to
    // today, and the saved copy answers when offline.
    const oct = history({ nights: [nightOf({ night: '2026-10-02' })] })
    api.fetchNights.mockResolvedValue(oct)
    await expect(useSleep.getState().loadMonth('2026-10')).resolves.toEqual(oct)
    expect(api.fetchNights).toHaveBeenLastCalledWith('2026-10-01', TODAY)
    await useSleep.getState().loadMonth('2026-09')
    await useSleep.getState().loadMonth('2026-09')
    expect(api.fetchNights).toHaveBeenCalledTimes(3)
    api.fetchNights.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(useSleep.getState().loadMonth('2026-10')).resolves.toEqual(oct)
    await expect(useSleep.getState().loadMonth('2026-07')).resolves.toBeNull()
    // Another account never reads this copy.
    useSleep.getState().reset()
    await useSleep.getState().bind(OTHER)
    await expect(useSleep.getState().loadMonth('2026-08')).resolves.toBeNull()
    // A month still to come asks nothing.
    api.fetchNights.mockClear()
    await expect(useSleep.getState().loadMonth('2026-11')).resolves.toBeNull()
    expect(api.fetchNights).not.toHaveBeenCalled()
  })

  it('drops everything on reset', async () => {
    api.fetchLogs.mockResolvedValue([logOf({ night: TODAY })])
    api.fetchTargets.mockResolvedValue([targetOf()])
    api.fetchNights.mockResolvedValue(history({ nights: [nightOf()] }))
    await bound()
    useSleep.setState({ droppedNotice: true })
    let release!: (v: unknown) => void
    api.fetchNights.mockReturnValue(new Promise(r => { release = r }))
    const late = useSleep.getState().refresh()
    useSleep.getState().reset()
    expect(useSleep.getState()).toMatchObject({ userId: null, status: 'idle', stale: false, logs: {}, targets: [], closed: [], periods: [], weeks: [], droppedNotice: false })
    expect(localStorage.getItem(CACHE)).toBeNull()
    // An answer for the previous account lands nowhere.
    release(history({ nights: [nightOf({ night: '2026-10-02' })] })); await late
    expect(useSleep.getState().closed).toEqual([])
    expect(localStorage.getItem(CACHE)).toBeNull()
  })

  it('binds another account with its own data only', async () => {
    api.fetchLogs.mockResolvedValue([logOf({ night: TODAY })])
    await bound()
    sleepOutbox.enqueue(ME, { op: 'upsert', night: YESTERDAY, row: logOf({ night: YESTERDAY }) })
    api.upsertLog.mockClear()
    api.fetchLogs.mockResolvedValue([])
    useSleep.getState().reset()
    await useSleep.getState().bind(OTHER)
    expect(useSleep.getState().logs).toEqual({})
    expect(api.upsertLog).not.toHaveBeenCalled()
    expect(sleepOutbox.pending(ME)).toHaveLength(1)
  })
})

describe('startSleepSync', () => {
  it('pulls on focus back and on reconnect, sends the queue every minute, and stops', async () => {
    await bound()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(NOW)
    const refresh = vi.spyOn(useSleep.getState(), 'refresh').mockResolvedValue()
    const flushPending = vi.spyOn(useSleep.getState(), 'flushPending').mockResolvedValue()
    const stop = startSleepSync()
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
