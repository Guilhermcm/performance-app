// One-tap suggestions for the alerts of the plan analysis (spec §5.7). Pure: suggestionsFor reads
// the plan and describes small changes as before and after; applySuggestion makes one change in
// place (meant to run inside the store's update) and hands back the routines as they were, so
// the screen can offer Undo with restoreRoutines.
// Only the group alerts have a suggestion: too little (add sets, or add an exercise when no
// exercise has the group as its main muscle), none at all (add an exercise) and too much (take
// sets away). Long sessions, imbalance and repeated exercises are told in words, not changed.
import { EXIDX, isAssisted, isCardio } from '@/lib/exercises.js'
import { exAvailable } from '@/lib/equipment.js'
import { hasExplicitMuscleMetadata, musclesOf } from '@/lib/muscles.js'
import { analyzePlan, GROUP_OF, type Group, type MuscleSlug, type PlanInput } from './analysis'
import { RANGES, type AnalysisProfile } from './goal'
import { ISOLATION, slotToCfg, type Routine } from './programs'
import { estimateMinutes } from './time'

// The default exercise of each group; the first one the equipment allows is the one suggested.
export const DEFAULT_EXERCISES: Record<Group, string[]> = {
  chest: ['0025', '0289', '0577'],
  back: ['2330', '1323', '0499'],
  shoulders: ['0426', '0091'],
  biceps: ['0031', '0294'],
  triceps: ['0241'],
  quads: ['0739', '1760', '0043'],
  hamstrings: ['0586', '1459', '0085'],
  glutes: ['1409', '0739'],
  calves: ['0605', '0594'],
  abs: ['0175', '0276'],
}

// from: null is an exercise that is not in the routine yet
export type Change = { routineId: string; exId: string; from: number | null; to: number }
export type Suggestion = {
  kind: 'add-sets' | 'remove-sets' | 'add-exercise'
  group: Group
  changes: Change[]
  // the rep range of an added exercise comes from the profile it was suggested for
  profile?: AnalysisProfile
}

type PlanExercise = { id: string; sets: number; [k: string]: unknown }
type PlanRoutine = { id: string; ex: PlanExercise[]; [k: string]: unknown }
export type SuggestionState = Omit<PlanInput, 'routines'> & { routines: PlanRoutine[]; [k: string]: unknown }

const GROUPS = Object.keys(DEFAULT_EXERCISES) as Group[]
const HALF: Record<Group, 'upper' | 'lower' | null> = {
  chest: 'upper', back: 'upper', shoulders: 'upper', biceps: 'upper', triceps: 'upper',
  quads: 'lower', hamstrings: 'lower', glutes: 'lower', calves: 'lower', abs: null,
}
const REPS: Record<AnalysisProfile, { min: number; max: number }> = {
  hypertrophy: { min: 8, max: 12 }, strength: { min: 4, max: 6 }, health: { min: 8, max: 12 },
}
const ADDED_SETS = 3
const STEP_SETS = 2 // most sets added to one exercise
const FLOOR_SETS = 2 // no exercise goes below this
const ISOLATION_REST = 90
const COMPOUND_REST = 120

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const sets = (e: { sets?: unknown }) => Number(e.sets) || 0

// What one exercise gives each group per set (1 main, 0.5 any other), counting only exercises that
// the analysis counts: no cardio, no custom exercise without muscles of its own.
function weightsOf(S: SuggestionState, id: string): Partial<Record<Group, number>> {
  const custom = (S.customEx ?? []).find(e => e?.id === id)
  const exercise = custom ?? (EXIDX as Record<string, object | undefined>)[id]
  const isCustom = !!custom || (exercise as { custom?: boolean } | undefined)?.custom === true
  const muscles = musclesOf(exercise) as Record<string, number>
  if (!exercise || isCardio(exercise) || Object.keys(muscles).length === 0) return {}
  if (isCustom && !hasExplicitMuscleMetadata(exercise)) return {}
  const out: Partial<Record<Group, number>> = {}
  for (const [slug, weight] of Object.entries(muscles)) {
    const group = GROUP_OF[slug as MuscleSlug]
    if (group && weight > 0) out[group] = Math.max(out[group] ?? 0, weight === 1 ? 1 : 0.5)
  }
  return out
}

// The routines that are in the week, each once, in week order, with how many times a week it runs.
function scheduled(S: SuggestionState): { routine: PlanRoutine; times: number }[] {
  const byId = new Map(S.routines.map(r => [r.id, r]))
  const out = new Map<string, { routine: PlanRoutine; times: number }>()
  for (let day = 0; day < 7; day++) {
    for (const id of ([] as string[]).concat((S.week?.[day] as string | string[] | undefined) || [])) {
      const routine = byId.get(id)
      if (!routine) continue
      const seen = out.get(id)
      if (seen) seen.times++
      else out.set(id, { routine, times: 1 })
    }
  }
  return [...out.values()]
}

// First exercise of each id in a routine, with the weight it gives the group.
function exercisesFor(S: SuggestionState, routine: PlanRoutine, group: Group) {
  const seen = new Set<string>()
  const out: { ex: PlanExercise; weight: number }[] = []
  for (const ex of routine.ex ?? []) {
    if (!ex?.id || seen.has(ex.id)) continue
    seen.add(ex.id)
    const weight = weightsOf(S, ex.id)[group] ?? 0
    if (weight > 0) out.push({ ex, weight })
  }
  return out
}

function addSets(S: SuggestionState, group: Group, weekly: number, min: number): Change[] {
  let need = min - weekly
  const changes: Change[] = []
  for (const { routine, times } of scheduled(S)) {
    for (const { ex, weight } of exercisesFor(S, routine, group)) {
      if (need <= 0) return changes
      if (weight !== 1) continue
      // one set more in the routine is `times` sets in the week
      const add = Math.min(STEP_SETS, Math.ceil(need / times))
      changes.push({ routineId: routine.id, exId: ex.id, from: sets(ex), to: sets(ex) + add })
      need -= add * times
    }
  }
  return changes
}

function removeSets(S: SuggestionState, group: Group, weekly: number, max: number): Change[] {
  let excess = weekly - max
  const changes: Change[] = []
  // the exercises that train the group as a side effect give first, then the ones that exist for it
  for (const main of [false, true]) {
    for (const { routine, times } of scheduled(S)) {
      for (const { ex, weight } of exercisesFor(S, routine, group)) {
        if (excess <= 0) return changes
        if ((weight === 1) !== main) continue
        const room = sets(ex) - FLOOR_SETS
        if (room <= 0) continue
        const take = Math.min(room, Math.ceil(excess / (times * weight)))
        changes.push({ routineId: routine.id, exId: ex.id, from: sets(ex), to: sets(ex) - take })
        excess -= take * times * weight
      }
    }
  }
  return changes
}

// The routine of the week that already works the most on the same half of the body; a tie goes to
// the shorter one. Abs belong to neither half, so there the shortest routine wins.
function routineFor(S: SuggestionState, group: Group): PlanRoutine | null {
  const half = HALF[group]
  let best: { routine: PlanRoutine; score: number; minutes: number } | null = null
  for (const { routine } of scheduled(S)) {
    let score = 0
    for (const ex of routine.ex ?? []) {
      const weights = weightsOf(S, ex.id)
      for (const g of GROUPS) if (half && HALF[g] === half) score += sets(ex) * (weights[g] ?? 0)
    }
    const minutes = estimateMinutes(routine)
    if (!best || score > best.score || (score === best.score && minutes < best.minutes)) best = { routine, score, minutes }
  }
  return best?.routine ?? null
}

function addExercise(S: SuggestionState, group: Group, profile: AnalysisProfile): Suggestion | null {
  const routine = routineFor(S, group)
  if (!routine) return null
  const exId = DEFAULT_EXERCISES[group].find(id => {
    const ex = (EXIDX as Record<string, object | undefined>)[id]
    return !!ex && !isAssisted(ex) && exAvailable(S, ex) && !routine.ex.some(e => e.id === id)
  })
  if (!exId) return null
  return { kind: 'add-exercise', group, profile, changes: [{ routineId: routine.id, exId, from: null, to: ADDED_SETS }] }
}

export function suggestionsFor(S: SuggestionState, profile: AnalysisProfile): Suggestion[] {
  const analysis = analyzePlan(S, profile)
  const { min, max } = RANGES[profile]
  const out: Suggestion[] = []
  for (const alert of analysis.alerts) {
    const group = alert.group
    if (!group) continue
    const weekly = analysis.groups[group].sets
    if (alert.kind === 'missing') {
      const s = addExercise(S, group, profile)
      if (s) out.push(s)
    } else if (alert.kind === 'low') {
      const changes = addSets(S, group, weekly, min)
      if (changes.length) out.push({ kind: 'add-sets', group, changes })
      else {
        const s = addExercise(S, group, profile)
        if (s) out.push(s)
      }
    } else if (alert.kind === 'high') {
      const changes = removeSets(S, group, weekly, max)
      if (changes.length) out.push({ kind: 'remove-sets', group, changes })
    }
  }
  return out
}

// Makes the change on S.routines in place and returns the touched routines as they were before.
export function applySuggestion(S: { routines: PlanRoutine[] }, s: Suggestion): Routine[] {
  const touched = new Set(s.changes.map(c => c.routineId))
  const snapshot = clone(S.routines.filter(r => touched.has(r.id))) as unknown as Routine[]
  const range = REPS[s.profile ?? 'hypertrophy']
  for (const c of s.changes) {
    const routine = S.routines.find(r => r.id === c.routineId)
    if (!routine) continue
    if (c.from === null) {
      if (routine.ex.some(e => e.id === c.exId)) continue
      const restSec = ISOLATION.has(c.exId) ? ISOLATION_REST : COMPOUND_REST
      routine.ex.push(slotToCfg({ ex: c.exId, sets: c.to, reps: range.min, repsMax: range.max, restSec }) as unknown as PlanExercise)
    } else {
      const ex = routine.ex.find(e => e.id === c.exId)
      if (ex) ex.sets = c.to
    }
  }
  return snapshot
}

// Puts the snapshot of applySuggestion back; a routine deleted since stays deleted.
export function restoreRoutines(S: { routines: PlanRoutine[] }, snapshot: ReadonlyArray<{ id: string }>): void {
  for (const saved of snapshot) {
    const at = S.routines.findIndex(r => r.id === saved.id)
    if (at >= 0) S.routines[at] = clone(saved) as unknown as PlanRoutine
  }
}
