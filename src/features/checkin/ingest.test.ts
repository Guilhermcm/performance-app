// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEF, useStore } from '../../store/useStore.js'
import { checkinWorkout, detailOf, detailOfWorkout, draftFor, ingestCheckin, linkWorkout, workoutOfCheckin } from './ingest'
import type { CheckinDetail } from './types'

const BENCH = '0025', ROW = '0027', RUN = 'treadmill'
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const PUSH = {
  id: 'r1', name: 'Push', emoji: 'dumbbell',
  ex: [
    { id: BENCH, sets: 3, reps: 8, weight: 40, mode: 'reps' },
    { id: ROW, sets: 2, reps: 10, mode: 'reps' },
    { id: RUN, sets: 1, mode: 'cardio' }
  ]
}
const done = (w: number, r: number) => ({ w, r, done: true })
const past = (id: string, d: string, sets: { w: number; r: number; done: boolean }[]) =>
  ({ id, d, start: 1, end: 2, routineIds: ['r1'], routineId: 'r1', name: 'Push', entries: [{ id: BENCH, rid: 'r1', target: PUSH.ex[0], sets }], prs: [] })
const stateWith = (over: Record<string, unknown> = {}) => ({ ...clone(DEF), routines: [clone(PUSH)], workouts: [], exWeights: {}, ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T18:00:00'))
  useStore.setState({ S: stateWith(), user: null })
})
afterEach(() => { vi.useRealTimers() })

describe('draftFor', () => {
  it('opens the routine exercises logged with weight and reps, with last time’s load and reps', () => {
    const S = stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8), done(42.5, 7), { w: 20, r: 12, done: false }])] })
    expect(draftFor(S, 'r1')).toEqual([
      { id: BENCH, on: true, sets: [{ w: 42.5, r: 8 }, { w: 42.5, r: 7 }] },
      // Never trained: the routine's own sets and reps, and its weight when it has one.
      { id: ROW, on: true, sets: [{ w: 0, r: 10 }, { w: 0, r: 10 }] }
    ])
  })

  it('reopens a detail already given, with the skipped exercises off', () => {
    const given: CheckinDetail = { entries: [{ id: BENCH, sets: [done(50, 5)] as { w: number; r: number; done: true }[] }] }
    expect(draftFor(stateWith(), 'r1', given)).toEqual([
      { id: BENCH, on: true, sets: [{ w: 50, r: 5 }] },
      { id: ROW, on: false, sets: [{ w: 0, r: 10 }, { w: 0, r: 10 }] }
    ])
  })

  it('is empty without a routine', () => {
    expect(draftFor(stateWith(), null)).toEqual([])
    expect(draftFor(stateWith(), 'gone')).toEqual([])
  })
})

describe('detailOf', () => {
  it('keeps the exercises on, and the sets with reps', () => {
    expect(detailOf([
      { id: BENCH, on: true, sets: [{ w: 40, r: 8 }, { w: 40, r: 0 }] },
      { id: ROW, on: false, sets: [{ w: 30, r: 10 }] }
    ])).toEqual({ entries: [{ id: BENCH, sets: [{ w: 40, r: 8, done: true }] }] })
    expect(detailOf([{ id: ROW, on: true, sets: [{ w: 30, r: 0 }] }])).toBeNull()
  })
})

describe('detailOfWorkout', () => {
  it('takes the done work sets of a finished live workout', () => {
    const w = {
      id: 'live', entries: [
        { id: BENCH, target: PUSH.ex[0], sets: [{ w: 20, r: 10, done: true, phase: 'warmup' }, done(40, 8), { w: 40, r: 8, done: false }] },
        { id: RUN, target: PUSH.ex[2], sets: [{ min: 20, speed: 10, done: true }] }
      ]
    }
    expect(detailOfWorkout(w)).toEqual({ entries: [{ id: BENCH, sets: [{ w: 40, r: 8, done: true }] }] })
    expect(detailOfWorkout({ id: 'x', entries: [] })).toBeNull()
  })
})

describe('the session a detailed check-in writes', () => {
  const detail: CheckinDetail = { entries: [{ id: BENCH, sets: [done(45, 8), done(45, 6)] as { w: number; r: number; done: true }[] }] }

  it('has the shape of a finished workout, with the check-in id', () => {
    const w = checkinWorkout(stateWith(), { id: 'c1', day: '2026-10-10', routineId: 'r1', name: 'Push', durationMin: 55, detail })
    expect(w).toMatchObject({
      id: 'c1', d: '2026-10-10', routineIds: ['r1'], routineId: 'r1', name: 'Push', bw: null, vol: 45 * 8 + 45 * 6,
      entries: [{ id: BENCH, rid: 'r1', topW: 45, sets: [{ w: 45, r: 8, done: true }, { w: 45, r: 6, done: true }] }]
    })
    expect(w.entries[0].target).toMatchObject({ id: BENCH, mode: 'reps' })
    expect(w.end - w.start).toBe(55 * 60000)
    expect(w.end).toBe(new Date('2026-10-10T18:00:00').getTime())
  })

  it('lands on yesterday, at the same time of day, without a made-up duration', () => {
    const w = checkinWorkout(stateWith(), { id: 'c2', day: '2026-10-09', routineId: 'r1', name: 'Push', durationMin: null, detail })
    expect(w.d).toBe('2026-10-09')
    expect(w.end).toBe(new Date('2026-10-09T18:00:00').getTime())
    expect(w.start).toBe(w.end)
  })

  it('marks a load PR against the history', () => {
    const S = stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8)])] })
    expect(checkinWorkout(S, { id: 'c1', day: '2026-10-10', routineId: 'r1', name: 'Push', durationMin: 50, detail }).prs).toEqual([BENCH])
    const heavier = stateWith({ workouts: [past('w1', '2026-10-03', [done(60, 5)])] })
    expect(checkinWorkout(heavier, { id: 'c1', day: '2026-10-10', routineId: 'r1', name: 'Push', durationMin: 50, detail }).prs).toEqual([])
  })

  it('goes into S.workouts in date order, once per check-in, and feeds the next detail', () => {
    useStore.setState({ S: stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8)]), past('w9', '2026-10-10', [done(30, 8)])] }) })
    ingestCheckin({ id: 'c1', day: '2026-10-09', routineId: 'r1', name: 'Push', durationMin: 50, detail })
    expect(useStore.getState().S.workouts.map((w: { id: string }) => w.id)).toEqual(['w1', 'c1', 'w9'])
    expect(useStore.getState().S.exWeights[BENCH]).toEqual({ w: 45, d: '2026-10-09' })
    // The same check-in again (an edit of its detail) replaces its session.
    ingestCheckin({ id: 'c1', day: '2026-10-09', routineId: 'r1', name: 'Push', durationMin: 50, detail: { entries: [{ id: BENCH, sets: [done(47.5, 5)] as { w: number; r: number; done: true }[] }] } })
    const S = useStore.getState().S
    expect(S.workouts.filter((w: { id: string }) => w.id === 'c1')).toHaveLength(1)
    expect(workoutOfCheckin(S, 'c1')!.entries[0].sets).toEqual([{ w: 47.5, r: 5, done: true }])
  })

  it('links a finished live workout to its check-in instead of writing a second session', () => {
    useStore.setState({ S: stateWith({ workouts: [past('live', '2026-10-10', [done(40, 8)])] }) })
    linkWorkout('live', 'c7')
    const S = useStore.getState().S
    expect(S.workouts).toHaveLength(1)
    expect(workoutOfCheckin(S, 'c7')!.id).toBe('live')
    expect(workoutOfCheckin(S, 'nope')).toBeNull()
  })
})
