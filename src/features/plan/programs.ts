// The program catalog (spec §4.1 and §4.2) and how a program becomes the plan of the week.
// Training data only: the names, "who it is for" and "why" texts live as literal t() calls in
// the screens, where check-source-strings finds them. Routine names stay canonical English with
// the program prefix ("PPL · Push"), because they become ordinary routines of the person.
//
// Numbers the spec leaves open follow the controller's rulings for Task 2: rest is 90 s for
// isolation work, 120 s for hypertrophy and health compounds and 180 s for strength compounds
// with fixed reps; the Upper/Lower and PPL ranges come from the old starter reps (8 → 8 to 12,
// 10 → 10 to 12, 12 → 12 to 15, calves 15 → 12 to 15).
import { uid } from '@/lib/format.js'
import { EXIDX, isBodyweightEq } from '@/lib/exercises.js'
import { exAvailable } from '@/lib/equipment.js'
import type { AnalysisProfile } from './goal'
import type { RefId } from './references'

export type ProgramId = 'full-body-beginner' | 'upper-lower' | 'ppl' | 'strength-5x5'
  | 'power-hypertrophy' | 'short-2x' | 'health-3x'
export type Policy = 'double' | 'linear'

// A program's exercise as data: `reps` to `repsMax` is the range ("8 a 12" is reps 8, repsMax 12);
// no repsMax means fixed reps. slotToCfg turns it into the shape a routine stores.
export type Slot = { ex: string; sets: number; reps: number; repsMax?: number; restSec: number; alt?: string[]; prog?: Policy }

export type Program = {
  id: ProgramId
  prefix: string
  goals: AnalysisProfile[]
  level: 'beginner' | 'intermediate' | 'advanced'
  // [weekday, routineKey]; weekday is a DAYN index, so 1 is Monday
  variants: { days: number; schedule: [number, string][] }[]
  prog: Policy
  routines: { key: string; name: string; emoji: string; slots: Slot[] }[]
  refs: RefId[]
}

// A routine exercise in the app's persisted convention (src/lib/rep-range.js): a loaded range
// keeps its top in `reps` and its bottom in `repsMin`; a bodyweight range climbs from `reps` to
// the `repsMax` ceiling (src/lib/progression.js).
export type RoutineEx = {
  id: string; sets: number; reps: number; repsMin?: number; repsMax?: number
  weight: number; restSec: number; prog?: Policy
}
export type Routine = { id: string; name: string; emoji: string; prog: Policy; ex: RoutineEx[] }

export type Week = Record<number, string[] | string>
export type AppliedProgram = {
  id: ProgramId; variant: number; appliedAt: number; routineIds: string[]; prevWeek: Week; dismissed: boolean
}
// The part of the synced state S that programs read and write.
export type PlanState = {
  routines: { id: string; [k: string]: unknown }[]
  week: Week
  workouts?: { routineIds?: string[]; routineId?: string | null; [k: string]: unknown }[]
  program?: AppliedProgram
  [k: string]: unknown
}

// Single-joint work rests 90 s; everything else is a compound.
const ISOLATION = new Set(['0586', '0334', '0031', '0294', '0585', '0241', '0605', '0594', '0313', '0175', '0276'])

// Hypertrophy and health slot: a range, rest by kind of exercise.
const hyp = (ex: string, sets: number, reps: number, repsMax: number, alt?: string[]): Slot =>
  ({ ex, sets, reps, repsMax, restSec: ISOLATION.has(ex) ? 90 : 120, ...(alt ? { alt } : {}) })
// Strength compound with fixed reps.
const str = (ex: string, sets: number, reps: number, prog?: Policy): Slot =>
  ({ ex, sets, reps, restSec: 180, ...(prog ? { prog } : {}) })

const HYPERTROPHY_REFS: RefId[] = ['schoenfeld2017', 'schoenfeld2016', 'schoenfeld2021', 'schoenfeld2016rest', 'plotkin2022']
const STRENGTH_REFS: RefId[] = ['ralston2017', 'grgic2018freq', 'grgic2018rest']

export const PROGRAMS: Record<ProgramId, Program> = {
  'full-body-beginner': {
    id: 'full-body-beginner', prefix: 'Full Body', goals: ['health', 'hypertrophy'], level: 'beginner', prog: 'double',
    variants: [{ days: 3, schedule: [[1, 'a'], [3, 'b'], [5, 'c']] }],
    routines: [
      { key: 'a', name: 'A', emoji: 'figureStrength', slots: [
        hyp('0043', 3, 8, 12, ['1760']), hyp('0025', 3, 8, 12, ['0289', '0577']), hyp('2330', 3, 10, 12, ['0499']),
        hyp('0586', 2, 10, 15), hyp('0334', 2, 12, 15), hyp('0031', 2, 10, 12, ['0294']),
      ] },
      { key: 'b', name: 'B', emoji: 'figureStrength', slots: [
        hyp('0085', 3, 8, 12, ['1459']), hyp('0047', 3, 8, 12, ['0314']), hyp('1323', 3, 10, 12, ['0861', '1350']),
        hyp('0585', 2, 12, 15), hyp('0241', 2, 10, 15), hyp('0605', 3, 12, 15, ['0594']),
      ] },
      { key: 'c', name: 'C', emoji: 'figureStrength', slots: [
        hyp('0739', 3, 10, 12), hyp('0426', 3, 8, 12, ['0091']), hyp('0027', 3, 8, 12, ['0293']),
        hyp('0336', 2, 10, 12), hyp('0313', 2, 10, 12), hyp('0175', 2, 10, 15, ['0276']),
      ] },
    ],
    refs: HYPERTROPHY_REFS,
  },
  'upper-lower': {
    id: 'upper-lower', prefix: 'Upper/Lower', goals: ['hypertrophy'], level: 'intermediate', prog: 'double',
    variants: [{ days: 4, schedule: [[1, 'upper-a'], [2, 'lower-a'], [4, 'upper-b'], [5, 'lower-b']] }],
    routines: [
      { key: 'upper-a', name: 'Upper A', emoji: 'barbell', slots: [
        hyp('0025', 3, 8, 12), hyp('2330', 3, 10, 12), hyp('0047', 2, 10, 12), hyp('1323', 2, 10, 12),
        hyp('0334', 2, 12, 15), hyp('0241', 2, 12, 15), hyp('0031', 2, 12, 15),
      ] },
      { key: 'lower-a', name: 'Lower A', emoji: 'legs', slots: [
        hyp('0043', 3, 8, 12), hyp('0085', 3, 8, 12), hyp('0739', 2, 10, 12), hyp('0586', 2, 12, 15), hyp('0605', 3, 12, 15),
      ] },
      { key: 'upper-b', name: 'Upper B', emoji: 'barbell', slots: [
        hyp('0047', 3, 8, 12), hyp('0027', 3, 8, 12), hyp('0426', 2, 10, 12), hyp('2330', 2, 10, 12),
        hyp('0334', 2, 12, 15), hyp('0241', 2, 12, 15), hyp('0313', 2, 12, 15),
      ] },
      { key: 'lower-b', name: 'Lower B', emoji: 'legs', slots: [
        hyp('0739', 3, 10, 12), hyp('0085', 2, 10, 12), hyp('0585', 2, 12, 15), hyp('0586', 3, 12, 15), hyp('0605', 3, 12, 15),
      ] },
    ],
    refs: HYPERTROPHY_REFS,
  },
  ppl: {
    id: 'ppl', prefix: 'PPL', goals: ['hypertrophy'], level: 'intermediate', prog: 'double',
    variants: [
      { days: 3, schedule: [[1, 'push'], [3, 'pull'], [5, 'legs']] },
      { days: 6, schedule: [[1, 'push'], [2, 'pull'], [3, 'legs'], [4, 'push'], [5, 'pull'], [6, 'legs']] },
    ],
    routines: [
      { key: 'push', name: 'Push', emoji: 'barbell', slots: [
        hyp('0025', 4, 8, 12), hyp('0047', 3, 10, 12), hyp('0426', 3, 10, 12), hyp('0334', 3, 12, 15),
        hyp('0241', 3, 12, 15), hyp('0251', 3, 10, 12),
      ] },
      { key: 'pull', name: 'Pull', emoji: 'pullup', slots: [
        hyp('2330', 4, 10, 12), hyp('0027', 4, 8, 12), hyp('1323', 3, 10, 12), hyp('0031', 3, 10, 12), hyp('0313', 3, 12, 15),
      ] },
      { key: 'legs', name: 'Legs', emoji: 'legs', slots: [
        hyp('0043', 4, 8, 12), hyp('0085', 3, 10, 12), hyp('0739', 3, 12, 15), hyp('0585', 3, 12, 15),
        hyp('0586', 3, 12, 15), hyp('0605', 4, 12, 15),
      ] },
    ],
    refs: HYPERTROPHY_REFS,
  },
  'strength-5x5': {
    id: 'strength-5x5', prefix: '5×5', goals: ['strength'], level: 'beginner', prog: 'linear',
    variants: [{ days: 3, schedule: [[1, 'a'], [3, 'b'], [5, 'c']] }],
    routines: [
      { key: 'a', name: 'A', emoji: 'barbell', slots: [str('0043', 5, 5), str('0025', 5, 5), str('0027', 5, 5)] },
      { key: 'b', name: 'B', emoji: 'barbell', slots: [str('0085', 5, 5), str('0426', 5, 5), str('2330', 5, 5)] },
      { key: 'c', name: 'C', emoji: 'barbell', slots: [str('0739', 5, 5), str('0047', 5, 5), str('1323', 5, 5)] },
    ],
    refs: STRENGTH_REFS,
  },
  'power-hypertrophy': {
    id: 'power-hypertrophy', prefix: 'PHUL', goals: ['strength', 'hypertrophy'], level: 'intermediate', prog: 'double',
    variants: [{ days: 4, schedule: [[1, 'upper-strength'], [2, 'lower-strength'], [4, 'upper-hypertrophy'], [5, 'lower-hypertrophy']] }],
    routines: [
      { key: 'upper-strength', name: 'Upper Strength', emoji: 'barbell', slots: [
        str('0025', 4, 5, 'linear'), str('0027', 4, 5, 'linear'), str('0091', 3, 6, 'linear'), str('2330', 3, 8, 'linear'),
        hyp('0031', 2, 8, 10), hyp('0241', 2, 8, 10),
      ] },
      { key: 'lower-strength', name: 'Lower Strength', emoji: 'legs', slots: [
        str('0043', 4, 5, 'linear'), str('0085', 3, 6, 'linear'), str('0739', 3, 8, 'linear'),
        hyp('0586', 3, 8, 10), hyp('0605', 4, 8, 10),
      ] },
      { key: 'upper-hypertrophy', name: 'Upper Hypertrophy', emoji: 'dumbbell', slots: [
        hyp('0314', 3, 8, 12), hyp('1323', 3, 10, 12), hyp('0334', 3, 12, 15), hyp('2330', 3, 10, 12),
        hyp('0313', 3, 10, 12), hyp('0241', 3, 10, 15),
      ] },
      { key: 'lower-hypertrophy', name: 'Lower Hypertrophy', emoji: 'legs', slots: [
        hyp('0739', 3, 10, 15), hyp('1459', 3, 10, 12), hyp('0585', 3, 12, 15), hyp('0586', 3, 12, 15), hyp('0594', 4, 12, 15),
      ] },
    ],
    refs: [...STRENGTH_REFS, ...HYPERTROPHY_REFS],
  },
  'short-2x': {
    id: 'short-2x', prefix: 'Short', goals: ['health'], level: 'beginner', prog: 'double',
    variants: [{ days: 2, schedule: [[2, 'a'], [5, 'b']] }],
    routines: [
      { key: 'a', name: 'A', emoji: 'timer', slots: [
        hyp('0739', 3, 8, 12), hyp('0025', 3, 8, 12, ['0577']), hyp('2330', 3, 8, 12), hyp('0085', 2, 8, 12),
      ] },
      { key: 'b', name: 'B', emoji: 'timer', slots: [
        hyp('1760', 3, 8, 12), hyp('0426', 3, 8, 12), hyp('1323', 3, 8, 12), hyp('1409', 2, 10, 12),
      ] },
    ],
    refs: ['iversen2021', 'who2020'],
  },
  'health-3x': {
    id: 'health-3x', prefix: 'Health', goals: ['health'], level: 'beginner', prog: 'double',
    variants: [{ days: 3, schedule: [[1, 'a'], [3, 'b'], [5, 'a']] }],
    routines: [
      { key: 'a', name: 'A', emoji: 'heart', slots: [
        hyp('0739', 2, 8, 12), hyp('0289', 2, 8, 12), hyp('2330', 2, 8, 12), hyp('0586', 2, 8, 12), hyp('0276', 2, 8, 12),
      ] },
      { key: 'b', name: 'B', emoji: 'heart', slots: [
        hyp('1760', 2, 8, 12), hyp('1323', 2, 8, 12), hyp('0426', 2, 8, 12), hyp('1409', 2, 8, 12), hyp('0605', 2, 8, 12),
      ] },
    ],
    refs: ['who2020', 'acsm2009'],
  },
}

// One slot as a routine exercise, for the exercise actually used (the slot's own or an
// alternate): bodyweight is judged on that one. Task 5 reuses this to add an exercise.
export function slotToCfg(slot: Slot, exId: string = slot.ex): RoutineEx {
  const range = slot.repsMax != null && slot.repsMax > slot.reps
  const reps = !range
    ? { reps: slot.reps }
    : isBodyweightEq(exId)
      ? { reps: slot.reps, repsMax: slot.repsMax }
      : { reps: slot.repsMax as number, repsMin: slot.reps }
  return { id: exId, sets: slot.sets, ...reps, weight: 0, restSec: slot.restSec, ...(slot.prog ? { prog: slot.prog } : {}) }
}

const CATALOG = EXIDX as Record<string, { eq?: string } | undefined>

const usable = (S: unknown, id: string) => {
  const ex = CATALOG[id]
  return !!ex && exAvailable(S, ex)
}

// Fresh routines (new ids) and the week of one variant. Under an active equipment profile, an
// exercise whose equipment is not there gives way to its first available alternate; with none,
// the exercise stays and its id is listed in `missing`, once.
export function buildProgram(S: unknown, id: ProgramId, variant = 0): { routines: Routine[]; week: Record<number, string[]>; missing: string[] } {
  const program = PROGRAMS[id]
  const missing: string[] = []
  const routines = program.routines.map(r => ({
    id: uid(),
    name: `${program.prefix} · ${r.name}`,
    emoji: r.emoji,
    prog: program.prog,
    ex: r.slots.map(slot => {
      if (usable(S, slot.ex)) return slotToCfg(slot)
      const alt = slot.alt?.find(a => usable(S, a))
      if (alt) return slotToCfg(slot, alt)
      if (!missing.includes(slot.ex)) missing.push(slot.ex)
      return slotToCfg(slot)
    }),
  }))
  const byKey = new Map(program.routines.map((r, i) => [r.key, routines[i].id]))
  const week: Record<number, string[]> = {}
  for (const [day, key] of (program.variants[variant] ?? program.variants[0]).schedule) {
    week[day] = [...(week[day] ?? []), byKey.get(key) as string]
  }
  return { routines, week, missing }
}

// The routines of a program with every main exercise, whatever the equipment (the demo build).
export const programRoutines = (id: ProgramId): Routine[] => buildProgram({}, id).routines

// One state change, meant to run inside the store's update: adds the program's routines, swaps
// the week for its schedule and remembers the week it replaced. Routines already there and the
// date-specific changes of S.dayPlan stay as they are.
export function applyProgram(S: PlanState, id: ProgramId, variant = 0): void {
  const { routines, week } = buildProgram(S, id, variant)
  const prevWeek = JSON.parse(JSON.stringify(S.week ?? {})) as Week
  S.routines.push(...routines)
  S.week = week
  S.program = { id, variant, appliedAt: Date.now(), routineIds: routines.map(r => r.id), prevWeek, dismissed: false }
}

const trainedOn = (S: PlanState, routineId: string) =>
  (S.workouts ?? []).some(w => (Array.isArray(w.routineIds) && w.routineIds.includes(routineId)) || w.routineId === routineId)

// Undo the last applied program: the week comes back, the program's routines that were never
// trained go, and a routine with a logged workout stays in the list, off the schedule. `kept`
// names those, so the screen can say so.
export function undoProgram(S: PlanState): { kept: string[] } {
  const program = S.program
  if (!program) return { kept: [] }
  const ids = new Set(program.routineIds)
  const kept = program.routineIds.filter(rid => trainedOn(S, rid))
  S.week = JSON.parse(JSON.stringify(program.prevWeek ?? {})) as Week
  S.routines = S.routines.filter(r => !ids.has(r.id) || kept.includes(r.id))
  delete S.program
  return { kept }
}
