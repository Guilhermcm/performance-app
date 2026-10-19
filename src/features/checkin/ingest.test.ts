// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../gamification/events', () => ({ emit: vi.fn(), flush: vi.fn(async () => ({ sent: 0, left: 0 })) }))

import { DEF, useStore } from '../../store/useStore.js'
import { emit } from '../gamification/events'
import { checkinWorkout, detailOf, detailOfWorkout, draftFor, dropCheckinWorkout, ingestCheckin, linkWorkout, workoutOfCheckin } from './ingest'
import type { CheckinDetail, StrengthDetail } from './types'

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
  vi.mocked(emit).mockClear()
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
    const given: StrengthDetail = { entries: [{ id: BENCH, sets: [done(50, 5)] as { w: number; r: number; done: true }[] }] }
    expect(draftFor(stateWith(), 'r1', given)).toEqual([
      { id: BENCH, on: true, sets: [{ w: 50, r: 5 }] },
      { id: ROW, on: false, sets: [{ w: 0, r: 10 }, { w: 0, r: 10 }] }
    ])
  })

  it('reopens a detail given in the other unit in the profile’s unit', () => {
    const given: StrengthDetail = { unit: 'kg', entries: [{ id: BENCH, sets: [done(60, 8)] as { w: number; r: number; done: true }[] }] }
    // 60 kg = 132.5 lb, on the 5 lb grid of a bench: 135
    expect(draftFor(stateWith({ unit: 'lb' }), 'r1', given)[0]).toEqual({ id: BENCH, on: true, sets: [{ w: 135, r: 8 }] })
    expect(draftFor(stateWith({ unit: 'kg' }), 'r1', given)[0]).toEqual({ id: BENCH, on: true, sets: [{ w: 60, r: 8 }] })
  })

  it('is empty without a routine', () => {
    expect(draftFor(stateWith(), null)).toEqual([])
    expect(draftFor(stateWith(), 'gone')).toEqual([])
  })

  it('opens as with no detail for a run detail, which has no sets', () => {
    const run: CheckinDetail = { run: { status: 'unplanned', distance_km: 6.2 } }
    const S = stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8)])] })
    expect(draftFor(S, 'r1', run)).toEqual(draftFor(S, 'r1'))
  })
})

describe('detailOf', () => {
  it('keeps the exercises on, and the sets with reps, in the unit of the profile', () => {
    expect(detailOf([
      { id: BENCH, on: true, sets: [{ w: 40, r: 8 }, { w: 40, r: 0 }] },
      { id: ROW, on: false, sets: [{ w: 30, r: 10 }] }
    ])).toEqual({ entries: [{ id: BENCH, sets: [{ w: 40, r: 8, done: true }] }], unit: 'kg' })
    expect(detailOf([{ id: ROW, on: true, sets: [{ w: 30, r: 0 }] }])).toBeNull()
  })

  it('writes unit: S.unit', () => {
    useStore.setState({ S: stateWith({ unit: 'lb' }) })
    expect(detailOf([{ id: BENCH, on: true, sets: [{ w: 135, r: 8 }] }])?.unit).toBe('lb')
    expect(detailOf([{ id: BENCH, on: true, sets: [{ w: 60, r: 8 }] }], 'kg')?.unit).toBe('kg')
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
    expect(detailOfWorkout(w)).toEqual({ entries: [{ id: BENCH, sets: [{ w: 40, r: 8, done: true }] }], unit: 'kg' })
    expect(detailOfWorkout({ id: 'x', entries: [] })).toBeNull()
  })

  it('writes unit: S.unit', () => {
    useStore.setState({ S: stateWith({ unit: 'lb' }) })
    const w = { id: 'live', entries: [{ id: BENCH, target: PUSH.ex[0], sets: [done(135, 8)] }] }
    expect(detailOfWorkout(w)?.unit).toBe('lb')
  })
})

describe('the session a detailed check-in writes', () => {
  const detail: StrengthDetail = { entries: [{ id: BENCH, sets: [done(45, 8), done(45, 6)] as { w: number; r: number; done: true }[] }] }

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

  it('writes no sets for a run detail that reaches it', () => {
    const run = { run: { status: 'unplanned', rpe: 5 } } as unknown as StrengthDetail
    const w = checkinWorkout(stateWith(), { id: 'c3', day: '2026-10-10', routineId: null, name: 'Corrida', durationMin: 30, detail: run })
    expect(w.entries).toEqual([])
    expect(w.prs).toEqual([])
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

describe('when the check-in goes', () => {
  const detail: StrengthDetail = { entries: [{ id: BENCH, sets: [done(45, 8)] as { w: number; r: number; done: true }[] }] }

  it('its own session leaves the history, and the kept weight it set goes back', () => {
    useStore.setState({ S: stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8)])], exWeights: { [BENCH]: { w: 42.5, d: '2026-10-03' } } }) })
    ingestCheckin({ id: 'c1', day: '2026-10-10', routineId: 'r1', name: 'Push', durationMin: 50, detail })
    expect(useStore.getState().S.exWeights[BENCH]).toEqual({ w: 45, d: '2026-10-10' })
    dropCheckinWorkout('c1')
    const S = useStore.getState().S
    expect(S.workouts.map((w: { id: string }) => w.id)).toEqual(['w1'])
    expect(S.exWeights[BENCH]).toEqual({ w: 42.5, d: '2026-10-03' })
  })

  it('a live workout linked to it stays, without the link', () => {
    useStore.setState({ S: stateWith({ workouts: [past('live', '2026-10-10', [done(40, 8)])] }) })
    linkWorkout('live', 'c7')
    dropCheckinWorkout('c7')
    const S = useStore.getState().S
    expect(S.workouts.map((w: { id: string }) => w.id)).toEqual(['live'])
    expect(S.workouts[0].checkinId).toBeUndefined()
    expect(S.workouts[0]._ts).toBeGreaterThan(0)
  })

  it('does nothing for a check-in with no session', () => {
    useStore.setState({ S: stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8)])] }) })
    const before = useStore.getState().S
    dropCheckinWorkout('c9')
    expect(useStore.getState().S).toBe(before)
  })
})

describe('PRs of a detailed check-in', () => {
  it('send the same pr events as the end of a live workout, keyed by the check-in', () => {
    useStore.setState({ S: stateWith({ workouts: [past('w1', '2026-10-03', [done(42.5, 8)])] }) })
    const detail: StrengthDetail = { entries: [
      { id: BENCH, sets: [done(45, 8)] as { w: number; r: number; done: true }[] },
      { id: ROW, sets: [done(30, 10)] as { w: number; r: number; done: true }[] }
    ] }
    ingestCheckin({ id: 'c1', day: '2026-10-09', routineId: 'r1', name: 'Push', durationMin: 50, detail })
    expect(vi.mocked(emit).mock.calls).toEqual([
      ['pr', { ex: BENCH }, `c1:${BENCH}`, '2026-10-09'],
      ['pr', { ex: ROW }, `c1:${ROW}`, '2026-10-09']
    ])
  })

  it('send none without a new best', () => {
    useStore.setState({ S: stateWith({ workouts: [past('w1', '2026-10-03', [done(60, 5)])] }) })
    ingestCheckin({ id: 'c1', day: '2026-10-10', routineId: 'r1', name: 'Push', durationMin: 50,
      detail: { entries: [{ id: BENCH, sets: [done(45, 8)] as { w: number; r: number; done: true }[] }] } })
    expect(emit).not.toHaveBeenCalled()
  })
})

// Spec §6 "Unidade do detalhe": the detail keeps the unit it was written in, and its weights are
// converted to S.unit when it goes into the history, rounded to the exercise's load step.
describe('the unit of a detail', () => {
  const sets = (...ws: number[]) => ws.map(w => done(w, 8)) as { w: number; r: number; done: true }[]
  const SQUAT = '0043'
  const input = (detail: StrengthDetail) => ({ id: 'c1', day: '2026-10-10', routineId: 'r1', name: 'Push', durationMin: 50, detail })
  const weights = (S: ReturnType<typeof stateWith>, detail: StrengthDetail) =>
    checkinWorkout(S, input(detail)).entries.map(e => e.sets.map(s => s.w))

  it('kg into an lb profile: convertWeight, then snapped to the lb step of each exercise', () => {
    const S = stateWith({ unit: 'lb' })
    // bench 62.5 kg = 138 lb, 5 lb step: 140. A squat steps by 10 lb: 100 kg = 220.5 lb, 220.
    const detail: StrengthDetail = { unit: 'kg', entries: [{ id: BENCH, sets: sets(62.5, 61) }, { id: SQUAT, sets: sets(100) }] }
    expect(weights(S, detail)).toEqual([[140, 135], [220]])
  })

  it('lb into a kg profile, with the step of the routine’s own config when it sets one', () => {
    const S = stateWith({ unit: 'kg', routines: [{ ...clone(PUSH), ex: [{ ...PUSH.ex[0], inc: 1 }, PUSH.ex[1]] }] })
    // 135 lb = 61.25 kg; bench steps by 1 here: 61. The row by its default 5: 100 lb = 45.25 kg, 45.
    const detail: StrengthDetail = { unit: 'lb', entries: [{ id: BENCH, sets: sets(135) }, { id: ROW, sets: sets(100) }] }
    expect(weights(S, detail)).toEqual([[61], [45]])
  })

  it('a detail without a unit, or in the profile’s unit, is taken as it is', () => {
    expect(weights(stateWith({ unit: 'lb' }), { entries: [{ id: BENCH, sets: sets(62.5) }] })).toEqual([[62.5]])
    expect(weights(stateWith({ unit: 'lb' }), { unit: 'lb', entries: [{ id: BENCH, sets: sets(137) }] })).toEqual([[137]])
    expect(weights(stateWith({ unit: 'kg' }), { unit: 'kg', entries: [{ id: BENCH, sets: sets(61) }] })).toEqual([[61]])
  })

  it('ingesting the same detail twice gives the same history', () => {
    useStore.setState({ S: stateWith({ unit: 'lb' }) })
    const detail: StrengthDetail = { unit: 'kg', entries: [{ id: BENCH, sets: sets(62.5, 60) }] }
    const frozen = clone(detail)
    ingestCheckin(input(detail))
    const once = clone(useStore.getState().S.workouts)
    const kept = clone(useStore.getState().S.exWeights)
    ingestCheckin(input(detail))
    const S = useStore.getState().S
    expect(S.workouts.map((w: { entries: { sets: unknown }[] }) => w.entries.map(e => e.sets))).toEqual(once.map((w: { entries: { sets: unknown }[] }) => w.entries.map(e => e.sets)))
    expect(S.workouts[0].entries[0].sets.map((s: { w: number }) => s.w)).toEqual([140, 135])
    expect(S.exWeights).toEqual(kept)
    expect(S.exWeights[BENCH].w).toBe(140)
    expect(detail).toEqual(frozen)
  })
})
