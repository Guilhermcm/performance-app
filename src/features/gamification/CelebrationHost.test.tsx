// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn(), fetchProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./progress-api', () => ({ fetchProgress: h.fetchProgress }))

import CelebrationHost from './CelebrationHost'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'
import type { HabitsProgress, NutritionProgress, Progress, SleepProgress } from './types'

const SEEN = 'perf_nutrition_seen_v1'
// 2026-10-03 is a Saturday, 2026-10-04 a Sunday.
const closedOn = (day: string, over: Partial<NonNullable<NutritionProgress['last_closed']>> = {}): Progress => progressOf(700, {}, {
  nutrition: {
    target: 5, on_target: 2, logged: 3, streak: { current: 0, best: 0, shields: 0 }, confirms_on: '2026-10-09', last_week: null,
    last_closed: { day, logged: true, on_target: true, balanced: false, xp: 120, ...over }
  }
})
const ready = (p: Progress, userId = 'u1') => useProgress.setState({ status: 'ready', stale: false, progress: p, userId })

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  h.toast.mockReset()
  h.fetchProgress.mockReset()
})
afterEach(cleanup)

describe('CelebrationHost', () => {
  it('shows pending celebrations and clears them', () => {
    useProgress.setState({ pending: [{ kind: 'level', level: 3 }] })
    render(<CelebrationHost />)
    expect(screen.getByText('Level 3')).toBeTruthy()
    expect(useProgress.getState().pending).toEqual([])
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits while held', () => {
    useProgress.setState({ pending: [{ kind: 'level', level: 3 }], held: true })
    render(<CelebrationHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => useProgress.getState().hold(false))
    expect(screen.getByText('Level 3')).toBeTruthy()
  })

  it('only records the closed day on the first load on a device', () => {
    ready(closedOn('2026-10-03'))
    render(<CelebrationHost />)
    expect(h.toast).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(SEEN)!)).toEqual({ userId: 'u1', day: '2026-10-03' })
  })

  it('says how a newly closed day went, once', () => {
    localStorage.setItem(SEEN, JSON.stringify({ userId: 'u1', day: '2026-10-02' }))
    ready(closedOn('2026-10-03'))
    render(<CelebrationHost />)
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith('Saturday on target, +120 XP')
    act(() => ready(closedOn('2026-10-03')))
    expect(h.toast).toHaveBeenCalledTimes(1)
    act(() => ready(closedOn('2026-10-04', { on_target: false, xp: 10 })))
    expect(h.toast).toHaveBeenLastCalledWith('Sunday logged, +10 XP')
    expect(h.toast).toHaveBeenCalledTimes(2)
  })

  it('waits for the server answer and keeps each account apart', () => {
    localStorage.setItem(SEEN, JSON.stringify({ userId: 'u2', day: '2026-10-02' }))
    useProgress.setState({ status: 'ready', stale: true, progress: closedOn('2026-10-03'), userId: 'u1' })
    render(<CelebrationHost />)
    expect(h.toast).not.toHaveBeenCalled()
    // Another account's record is a first load for this one: recorded, no toast.
    act(() => ready(closedOn('2026-10-03')))
    expect(h.toast).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(SEEN)!)).toEqual({ userId: 'u1', day: '2026-10-03' })
  })

  it('confirms a newly closed training day once, apart from nutrition', () => {
    const TRAINING = 'perf_training_seen_v1'
    const trained = (day: string, xp = 210) => progressOf(700, {}, { training: { confirms_on: '2026-10-09', last_closed: { day, detailed: true, xp } } })
    // First load on this device: recorded, no toast.
    ready(trained('2026-10-02'))
    render(<CelebrationHost />)
    expect(h.toast).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(TRAINING)!)).toEqual({ userId: 'u1', day: '2026-10-02' })
    act(() => ready(trained('2026-10-03')))
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith('Saturday workout confirmed, +210 XP')
    act(() => ready(trained('2026-10-03')))
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(SEEN)).toBe(JSON.stringify({ userId: 'u1', day: null }))
  })

  it('tells how a newly closed night went once, apart from the other pillars', () => {
    const SLEEP = 'perf_sleep_seen_v1'
    const slept = (night: string, over: Partial<NonNullable<SleepProgress['last_closed']>> = {}) => progressOf(700, {}, {
      sleep: {
        target: 5, on_target: 1, logged: 2, streak: { current: 0, best: 0, shields: 0 }, confirms_on: '2026-10-09', last_week: null,
        last_closed: { night, logged: true, on_target: true, rested: false, xp: 130, ...over }
      }
    })
    // First load on this device: recorded, no toast.
    ready(slept('2026-10-02'))
    render(<CelebrationHost />)
    expect(h.toast).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(SLEEP)!)).toEqual({ userId: 'u1', day: '2026-10-02' })
    act(() => ready(slept('2026-10-03')))
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith('Saturday on target, +130 XP')
    act(() => ready(slept('2026-10-03')))
    expect(h.toast).toHaveBeenCalledTimes(1)
    act(() => ready(slept('2026-10-04', { on_target: false, xp: 10 })))
    expect(h.toast).toHaveBeenLastCalledWith('Sunday logged, +10 XP')
    expect(h.toast).toHaveBeenCalledTimes(2)
    // A night without a log is recorded quietly.
    act(() => ready(slept('2026-10-05', { logged: false, on_target: false, xp: 0 })))
    expect(h.toast).toHaveBeenCalledTimes(2)
    expect(JSON.parse(localStorage.getItem(SLEEP)!)).toEqual({ userId: 'u1', day: '2026-10-05' })
  })

  it('takes a cached progress without the sleep block in its stride', () => {
    localStorage.setItem('perf_sleep_seen_v1', JSON.stringify({ userId: 'u1', day: '2026-10-02' }))
    ready({ ...progressOf(700), sleep: undefined })
    render(<CelebrationHost />)
    expect(h.toast).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('perf_sleep_seen_v1')!)).toEqual({ userId: 'u1', day: '2026-10-02' })
  })

  it('shows the habit week celebration once, with the XP it paid, and no toast', async () => {
    const week = (start: string, bonus = 64): Progress => progressOf(700, {}, {
      habits: { week: { q: 9, c: 0, xp: 0 }, streak: { current: 1, best: 1, shields: 0 }, last_week: { start, target_hit: true, bonus } } satisfies HabitsProgress
    })
    // The first answer on this device records the week already closed.
    h.fetchProgress.mockResolvedValue(week('2026-09-21'))
    await act(() => useProgress.getState().load('u1'))
    render(<CelebrationHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
    // The next week closes with its goal met.
    h.fetchProgress.mockResolvedValue(week('2026-09-28'))
    await act(() => useProgress.getState().refresh())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Habit week done, +64 XP')).toBeTruthy()
    fireEvent.click(screen.getByText('Tap to continue'))
    expect(screen.queryByRole('dialog')).toBeNull()
    // The same week again tells nothing.
    await act(() => useProgress.getState().refresh())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useProgress.getState().pending).toEqual([])
    expect(h.toast).not.toHaveBeenCalled()
  })
})
