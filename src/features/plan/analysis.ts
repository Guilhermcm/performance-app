// The plan analysis engine (spec §5): what the week of routines asks of each muscle group.
// Pure: it reads the schedule (S.week) and the routines, never the workout history, so it works
// for a person with no workouts yet. The numbers it uses are the global rules of phase 1d:
// the main muscle of an exercise counts 1 set and any other muscle it trains counts 0.5
// (musclesOf is untouched, its 0.4 weight is for the muscle maps), and a weekday counts for a
// group from 2 fractional sets on.
import { EXIDX, isCardio } from '@/lib/exercises.js'
import { hasExplicitMuscleMetadata, musclesOf } from '@/lib/muscles.js'
import { RANGES, type AnalysisProfile } from './goal'
import { estimateMinutes, type TimedRoutine } from './time'

export type MuscleSlug = 'trapezius' | 'deltoids' | 'chest' | 'upper-back' | 'serratus' | 'biceps' | 'triceps'
  | 'forearm' | 'abs' | 'obliques' | 'lower-back' | 'gluteal' | 'quadriceps' | 'hamstring' | 'adductors'
  | 'hip-flexors' | 'calves' | 'tibialis'

export type Group = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs'

// The ten bars of the screen; the other muscles (traps, forearms, lower back...) have none.
export const GROUP_OF: Partial<Record<MuscleSlug, Group>> = {
  chest: 'chest', 'upper-back': 'back', deltoids: 'shoulders', biceps: 'biceps', triceps: 'triceps',
  quadriceps: 'quads', hamstring: 'hamstrings', gluteal: 'glutes', calves: 'calves', abs: 'abs', obliques: 'abs',
}

// Groups of a size that no week should leave at 0 sets.
export const BIG_GROUPS: Group[] = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes']

const GROUPS: Group[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs']

export type Status = 'missing' | 'low' | 'ok' | 'high'

export type Alert = {
  kind: 'missing' | 'low' | 'high' | 'frequency' | 'balance-push-pull' | 'balance-quad-ham' | 'long' | 'repeated'
  group?: Group
  routineId?: string
  exId?: string
}

export type PlanAnalysis = {
  empty: boolean
  groups: Record<Group, { sets: number; days: number; status: Status }>
  // ids of the scheduled exercises that train no known muscle (custom ones, mostly)
  unknown: string[]
  minutes: { routineId: string; minutes: number }[]
  balance: { push: number; pull: number; quads: number; hamstrings: number }
  alerts: Alert[]
}

type PlanExercise = { id?: string; sets?: number; restSec?: number }
type PlanRoutine = TimedRoutine & { id: string; ex: ReadonlyArray<PlanExercise> }
export type PlanInput = {
  // a day may still hold one routine id as a plain string (the legacy shape, see Plan.jsx)
  week?: Partial<Record<number, string | ReadonlyArray<string>>> | null
  routines?: ReadonlyArray<PlanRoutine> | null
  customEx?: ReadonlyArray<{ id?: string }> | null
}

const MIN_DAY_SETS = 2 // fractional sets that make a weekday count for a group
const LONG_MINUTES = 75
const REPEATED_DAYS = 3
const BALANCE_RATIO = 2 / 3

// Fractional sets per group for one exercise: the biggest weight among the muscles of a group
// wins, so an exercise that trains abs and obliques does not count the abs twice.
function groupWeights(ex: object | undefined): Partial<Record<Group, number>> {
  const out: Partial<Record<Group, number>> = {}
  const weights = musclesOf(ex) as Record<string, number>
  for (const [slug, weight] of Object.entries(weights)) {
    const group = GROUP_OF[slug as MuscleSlug]
    if (!group || !(weight > 0)) continue
    out[group] = Math.max(out[group] ?? 0, weight === 1 ? 1 : 0.5)
  }
  return out
}

type Customs = ReadonlyMap<string, object>
const customsOf = (S: Pick<PlanInput, 'customEx'>): Customs =>
  new Map((S.customEx ?? []).filter(e => e?.id).map(e => [e.id as string, e as object]))

// How the analysis counts one exercise: cardio only takes time; an exercise with no known muscle
// (a custom one that names none, or an id found nowhere) stays out of the volume; any other gives
// its groups 1 or 0.5 per set.
function classify(customs: Customs, id: string): { kind: 'cardio' | 'unknown' | 'counted'; weights: Partial<Record<Group, number>> } {
  const exercise = customs.get(id) ?? (EXIDX as Record<string, object | undefined>)[id]
  // A custom exercise that names no muscle only has its body part to go by; that guess stays out.
  const isCustom = customs.has(id) || (exercise as { custom?: boolean } | undefined)?.custom === true
  if (isCardio(exercise)) return { kind: 'cardio', weights: {} }
  if (Object.keys(musclesOf(exercise) as object).length === 0 || (isCustom && !hasExplicitMuscleMetadata(exercise))) {
    return { kind: 'unknown', weights: {} }
  }
  return { kind: 'counted', weights: groupWeights(exercise) }
}

// The fractional sets one set of the exercise gives each group, under the analysis rules (empty for
// cardio and for an exercise with no known muscle). The suggestions use it too, so the two agree.
export function exerciseGroupWeights(S: Pick<PlanInput, 'customEx'>, id: string): Partial<Record<Group, number>> {
  return classify(customsOf(S), id).weights
}

export function analyzePlan(S: PlanInput, profile: AnalysisProfile): PlanAnalysis {
  const routines = new Map((S.routines ?? []).map(r => [r.id, r]))
  const customs = customsOf(S)

  const total = {} as Record<Group, number>
  const dayHits = {} as Record<Group, number>
  GROUPS.forEach(g => { total[g] = 0; dayHits[g] = 0 })
  const unknown: string[] = []
  const minutes: { routineId: string; minutes: number }[] = []
  const exerciseDays = new Map<string, Set<number>>()
  let scheduled = 0

  for (let day = 0; day < 7; day++) {
    const dayTotal = {} as Record<Group, number>
    GROUPS.forEach(g => { dayTotal[g] = 0 })
    for (const routineId of ([] as string[]).concat((S.week?.[day] as string | string[] | undefined) || [])) {
      const routine = routines.get(routineId)
      if (!routine) continue // an id in the schedule whose routine was deleted
      if (!minutes.some(m => m.routineId === routine.id)) minutes.push({ routineId: routine.id, minutes: estimateMinutes(routine) })
      for (const e of routine.ex ?? []) {
        if (!e?.id) continue
        scheduled++
        // Cardio trains no muscle group worth a bar, it only takes time; it is not a repeated
        // exercise either (a bike on 3 days is not a lift to swap).
        const { kind, weights } = classify(customs, e.id)
        if (kind === 'cardio') continue
        const days = exerciseDays.get(e.id) ?? new Set<number>()
        days.add(day)
        exerciseDays.set(e.id, days)
        if (kind === 'unknown') {
          if (!unknown.includes(e.id)) unknown.push(e.id)
          continue
        }
        const sets = Number(e.sets) || 0
        for (const g of GROUPS) dayTotal[g] += sets * (weights[g] ?? 0)
      }
    }
    for (const g of GROUPS) {
      total[g] += dayTotal[g]
      if (dayTotal[g] >= MIN_DAY_SETS) dayHits[g]++
    }
  }

  const { min, max } = RANGES[profile]
  const groups = {} as PlanAnalysis['groups']
  for (const g of GROUPS) {
    const sets = total[g]
    const status: Status = sets < min
      ? (sets === 0 && BIG_GROUPS.includes(g) ? 'missing' : 'low')
      : sets > max ? 'high' : 'ok'
    groups[g] = { sets, days: dayHits[g], status }
  }

  const balance = {
    push: total.chest + total.shoulders + total.triceps,
    pull: total.back + total.biceps,
    quads: total.quads,
    hamstrings: total.hamstrings,
  }

  const empty = scheduled === 0
  const alerts: Alert[] = []
  if (!empty) {
    for (const g of GROUPS) if (groups[g].status === 'missing') alerts.push({ kind: 'missing', group: g })
    for (const g of GROUPS) if (groups[g].status === 'low') alerts.push({ kind: 'low', group: g })
    for (const g of GROUPS) if (groups[g].status === 'high') alerts.push({ kind: 'high', group: g })
    if (profile === 'hypertrophy') {
      for (const g of GROUPS) if (groups[g].sets > 0 && groups[g].days < 2) alerts.push({ kind: 'frequency', group: g })
    }
    const unbalanced = (a: number, b: number) => Math.min(a, b) < Math.max(a, b) * BALANCE_RATIO
    if (unbalanced(balance.push, balance.pull)) alerts.push({ kind: 'balance-push-pull' })
    if (unbalanced(balance.quads, balance.hamstrings)) alerts.push({ kind: 'balance-quad-ham' })
    for (const m of minutes) if (m.minutes > LONG_MINUTES) alerts.push({ kind: 'long', routineId: m.routineId })
    for (const [exId, days] of exerciseDays) if (days.size >= REPEATED_DAYS) alerts.push({ kind: 'repeated', exId })
  }

  return { empty, groups, unknown, minutes, balance, alerts }
}
