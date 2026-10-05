// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

const motion = vi.hoisted(() => ({ reduced: true }))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => motion.reduced }))

import WorkoutXpSummary from './WorkoutXpSummary'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'
import type { SyncResult, XpPreview } from './types'

const before = progressOf(400)
const preview: XpPreview = { lines: [{ kind: 'workout', amount: 200, index: 2, of: 3 }], total: 200 }
const never = () => new Promise<SyncResult>(() => {})
const show = async (props: { preview: XpPreview | null; settled: Promise<SyncResult>; before?: typeof before | null }) => {
  await act(async () => { render(<WorkoutXpSummary before={props.before === undefined ? before : props.before} preview={props.preview} settled={props.settled} />) })
}

beforeEach(() => { motion.reduced = true; localStorage.clear(); useProgress.getState().reset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('WorkoutXpSummary', () => {
  it('shows the preview at once and holds the celebrations', async () => {
    await show({ preview, settled: never() })
    expect(screen.getAllByText('+200 XP').length).toBeGreaterThan(0)
    expect(screen.getByText('Workout 2 of 3')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Level 4' })).toBeTruthy()
    expect(useProgress.getState().held).toBe(true)
  })

  it('switches to the server figures and lets the celebrations through', async () => {
    const after = progressOf(680, { workouts: 2, prs: 1 }, { achievements: [{ code: 'first_pr', unlocked_at: '2026-10-07T20:00:00Z' }] })
    await show({ preview, settled: Promise.resolve({ progress: after, confirmed: true }) })
    expect(screen.getAllByText('+280 XP').length).toBeGreaterThan(0)
    expect(screen.getByText('Personal records ×1')).toBeTruthy()
    expect(screen.getByText('Achievement: First PR')).toBeTruthy()
    expect(useProgress.getState().held).toBe(false)
  })

  it('marks the preview as an estimate when offline', async () => {
    await show({ preview, settled: Promise.resolve({ progress: null, confirmed: false }) })
    expect(screen.getAllByText('+200 XP').length).toBeGreaterThan(0)
    expect(screen.getByText('Estimate. It is confirmed when you are back online.')).toBeTruthy()
  })

  it('explains a session logged into a past week', async () => {
    await show({ preview: null, settled: Promise.resolve({ progress: null, confirmed: false }) })
    expect(screen.getByText('This workout counts toward a past week. Its XP shows up once it syncs.')).toBeTruthy()
  })

  it('waits for the server when there is nothing to preview', async () => {
    await show({ preview: null, settled: never() })
    expect(screen.getByText('Counting your XP…')).toBeTruthy()
  })

  it('says why a session paid nothing', async () => {
    await show({ preview: { lines: [], total: 0 }, settled: never() })
    expect(screen.getByText('No XP this time. You already got the two extra workouts this week.')).toBeTruthy()
  })

  it('holds the level-up card until the count and the bar are done', async () => {
    motion.reduced = false
    vi.useFakeTimers()
    const after = progressOf(630, { workouts: 2 })
    await show({ preview, settled: Promise.resolve({ progress: after, confirmed: true }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    // The number has landed (700 ms), but the bar is still refilling past the level-up.
    expect(screen.getAllByText('+230 XP').length).toBeGreaterThan(0)
    expect(useProgress.getState().held).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(useProgress.getState().held).toBe(false)
  })

  it('stops holding when it closes', async () => {
    await show({ preview, settled: never() })
    cleanup()
    expect(useProgress.getState().held).toBe(false)
  })
})
