// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))

import CelebrationHost from './CelebrationHost'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'
import type { NutritionProgress, Progress } from './types'

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
})
