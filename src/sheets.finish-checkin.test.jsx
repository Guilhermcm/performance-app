// @vitest-environment happy-dom
// Finishing a live workout opens the check-in with the routine and the detail filled in (spec 3.6).
// The summary of the workout comes once the panel closes; without an account there is no check-in.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginWorkout, finishWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { useCheckins } from './features/checkin/useCheckins.ts'
import { useCheckinFlow, closeCheckin } from './features/checkin/open-checkin.ts'

vi.mock('./features/gamification/events.ts', () => ({ emit: vi.fn(), flush: vi.fn(async () => ({ sent: 0, left: 0 })) }))
vi.mock('./features/gamification/progress-api.ts', () => ({ fetchProgress: vi.fn(async () => { throw new Error('offline') }) }))

const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))

function train() {
  const st = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 5, weight: 50, mode: 'reps' }] }],
    week: { 3: ['A'] }, active: null, workouts: [], weighIn: false
  })
  useStore.setState({ S: st, user: null })
  vi.setSystemTime(new Date('2026-10-07T06:30:00'))
  act(() => beginWorkout(['A'], null))
  vi.setSystemTime(new Date('2026-10-07T07:20:00'))
  act(() => useStore.getState().update(s => s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true }))))
  act(() => finishWorkout())
}
const summaryOpen = () => useUI.getState().sheets.some(s => s.render(() => {}).type?.name === 'FinishSummary')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  localStorage.clear()
  useUI.setState({ sheets: [] })
  useCheckinFlow.setState({ open: false, opts: {} })
})
afterEach(() => { vi.useRealTimers(); useCheckins.setState({ userId: null }) })

describe('finishing a live workout', () => {
  it('opens the check-in with the routine and the detail, then the summary once it closes', () => {
    useCheckins.setState({ userId: 'u1' })
    train()
    const saved = useStore.getState().S.workouts[0]
    const { open, opts } = useCheckinFlow.getState()
    expect(open).toBe(true)
    expect(opts).toMatchObject({
      routineId: 'A', fromWorkout: saved.id,
      detail: { entries: [{ id: BENCH, sets: [{ w: 50, r: 5, done: true }, { w: 50, r: 5, done: true }] }] }
    })
    expect(summaryOpen()).toBe(false)
    act(() => closeCheckin())
    expect(summaryOpen()).toBe(true)
    // The workout is in the history either way, as before.
    expect(useStore.getState().S.workouts).toHaveLength(1)
  })

  it('without an account goes straight to the summary', () => {
    train()
    expect(useCheckinFlow.getState().open).toBe(false)
    expect(summaryOpen()).toBe(true)
  })

  it('a workout logged into the past does not ask for a photo', () => {
    useCheckins.setState({ userId: 'u1' })
    const st = clone(DEF)
    Object.assign(st, {
      routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 50, mode: 'reps' }] }],
      active: null, workouts: [], weighIn: false
    })
    useStore.setState({ S: st, user: null })
    vi.setSystemTime(new Date('2026-10-07T12:00:00'))
    act(() => useStore.getState().update(s => {
      s.active = { id: 'p1', d: '2026-10-05', start: new Date('2026-10-05T18:00:00').getTime(), routineIds: ['A'], name: 'Push', bw: null, cur: 0,
        backfill: { durationMin: 60 }, entries: [{ id: BENCH, rid: 'A', target: st.routines[0].ex[0], sets: [{ w: 50, r: 5, done: true }] }] }
    }))
    act(() => finishWorkout())
    expect(useCheckinFlow.getState().open).toBe(false)
    expect(summaryOpen()).toBe(true)
  })
})
