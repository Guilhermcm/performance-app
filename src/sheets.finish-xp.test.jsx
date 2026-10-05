// @vitest-environment happy-dom
// Finishing a workout feeds gamification: the local start hour goes with the event (early_bird),
// and the summary gets the progress from before, a preview and the pending server answer.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginWorkout, finishWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { useProgress } from './features/gamification/useProgress.ts'
import { progressOf } from './features/gamification/test-progress.ts'
import { emit } from './features/gamification/events.ts'

vi.mock('./features/gamification/events.ts', () => ({ emit: vi.fn(), flush: vi.fn(async () => ({ sent: 0, left: 0 })) }))
vi.mock('./features/gamification/progress-api.ts', () => ({ fetchProgress: vi.fn(async () => { throw new Error('offline') }) }))

const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))

function train(day) {
  const st = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Plan A', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 50, mode: 'reps' }] }],
    week: { 1: ['A'] }, active: null, workouts: [], weighIn: false
  })
  useStore.setState({ S: st, user: null })
  vi.setSystemTime(new Date(day + 'T06:30:00'))
  act(() => beginWorkout(['A'], null))
  vi.setSystemTime(new Date(day + 'T07:10:00'))
  act(() => useStore.getState().update(s => s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true }))))
  act(() => finishWorkout())
}
const summaryProps = () => useUI.getState().sheets.at(-1).render(() => {}).props

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  localStorage.clear()
  useUI.setState({ sheets: [] })
  vi.mocked(emit).mockClear()
  useProgress.getState().reset()
})
afterEach(() => { vi.useRealTimers() })

describe('finishing a workout feeds gamification', () => {
  it('sends the local start hour of a live session', () => {
    train('2026-10-07')
    expect(vi.mocked(emit).mock.calls.find(c => c[0] === 'workout_completed')[1]).toMatchObject({ hour: 6, past: false })
  })

  it('hands the summary the progress from before and a preview', () => {
    const before = progressOf(400)
    useProgress.setState({ userId: 'u1', progress: before, status: 'ready' })
    train('2026-10-07')
    const { xp } = summaryProps()
    expect(xp.before).toBe(before)
    expect(xp.preview.lines[0]).toEqual({ kind: 'workout', amount: 200, index: 2, of: 3 })
    expect(xp.settled).toBeInstanceOf(Promise)
  })

  it('has no XP block without a signed-in progress store', () => {
    train('2026-10-07')
    expect(summaryProps().xp).toBeNull()
  })
})
