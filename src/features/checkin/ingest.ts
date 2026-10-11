// The training detail of a check-in, in and out of the app's history (plan decision 7). The check-in
// keeps `detail` ({ entries: [{ id, sets: [{ w, r, done }] }] }); the history gets a session in the
// shape a finished live workout has (lib/finish-workout.js), with the check-in's id, so Stats, the
// exercise history and the progression read it like any other workout.
import { useStore } from '../../store/useStore.js'
import { buildCompletedWorkout } from '../../lib/finish-workout.js'
import { bestWeightFor, bestWeightForEntry, lastEntryFor, modeOf, workoutVolume } from '../../lib/history.js'
import { beatsWeight } from '../../lib/exercises.js'
import { hasCompletedWork, isWarmupRow } from '../../lib/workout-model.js'
import { insertChronological } from '../../lib/backfill.js'
import { stampWorkout } from '../../lib/sync-merge.js'
import { deleteWorkout } from '../../lib/session-edit.js'
import { emit } from '../gamification/events'
import type { CheckinDetail } from './types'

type Cfg = { id: string; sets?: number; reps?: number; weight?: number; mode?: string }
type Routine = { id: string; name: string; ex: Cfg[] }
type Set = { w?: unknown; r?: unknown; done?: boolean }
type Entry = { id: string; target?: Cfg | null; sets?: Set[] }
// The app state is untyped JS; only what is read here is named.
type AppState = { routines?: Routine[]; workouts?: Workout[]; exWeights?: Record<string, { w: number; d?: string }> }
export type Workout = {
  id: string; d: string; start: number; end: number; routineIds: string[]; routineId: string | null; name: string
  bw: number | null; entries: { id: string; sets: { w: number; r: number; done: boolean }[]; topW?: number | null; rid?: string; target?: Cfg | null }[]
  prs: string[]; vol?: number; checkinId?: string
}

export type DraftSet = { w: number; r: number }
// One exercise of the detail sheet: `on` false when it was skipped.
export type DraftEntry = { id: string; on: boolean; sets: DraftSet[] }

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const routineOf = (S: AppState, id: string | null | undefined): Routine | null =>
  (id ? (S.routines ?? []).find(r => r.id === id) : null) ?? null

// The routine's exercises logged as weight × reps, with the sets of last time filled in (that
// routine's own last session first, then any). An exercise never trained opens at the routine's
// own sets, reps and weight. A detail already given reopens as it was, its skipped exercises off.
export function draftFor(S: AppState, routineId: string | null | undefined, initial?: CheckinDetail | null): DraftEntry[] {
  const r = routineOf(S, routineId)
  if (!r) return []
  const given = new Map((initial?.entries ?? []).map(e => [e.id, e]))
  const seen = new Set<string>()
  return r.ex
    .filter(cfg => modeOf(cfg) === 'reps' && !seen.has(cfg.id) && !!seen.add(cfg.id))
    .map(cfg => {
      const mine = given.get(cfg.id)
      if (mine) return { id: cfg.id, on: true, sets: mine.sets.map(s => ({ w: num(s.w), r: num(s.r) })) }
      const last = lastEntryFor(S, cfg.id, r.id) as { sets: Set[] } | null
      const sets = last?.sets?.length
        ? last.sets.map(s => ({ w: num(s.w), r: num(s.r) }))
        : Array.from({ length: Math.max(1, Math.round(num(cfg.sets))) }, () => ({ w: num(cfg.weight), r: num(cfg.reps) }))
      return { id: cfg.id, on: !initial, sets }
    })
}

// What the check-in keeps: the exercises on, with the sets that have reps.
export function detailOf(draft: DraftEntry[]): CheckinDetail | null {
  const entries = draft
    .filter(e => e.on)
    .map(e => ({ id: e.id, sets: e.sets.filter(s => s.r > 0).map(s => ({ w: s.w, r: s.r, done: true as const })) }))
    .filter(e => e.sets.length)
  return entries.length ? { entries } : null
}

// The detail of a finished live workout: its done work sets of weight × reps. Warm-ups, timed holds
// and cardio stay in the workout only.
export function detailOfWorkout(w: { id?: string; entries?: Entry[] } | null | undefined): CheckinDetail | null {
  const entries = (w?.entries ?? [])
    .filter(e => modeOf(e.target ?? { id: e.id }) === 'reps')
    .map(e => ({
      id: e.id,
      sets: (e.sets ?? []).filter(s => hasCompletedWork(s) && !isWarmupRow(s)).map(s => ({ w: num(s.w), r: num(s.r), done: true as const })).filter(s => s.r > 0)
    }))
    .filter(e => e.sets.length)
  return entries.length ? { entries } : null
}

export type CheckinWorkoutInput = {
  id: string
  day: string
  routineId: string | null
  name: string
  durationMin: number | null
  detail: CheckinDetail
  now?: number
}

// The session a detailed check-in adds to the history. It ends at this time of day on the check-in's
// day; without a duration it has none (start = end), rather than a made-up one. A heavier load than
// the history has is a PR, as at the end of a live workout.
export function checkinWorkout(S: AppState, input: CheckinWorkoutInput): Workout {
  const { id, day, durationMin, detail, now = Date.now() } = input
  const r = routineOf(S, input.routineId)
  const at = new Date(now)
  const endAt = new Date(day + 'T12:00:00')
  endAt.setHours(at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds())
  const end = endAt.getTime()
  const start = durationMin && durationMin > 0 ? end - durationMin * 60000 : end
  const cfgOf = (exId: string) => r?.ex.find(c => c.id === exId)
  const entries = detail.entries.map(e => ({
    id: e.id,
    sets: e.sets.map(s => ({ w: num(s.w), r: num(s.r), done: true })),
    target: { ...(cfgOf(e.id) ?? { id: e.id, mode: 'reps' }) },
    ...(r ? { rid: r.id } : {})
  }))
  const before = { ...S, workouts: (S.workouts ?? []).filter(w => w.id !== id) }
  const prs = entries
    .filter(e => beatsWeight(e.id, bestWeightForEntry(e), bestWeightFor(before, e.id)))
    .map(e => e.id)
  // finish-workout.js is untyped; its inferred option types read `prs` as never[].
  const build = buildCompletedWorkout as (active: unknown, o: { end: number; prs: string[] }) => Workout
  const w = build({ id, d: day, start, routineIds: r ? [r.id] : [], name: input.name, bw: null, entries }, { end, prs })
  w.vol = workoutVolume(w)
  return w
}

// Writes that session into S.workouts, in date order, in place of an earlier one of the same
// check-in (an edit of its detail), and moves the confirmed working weights it beats. Its PRs go to
// gamification as the end of a live workout sends them (sheets.jsx): one `pr` event per exercise,
// keyed `<session id>:<exercise>`, so sending them again for the same check-in is a no-op.
export function ingestCheckin(input: CheckinWorkoutInput): Workout {
  const w = stampWorkout(checkinWorkout(useStore.getState().S, input)) as Workout
  useStore.getState().update((s: Required<AppState>) => {
    s.workouts = insertChronological(s.workouts.filter(x => x.id !== w.id), w)
    s.exWeights = s.exWeights || {}
    for (const e of w.entries) {
      const mx = bestWeightForEntry(e)
      if (mx > 0 && beatsWeight(e.id, mx, s.exWeights[e.id]?.w || 0)) s.exWeights[e.id] = { w: mx, d: w.d }
    }
  })
  for (const ex of new Set(w.prs)) emit('pr', { ex }, `${w.id}:${ex}`, w.d)
  return w
}

// A check-in deleted, or a post the server refused for good: the session it wrote leaves the
// history the way a deleted workout does (lib/session-edit.js deleteWorkout), its kept weights
// with it. A live workout linked to it is a workout of its own and stays, without the link.
export function dropCheckinWorkout(checkinId: string): void {
  const S = useStore.getState().S as AppState
  const own = (S.workouts ?? []).some(w => w.id === checkinId)
  const linked = (S.workouts ?? []).some(w => w.checkinId === checkinId)
  if (!own && !linked) return
  useStore.getState().update((s: Required<AppState>) => {
    if (own) deleteWorkout(s, checkinId)
    for (const w of s.workouts) {
      if (w.checkinId !== checkinId) continue
      delete w.checkinId
      stampWorkout(w)
    }
  })
}

// A check-in posted at the end of a live workout: that workout is already the session in the
// history, so it is linked to the check-in rather than written twice.
export function linkWorkout(workoutId: string, checkinId: string): void {
  useStore.getState().update((s: Required<AppState>) => {
    const w = s.workouts.find(x => x.id === workoutId)
    if (!w) return
    w.checkinId = checkinId
    stampWorkout(w)
  })
}

// The history session of a check-in: the one written with its id, or the live workout linked to it.
export function workoutOfCheckin(S: AppState, checkinId: string): Workout | null {
  return (S.workouts ?? []).find(w => w.id === checkinId || w.checkinId === checkinId) ?? null
}
