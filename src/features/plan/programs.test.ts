import { describe, expect, it } from 'vitest'
import {
  PROGRAMS, applyProgram, buildProgram, programRoutines, slotToCfg, undoProgram,
  type PlanState, type ProgramId, type Slot,
} from './programs'
import { REFS } from './references'
import { analyzePlan, exerciseMainGroup, type Alert } from './analysis'
import { suggestionsFor } from './suggestions'
import { EXIDX } from '@/lib/exercises.js'
import { musclesOf } from '@/lib/muscles.js'
import { GLYPHS } from '@/lib/glyphs.js'

const CATALOG = EXIDX as Record<string, object | undefined>

// One slot as text: "ex setsxreps[-repsMax] rest[ alt a,b][ prog]".
const fmt = (s: Slot) =>
  `${s.ex} ${s.sets}x${s.reps}${s.repsMax ? `-${s.repsMax}` : ''} ${s.restSec}`
  + `${s.alt?.length ? ` alt ${s.alt.join(',')}` : ''}${s.prog ? ` ${s.prog}` : ''}`

// Spec §4.2 with the controller's rulings for the numbers it leaves open (Task 2 report):
// rest 90 s isolation, 120 s hypertrophy and health compounds, 180 s strength compounds;
// upper-lower and ppl ranges 8→8-12, 10→10-12, 12→12-15, calves 15→12-15.
const EXPECTED: Record<ProgramId, {
  prefix: string; goals: string[]; level: string; prog: string; schedules: [number, string][][]
  routines: Record<string, [name: string, slots: string[]]>
}> = {
  'full-body-beginner': {
    prefix: 'Full Body', goals: ['health', 'hypertrophy'], level: 'beginner', prog: 'double',
    schedules: [[[1, 'a'], [3, 'b'], [5, 'c']]],
    routines: {
      a: ['A', ['0043 3x8-12 120 alt 1760', '0025 3x8-12 120 alt 0289,0577', '2330 3x10-12 120 alt 0499', '0586 2x10-15 90', '0334 2x12-15 90', '0031 2x10-12 90 alt 0294']],
      b: ['B', ['0085 3x8-12 120 alt 1459', '0047 3x8-12 120 alt 0314', '1323 3x10-12 120 alt 0861,1350', '0585 2x12-15 90', '0241 2x10-15 90', '0605 3x12-15 90 alt 0594']],
      c: ['C', ['0739 3x10-12 120', '0426 3x8-12 120 alt 0091', '0027 3x8-12 120 alt 0293', '0336 2x10-12 120', '0313 2x10-12 90', '0175 2x10-15 90 alt 0276']],
    },
  },
  'upper-lower': {
    prefix: 'Upper/Lower', goals: ['hypertrophy'], level: 'intermediate', prog: 'double',
    schedules: [[[1, 'upper-a'], [2, 'lower-a'], [4, 'upper-b'], [5, 'lower-b']]],
    routines: {
      'upper-a': ['Upper A', ['0025 3x8-12 120', '2330 3x10-12 120', '0047 2x10-12 120', '1323 2x10-12 120', '0334 2x12-15 90', '0241 2x12-15 90', '0031 2x12-15 90']],
      'lower-a': ['Lower A', ['0043 3x8-12 120', '0085 3x8-12 120', '0739 2x10-12 120', '0586 2x12-15 90', '0605 3x12-15 90']],
      'upper-b': ['Upper B', ['0047 3x8-12 120', '0027 3x8-12 120', '0426 2x10-12 120', '2330 2x10-12 120', '0334 2x12-15 90', '0241 2x12-15 90', '0313 2x12-15 90']],
      'lower-b': ['Lower B', ['0739 3x10-12 120', '0085 2x10-12 120', '0585 2x12-15 90', '0586 3x12-15 90', '0605 3x12-15 90']],
    },
  },
  ppl: {
    prefix: 'PPL', goals: ['hypertrophy'], level: 'intermediate', prog: 'double',
    schedules: [
      [[1, 'push'], [3, 'pull'], [5, 'legs']],
      [[1, 'push'], [2, 'pull'], [3, 'legs'], [4, 'push'], [5, 'pull'], [6, 'legs']],
    ],
    routines: {
      push: ['Push', ['0025 4x8-12 120', '0047 3x10-12 120', '0426 3x10-12 120', '0334 3x12-15 90', '0241 3x12-15 90', '0251 3x10-12 120']],
      pull: ['Pull', ['2330 4x10-12 120', '0027 4x8-12 120', '1323 3x10-12 120', '0031 3x10-12 90', '0313 3x12-15 90']],
      legs: ['Legs', ['0043 4x8-12 120', '0085 3x10-12 120', '0739 3x12-15 120', '0585 3x12-15 90', '0586 3x12-15 90', '0605 4x12-15 90']],
    },
  },
  'strength-5x5': {
    prefix: '5×5', goals: ['strength'], level: 'beginner', prog: 'linear',
    schedules: [[[1, 'a'], [3, 'b'], [5, 'c']]],
    routines: {
      a: ['A', ['0043 5x5 180', '0025 5x5 180', '0027 5x5 180']],
      b: ['B', ['0085 5x5 180', '0426 5x5 180', '2330 5x5 180']],
      c: ['C', ['0739 5x5 180', '0047 5x5 180', '1323 5x5 180']],
    },
  },
  'power-hypertrophy': {
    prefix: 'PHUL', goals: ['strength', 'hypertrophy'], level: 'intermediate', prog: 'double',
    schedules: [[[1, 'upper-strength'], [2, 'lower-strength'], [4, 'upper-hypertrophy'], [5, 'lower-hypertrophy']]],
    routines: {
      'upper-strength': ['Upper Strength', ['0025 4x5 180 linear', '0027 4x5 180 linear', '0091 3x6 180 linear', '2330 3x8 180 linear', '0031 2x8-10 90', '0241 2x8-10 90']],
      'lower-strength': ['Lower Strength', ['0043 4x5 180 linear', '0085 3x6 180 linear', '0739 3x8 180 linear', '0586 3x8-10 90', '0605 4x8-10 90']],
      'upper-hypertrophy': ['Upper Hypertrophy', ['0314 3x8-12 120', '1323 3x10-12 120', '0334 3x12-15 90', '2330 3x10-12 120', '0313 3x10-12 90', '0241 3x10-15 90']],
      'lower-hypertrophy': ['Lower Hypertrophy', ['0739 3x10-15 120', '1459 3x10-12 120', '0585 3x12-15 90', '0586 3x12-15 90', '0594 4x12-15 90']],
    },
  },
  'short-2x': {
    prefix: 'Short', goals: ['health'], level: 'beginner', prog: 'double',
    schedules: [[[2, 'a'], [5, 'b']]],
    routines: {
      a: ['A', ['0739 3x8-12 120', '0025 3x8-12 120 alt 0577', '2330 3x8-12 120', '0085 2x8-12 120']],
      b: ['B', ['1760 3x8-12 120', '0426 3x8-12 120', '1323 3x8-12 120', '1409 2x10-12 120']],
    },
  },
  'health-3x': {
    prefix: 'Health', goals: ['health'], level: 'beginner', prog: 'double',
    schedules: [[[1, 'a'], [3, 'b'], [5, 'a']]],
    routines: {
      a: ['A', ['0739 2x8-12 120', '0289 2x8-12 120', '2330 2x8-12 120', '0586 2x8-12 90', '0276 2x8-12 90']],
      b: ['B', ['1760 2x8-12 120', '1323 2x8-12 120', '0426 2x8-12 120', '1409 2x8-12 120', '0605 2x8-12 90']],
    },
  },
}

const IDS = Object.keys(EXPECTED) as ProgramId[]
const noBarbell = (equipment: string[]): PlanState => ({
  routines: [], week: {}, equipFilterOn: true, activeEquipId: 'home',
  equipProfiles: [{ id: 'home', name: 'Home', equipment }],
})

describe('program catalog (spec §4.2)', () => {
  it('has the 7 programs', () => {
    expect(Object.keys(PROGRAMS).sort()).toEqual([...IDS].sort())
  })

  it.each(IDS)('%s matches the spec', id => {
    const p = PROGRAMS[id]
    const want = EXPECTED[id]
    expect(p.id).toBe(id)
    expect(p.prefix).toBe(want.prefix)
    expect([...p.goals].sort()).toEqual([...want.goals].sort())
    expect(p.level).toBe(want.level)
    expect(p.prog).toBe(want.prog)
    expect(p.variants.map(v => v.schedule)).toEqual(want.schedules)
    expect(p.variants.map(v => v.days)).toEqual(want.schedules.map(s => s.length))
    expect(Object.fromEntries(p.routines.map(r => [r.key, [r.name, r.slots.map(fmt)]]))).toEqual(want.routines)
    // every routine is on the schedule of some variant, and every scheduled key exists
    const keys = new Set(p.routines.map(r => r.key))
    const scheduled = new Set(p.variants.flatMap(v => v.schedule.map(([, k]) => k)))
    expect(scheduled).toEqual(keys)
  })

  it('ppl has the 3-day (Mon/Wed/Fri) and 6-day (Mon to Sat) variants', () => {
    expect(PROGRAMS.ppl.variants.map(v => v.schedule.map(([d]) => d))).toEqual([[1, 3, 5], [1, 2, 3, 4, 5, 6]])
  })

  it('uses only catalogue exercises with a known muscle map, alternates included', () => {
    for (const p of Object.values(PROGRAMS)) {
      for (const r of p.routines) {
        for (const s of r.slots) {
          expect(s.alt?.length ?? 0, `${p.id} ${s.ex}`).toBeLessThanOrEqual(2)
          for (const ex of [s.ex, ...(s.alt ?? [])]) {
            expect(CATALOG[ex], `${p.id} ${ex}`).toBeDefined()
            expect(Object.keys(musclesOf(CATALOG[ex])).length, `${p.id} ${ex} muscles`).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('gives every routine a glyph from the routine picker', () => {
    for (const p of Object.values(PROGRAMS)) for (const r of p.routines) expect(GLYPHS, `${p.id} ${r.key}`).toContain(r.emoji)
  })

  it('cites at least one existing reference per program (Review Focus 5)', () => {
    for (const p of Object.values(PROGRAMS)) {
      expect(p.refs.length, p.id).toBeGreaterThan(0)
      for (const ref of p.refs) expect(REFS, `${p.id} ${ref}`).toHaveProperty(ref)
    }
    expect(PROGRAMS['short-2x'].refs).toContain('iversen2021')
  })
})

describe('program refs (final review m4)', () => {
  it('5×5 cites the rep-continuum source for "few reps with a heavy load"', () => {
    expect(PROGRAMS['strength-5x5'].refs).toContain('schoenfeld2021')
  })

  it('lists each reference once', () => {
    for (const p of Object.values(PROGRAMS)) expect(new Set(p.refs).size, p.id).toBe(p.refs.length)
  })
})

describe('slotToCfg', () => {
  it('stores a loaded range the way double progression reads it: reps is the top, repsMin the bottom', () => {
    expect(slotToCfg({ ex: '0025', sets: 3, reps: 8, repsMax: 12, restSec: 120 })).toEqual({ id: '0025', sets: 3, reps: 12, repsMin: 8, weight: 0, restSec: 120 })
  })

  it('stores a bodyweight range as reps climbing to the repsMax ceiling', () => {
    expect(slotToCfg({ ex: '0276', sets: 2, reps: 8, repsMax: 12, restSec: 90 })).toEqual({ id: '0276', sets: 2, reps: 8, repsMax: 12, weight: 0, restSec: 90 })
  })

  it('stores fixed reps as reps alone, with the slot policy when it has one', () => {
    expect(slotToCfg({ ex: '0043', sets: 4, reps: 5, restSec: 180, prog: 'linear' })).toEqual({ id: '0043', sets: 4, reps: 5, weight: 0, restSec: 180, prog: 'linear' })
  })

  it('gives unloaded equipment the rep-climbing shape progression uses (review M8)', () => {
    // a wheel roller and a stability ball carry no load of their own, so progression climbs reps
    expect(slotToCfg({ ex: '0796', sets: 3, reps: 8, repsMax: 12, restSec: 90 })).toEqual({ id: '0796', sets: 3, reps: 8, repsMax: 12, weight: 0, restSec: 90 })
    expect(slotToCfg({ ex: '1314', sets: 3, reps: 10, repsMax: 15, restSec: 90 })).toEqual({ id: '1314', sets: 3, reps: 10, repsMax: 15, weight: 0, restSec: 90 })
    expect(slotToCfg({ ex: '0968', sets: 2, reps: 12, repsMax: 15, restSec: 90 })).toEqual({ id: '0968', sets: 2, reps: 12, repsMax: 15, weight: 0, restSec: 90 })
  })

  it('judges bodyweight on the exercise actually used, an alternate included', () => {
    const slot: Slot = { ex: '2330', sets: 3, reps: 10, repsMax: 12, restSec: 120, alt: ['0499'] }
    expect(slotToCfg(slot, '0499')).toEqual({ id: '0499', sets: 3, reps: 10, repsMax: 12, weight: 0, restSec: 120 })
  })
})

describe('buildProgram', () => {
  it('without an equipment profile keeps every main exercise and misses nothing', () => {
    const { routines, week, missing } = buildProgram({ routines: [], week: {} }, 'full-body-beginner')
    expect(routines.map(r => r.ex.map(e => e.id))).toEqual(PROGRAMS['full-body-beginner'].routines.map(r => r.slots.map(s => s.ex)))
    expect(missing).toEqual([])
    expect(week).toEqual({ 1: [routines[0].id], 3: [routines[1].id], 5: [routines[2].id] })
  })

  it('with no barbell takes the first available alternate, and keeps a slot with none in missing (Review Focus 2)', () => {
    const S = noBarbell(['dumbbell', 'cable', 'leverage machine'])
    const { routines, missing } = buildProgram(S, 'full-body-beginner')
    const ids = routines.map(r => r.ex.map(e => e.id))
    expect(ids[0]).toEqual(['1760', '0289', '2330', '0586', '0334', '0294'])  // 0025 → 0289
    expect(ids[1]).toEqual(['1459', '0314', '1323', '0585', '0241', '0605'])
    expect(ids[2]).toEqual(['0739', '0426', '0293', '0336', '0313', '0175'])  // leg press: no alt
    expect(missing).toEqual(['0739'])
  })

  it('a bodyweight alternate gets the bodyweight range shape', () => {
    const { routines } = buildProgram(noBarbell(['dumbbell']), 'full-body-beginner')
    expect(routines[0].ex[2]).toEqual({ id: '0499', sets: 3, reps: 10, repsMax: 12, weight: 0, restSec: 120 })
  })

  it('lists each missing exercise once and keeps the main one in place', () => {
    const { routines, missing } = buildProgram(noBarbell([]), 'strength-5x5')
    expect(routines.map(r => r.ex.map(e => e.id))).toEqual([['0043', '0025', '0027'], ['0085', '0426', '2330'], ['0739', '0047', '1323']])
    expect(missing).toEqual(['0043', '0025', '0027', '0085', '0426', '2330', '0739', '0047', '1323'])
    const twice = buildProgram(noBarbell([]), 'upper-lower')  // 0047 and 2330 are in both upper days
    expect(twice.missing).toContain('0047')
    expect(new Set(twice.missing).size).toBe(twice.missing.length)
  })

  it('schedules the chosen variant', () => {
    const { routines, week } = buildProgram({ routines: [], week: {} }, 'ppl', 1)
    const [push, pull, legs] = routines.map(r => r.id)
    expect(week).toEqual({ 1: [push], 2: [pull], 3: [legs], 4: [push], 5: [pull], 6: [legs] })
  })
})

describe('programRoutines', () => {
  it('builds the ppl routines in push, pull, legs order, ignoring the equipment profile', () => {
    const rs = programRoutines('ppl')
    expect(rs.map(r => r.name)).toEqual(['PPL · Push', 'PPL · Pull', 'PPL · Legs'])
    expect(rs[0].ex.map(e => e.id)).toEqual(['0025', '0047', '0426', '0334', '0241', '0251'])
    expect(new Set(rs.map(r => r.id)).size).toBe(3)
  })
})

const before = (): PlanState => ({
  routines: [{ id: 'old', name: 'My Day', emoji: 'barbell', ex: [{ id: '0025', sets: 3, reps: 10, weight: 50 }] }],
  week: { 1: ['old'], 2: ['old'] },
  dayPlan: { '2026-10-14': 'old' },
  workouts: [],
})

describe('applyProgram', () => {
  it('adds the program routines, swaps the week, and leaves the rest alone', () => {
    const S = before()
    const old = structuredClone(S.routines[0])
    applyProgram(S, 'ppl')
    expect(S.routines).toHaveLength(4)
    expect(S.routines[0]).toEqual(old)
    const [push, pull, legs] = S.routines.slice(1) as ReturnType<typeof programRoutines>
    expect([push.name, pull.name, legs.name]).toEqual(['PPL · Push', 'PPL · Pull', 'PPL · Legs'])
    expect(push.prog).toBe('double')
    expect(push.emoji).toBeTruthy()
    expect(push.ex[0]).toEqual({ id: '0025', sets: 4, reps: 12, repsMin: 8, weight: 0, restSec: 120 })
    expect(push.ex[5]).toEqual({ id: '0251', sets: 3, reps: 10, repsMax: 12, weight: 0, restSec: 120 })
    for (const r of [push, pull, legs]) for (const e of r.ex) { expect(e.weight).toBe(0); expect(e.restSec).toBeGreaterThan(0) }
    expect(S.week).toEqual({ 1: [push.id], 3: [pull.id], 5: [legs.id] })
    expect(S.dayPlan).toEqual({ '2026-10-14': 'old' })
    expect(S.program).toMatchObject({ id: 'ppl', variant: 0, routineIds: [push.id, pull.id, legs.id], prevWeek: { 1: ['old'], 2: ['old'] }, dismissed: false })
    expect(typeof S.program?.appliedAt).toBe('number')
  })

  it('writes linear progression and fixed reps for 5×5, and the slot policy on PHUL strength lifts', () => {
    const S = before()
    applyProgram(S, 'strength-5x5')
    const a = S.routines[1] as ReturnType<typeof programRoutines>[number]
    expect(a.name).toBe('5×5 · A')
    expect(a.prog).toBe('linear')
    expect(a.ex[0]).toEqual({ id: '0043', sets: 5, reps: 5, weight: 0, restSec: 180 })

    const P = before()
    applyProgram(P, 'power-hypertrophy')
    const upper = P.routines[1] as ReturnType<typeof programRoutines>[number]
    expect(upper.name).toBe('PHUL · Upper Strength')
    expect(upper.prog).toBe('double')
    expect(upper.ex[0]).toEqual({ id: '0025', sets: 4, reps: 5, weight: 0, restSec: 180, prog: 'linear' })
    expect(upper.ex[4]).toEqual({ id: '0031', sets: 2, reps: 10, repsMin: 8, weight: 0, restSec: 90 })
  })

  it('applying the same program twice adds a second set with new ids', () => {
    const S = before()
    applyProgram(S, 'ppl')
    const first = S.program!.routineIds
    const firstWeek = structuredClone(S.week)
    applyProgram(S, 'ppl')
    expect(S.routines).toHaveLength(7)
    const second = S.program!.routineIds
    expect(second).toHaveLength(3)
    for (const id of second) expect(first).not.toContain(id)
    expect(new Set(S.routines.map(r => r.id)).size).toBe(7)
    expect(S.program!.prevWeek).toEqual(firstWeek)
  })

  it('does not share the previous week object with the saved copy', () => {
    const S = before()
    const week = S.week
    applyProgram(S, 'ppl')
    week[1] = ['changed']
    expect(S.program!.prevWeek).toEqual({ 1: ['old'], 2: ['old'] })
  })
})

describe('undoProgram', () => {
  it('restores the week, removes untrained routines and clears the program', () => {
    const S = before()
    applyProgram(S, 'ppl')
    expect(undoProgram(S)).toEqual({ kept: [] })
    expect(S.week).toEqual({ 1: ['old'], 2: ['old'] })
    expect(S.routines.map(r => r.id)).toEqual(['old'])
    expect(S.dayPlan).toEqual({ '2026-10-14': 'old' })
    expect(S.program).toBeUndefined()
  })

  it('keeps a routine that already has a workout, off the schedule (Review Focus 3)', () => {
    const S = before()
    applyProgram(S, 'ppl')
    const [push, pull] = S.program!.routineIds
    S.workouts = [{ id: 'w1', routineIds: [pull] }]
    const { kept } = undoProgram(S)
    expect(kept).toEqual([pull])
    expect(S.routines.map(r => r.id)).toEqual(['old', pull])
    expect(S.routines.map(r => r.id)).not.toContain(push)
    expect(S.week).toEqual({ 1: ['old'], 2: ['old'] })
    expect(S.program).toBeUndefined()
  })

  it('counts a legacy workout that names its routine only by routineId', () => {
    const S = before()
    applyProgram(S, 'ppl')
    const legs = S.program!.routineIds[2]
    S.workouts = [{ id: 'w1', routineId: legs }]
    expect(undoProgram(S).kept).toEqual([legs])
  })

  it('keeps a routine named by one of my check-ins, posted without a detail (final review m1)', () => {
    const S = before()
    applyProgram(S, 'ppl')
    const [push, pull, legs] = S.program!.routineIds
    // a photo check-in without a detail logs no workout, only its routine_id
    const { kept } = undoProgram(S, [pull, null, 'not-a-program-routine'])
    expect(kept).toEqual([pull])
    expect(S.routines.map(r => r.id)).toEqual(['old', pull])
    expect(S.routines.map(r => r.id)).not.toContain(push)
    expect(S.routines.map(r => r.id)).not.toContain(legs)
  })

  it('does nothing without an applied program', () => {
    const S = before()
    expect(undoProgram(S)).toEqual({ kept: [] })
    expect(S).toEqual(before())
  })

  it('drops a date rescheduled to a removed routine, through deleteRoutine (review M1)', () => {
    const S = before()
    applyProgram(S, 'ppl')
    const pull = S.program!.routineIds[1]
    S.dayPlan = { '2026-10-14': 'old', '2026-10-15': pull }
    undoProgram(S)
    expect(S.dayPlan).toEqual({ '2026-10-14': 'old' })
    expect(S.routines.map(r => r.id)).toEqual(['old'])
  })

  it('keeps a routine of the session in progress, like a trained one (review M1)', () => {
    const S = before()
    applyProgram(S, 'ppl')
    const [push, , legs] = S.program!.routineIds
    S.active = { routineIds: [legs], entries: [] }
    S.dayPlan = { '2026-10-15': legs }
    expect(undoProgram(S).kept).toEqual([legs])
    expect(S.routines.map(r => r.id)).toEqual(['old', legs])
    expect(S.routines.map(r => r.id)).not.toContain(push)
    expect(S.dayPlan).toEqual({ '2026-10-15': legs })
    expect(S.week).toEqual({ 1: ['old'], 2: ['old'] })
  })
})

describe('variant resolution (review M3)', () => {
  it('clamps an out-of-range variant and stores the one it applied', () => {
    const S = before()
    applyProgram(S, 'ppl', 9)
    expect(S.program!.variant).toBe(1)
    expect(Object.keys(S.week).map(Number)).toEqual([1, 2, 3, 4, 5, 6])

    const F = before()
    applyProgram(F, 'full-body-beginner', 3)
    expect(F.program!.variant).toBe(0)
    expect(Object.keys(F.week).map(Number)).toEqual([1, 3, 5])

    const N = before()
    applyProgram(N, 'ppl', -2)
    expect(N.program!.variant).toBe(0)
    expect(Object.keys(N.week).map(Number)).toEqual([1, 3, 5])
  })

  it('buildProgram schedules the clamped variant too', () => {
    const { week } = buildProgram({ routines: [], week: {} }, 'ppl', 7)
    expect(Object.keys(week)).toHaveLength(6)
  })
})

// Spec §10 and final review I1: the app's own catalog, analysed in each profile it is made for,
// must not contradict itself. Every alert left over is listed here with the reason it is accepted.
describe('each program analysed in its own profile (final review I1)', () => {
  // Every program has at most one abs slot, so 'low abs' and 'frequency abs' are expected. The
  // other lines are content questions for the human check (docs/fontes-1d.md, "Textos dos
  // programas"); the code does not change program content to silence them.
  const ACCEPTED: Record<string, string[]> = {
    // 1 set over the health top of 10: the same program is the beginner hypertrophy plan
    'full-body-beginner 3x health': ['low abs', 'high shoulders', 'high glutes'],
    // beginner volume (2 to 3 sets per exercise) sits under the hypertrophy minimum of 10; triceps
    // reach 2 sets on day B only
    'full-body-beginner 3x hypertrophy': ['low chest', 'low back', 'low biceps', 'low triceps', 'low quads',
      'low hamstrings', 'low calves', 'low abs', 'frequency triceps', 'frequency abs'],
    // 8 direct chest sets and 9 arm sets: 1 to 2 under the minimum
    'upper-lower 4x hypertrophy': ['low chest', 'low biceps', 'low triceps', 'low abs', 'frequency abs'],
    // 3 days: every group once a week by design (the detail says so); triceps, hamstrings and
    // calves half a set to 1 set under the minimum
    'ppl 3x hypertrophy': ['low triceps', 'low hamstrings', 'low calves', 'low abs', 'frequency chest',
      'frequency back', 'frequency biceps', 'frequency triceps', 'frequency quads', 'frequency hamstrings',
      'frequency glutes', 'frequency calves', 'frequency abs'],
    // 6 days doubles the 3-day volume; rows and pulldowns add biceps and rear delts on top
    'ppl 6x hypertrophy': ['low abs', 'high back', 'high shoulders', 'high biceps'],
    // three lifts at 5×5: back, shoulders and glutes 15 over the strength top of 12; no calf work
    'strength-5x5 3x strength': ['low calves', 'low abs', 'high back', 'high shoulders', 'high glutes'],
    // the strength range (6 to 12) reads PHUL's two hypertrophy days as extra volume
    'power-hypertrophy 4x strength': ['low abs', 'high back', 'high shoulders', 'high quads', 'high hamstrings',
      'high glutes', 'high calves'],
    // 7 chest sets: bench and incline only
    'power-hypertrophy 4x hypertrophy': ['low chest', 'low abs', 'frequency abs'],
    // 2 short days: no direct arm, calf or abs work by design; chest from one press
    'short-2x 2x health': ['low chest', 'low biceps', 'low triceps', 'low calves', 'low abs'],
    // no direct arm work by design: biceps and triceps 3, 1 under the health minimum of 4
    'health-3x 3x health': ['low biceps', 'low triceps'],
  }
  const cases = (Object.keys(PROGRAMS) as ProgramId[]).flatMap(id =>
    PROGRAMS[id].variants.flatMap((v, variant) =>
      PROGRAMS[id].goals.map(profile => ({ id, variant, days: v.days, profile }))))
  const label = (a: Alert) => [a.kind, a.group].filter(Boolean).join(' ')

  it.each(cases)('$id $days× in $profile: no balance or missing alert, the rest accepted', ({ id, variant, days, profile }) => {
    const { routines, week } = buildProgram({}, id, variant)
    const alerts = analyzePlan({ routines, week }, profile).alerts.map(label)
    expect(alerts.filter(a => a.startsWith('balance'))).toEqual([])
    expect(alerts.filter(a => a.startsWith('missing'))).toEqual([])
    expect(alerts).toEqual(ACCEPTED[`${id} ${days}x ${profile}`] ?? [])
  })

  it.each(cases)('$id $days× in $profile: no suggestion lowers an exercise of another main group', ({ id, variant, profile }) => {
    const { routines, week } = buildProgram({}, id, variant)
    const S = { routines, week, customEx: [] }
    for (const s of suggestionsFor(S, profile)) {
      if (s.kind !== 'remove-sets') continue
      for (const c of s.changes) expect(exerciseMainGroup(S, c.exId), `${s.group}: ${c.exId}`).toBe(s.group)
    }
  })

  it('PPL 6× biceps: Apply lowers only the curls, never the presses, pulldowns or rows', () => {
    const { routines, week } = buildProgram({}, 'ppl', 1)
    const S = { routines, week, customEx: [] }
    const biceps = suggestionsFor(S, 'hypertrophy').filter(s => s.group === 'biceps')
    for (const s of biceps) for (const c of s.changes) expect(['0031', '0313']).toContain(c.exId)
  })

  it('5×5 glutes: Apply never lowers the squat', () => {
    const { routines, week } = buildProgram({}, 'strength-5x5')
    const S = { routines, week, customEx: [] }
    const glutes = suggestionsFor(S, 'strength').filter(s => s.group === 'glutes')
    for (const s of glutes) for (const c of s.changes) expect(c.exId).not.toBe('0043')
  })
})
