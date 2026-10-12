import { describe, expect, it } from 'vitest'
import { EXIDX, isAssisted } from '@/lib/exercises.js'
import { musclesOf } from '@/lib/muscles.js'
import { analyzePlan, GROUP_OF, type Alert, type Group } from './analysis'
import { applySuggestion, DEFAULT_EXERCISES, restoreRoutines, suggestionsFor, type Suggestion } from './suggestions'

type Ex = { id: string; sets: number; reps?: number; restSec?: number }
type R = { id: string; name: string; emoji?: string; prog?: string; ex: Ex[] }

const routine = (id: string, ex: Ex[]): R => ({ id, name: id, ex })
const state = (week: Record<number, string[]>, routines: R[], extra: Record<string, unknown> = {}) =>
  ({ week, routines, customEx: [] as object[], ...extra })
const for_ = (list: Suggestion[], group: Group) => list.filter(s => s.group === group)
const only = (list: Suggestion[], group: Group) => {
  const found = for_(list, group)
  expect(found).toHaveLength(1)
  return found[0]
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

// a custom exercise that trains one group as its primary muscle
const customFor = (id: string, primary: string) => ({ id, n: id, custom: true, bp: 'back', primaries: [primary], secondaries: [] })

describe('DEFAULT_EXERCISES', () => {
  it('is the curated list of spec 5.7, in order', () => {
    expect(DEFAULT_EXERCISES).toEqual({
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
    })
  })

  it('has only catalog exercises that train their group as the main muscle, none assisted', () => {
    for (const [group, ids] of Object.entries(DEFAULT_EXERCISES)) {
      for (const id of ids) {
        const ex = (EXIDX as Record<string, object | undefined>)[id]
        expect(ex, id).toBeDefined()
        expect(isAssisted(ex), id).toBe(false)
        const main = Object.entries(musclesOf(ex) as Record<string, number>)
          .filter(([slug, w]) => w === 1 && (GROUP_OF as Record<string, string | undefined>)[slug] === group)
        expect(main.length, `${id} for ${group}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('low group with a main exercise: add-sets', () => {
  const chest6 = () => state({ 1: ['push'] }, [routine('push', [{ id: '0025', sets: 3 }, { id: '1278', sets: 3 }])])

  it('adds up to 2 sets per exercise until the minimum (chest 6 → 10 in hypertrophy)', () => {
    const s = only(suggestionsFor(chest6(), 'hypertrophy'), 'chest')
    expect(s.kind).toBe('add-sets')
    expect(s.changes).toEqual([
      { routineId: 'push', exId: '0025', from: 3, to: 5 },
      { routineId: 'push', exId: '1278', from: 3, to: 5 },
    ])
  })

  it('stops as soon as the minimum is reached', () => {
    const S = state({ 1: ['push'] }, [routine('push', [{ id: '0025', sets: 4 }, { id: '1278', sets: 4 }])])
    const s = only(suggestionsFor(S, 'hypertrophy'), 'chest')
    expect(s.changes).toEqual([{ routineId: 'push', exId: '0025', from: 4, to: 6 }])
  })

  it('counts a routine scheduled twice: one added set is worth two in the week', () => {
    const S = state({ 1: ['push'], 4: ['push'] }, [routine('push', [{ id: '0025', sets: 3 }])])
    const s = only(suggestionsFor(S, 'hypertrophy'), 'chest')
    // 6 weekly sets now, 4 short of 10: +2 per session is exactly +4 a week
    expect(s.changes).toEqual([{ routineId: 'push', exId: '0025', from: 3, to: 5 }])
  })

  it('works on the exercises whose main muscle is the group, not on secondary ones', () => {
    // the overhead press trains the chest only as a secondary muscle
    const S = state({ 1: ['a'] }, [routine('a', [{ id: '0426', sets: 4 }, { id: '0025', sets: 3 }])])
    const s = only(suggestionsFor(S, 'hypertrophy'), 'chest')
    expect(s.changes.map(c => c.exId)).toEqual(['0025'])
  })

  it('uses the profile range (strength minimum is 6)', () => {
    const S = state({ 1: ['push'] }, [routine('push', [{ id: '0025', sets: 3 }])])
    const s = only(suggestionsFor(S, 'strength'), 'chest')
    expect(s.changes).toEqual([{ routineId: 'push', exId: '0025', from: 3, to: 5 }])
  })
})

describe('low group with no main exercise: add-exercise', () => {
  const push = () => state({ 1: ['push'] }, [routine('push', [{ id: '0025', sets: 5 }, { id: '0426', sets: 5 }])])

  it('turns into adding the default exercise (biceps only as a secondary muscle)', () => {
    const s = only(suggestionsFor(push(), 'hypertrophy'), 'biceps')
    expect(s.kind).toBe('add-exercise')
    expect(s.changes).toEqual([{ routineId: 'push', exId: '0031', from: null, to: 3 }])
  })

  it('does not treat a custom exercise without muscles as a main exercise', () => {
    const S = state({ 1: ['push'] }, [routine('push', [{ id: 'c-x', sets: 6 }, { id: '0025', sets: 5 }])],
      { customEx: [{ id: 'c-x', n: 'Mystery', custom: true, bp: 'upper arms' }] })
    const s = only(suggestionsFor(S, 'hypertrophy'), 'triceps')
    expect(s.kind).toBe('add-exercise')
  })
})

describe('missing group: add-exercise in the routine of the same half', () => {
  const planWith = (routines: R[], week: Record<number, string[]>, extra: Record<string, unknown> = {}) => state(week, routines, extra)
  const upper = routine('upper', [{ id: '0025', sets: 10 }, { id: '2330', sets: 10 }])

  it('adds 0586 (3 sets) to the lower-body routine for a missing hamstring group', () => {
    const lower = routine('lower', [{ id: '0605', sets: 3 }])
    const list = suggestionsFor(planWith([upper, lower], { 1: ['upper'], 3: ['lower'] }), 'hypertrophy')
    const s = only(list, 'hamstrings')
    expect(s.kind).toBe('add-exercise')
    expect(s.changes).toEqual([{ routineId: 'lower', exId: '0586', from: null, to: 3 }])
  })

  it('puts an upper-body group in the upper-body routine', () => {
    const lower = routine('lower', [{ id: '0739', sets: 12 }, { id: '0605', sets: 6 }])
    const list = suggestionsFor(planWith([lower, routine('arms', [{ id: '0031', sets: 3 }])], { 1: ['lower'], 3: ['arms'] }), 'hypertrophy')
    const s = only(list, 'chest')
    expect(s.changes).toEqual([{ routineId: 'arms', exId: '0025', from: null, to: 3 }])
  })

  it('breaks a tie with the routine of the smaller estimated time', () => {
    const long = routine('l-long', [{ id: '0605', sets: 3, restSec: 180 }])
    const short = routine('l-short', [{ id: '0605', sets: 3, restSec: 60 }])
    const list = suggestionsFor(planWith([upper, long, short], { 1: ['upper'], 2: ['l-long'], 3: ['l-short'] }), 'hypertrophy')
    expect(only(list, 'hamstrings').changes[0].routineId).toBe('l-short')
  })

  it('only looks at routines that are in the week', () => {
    const lower = routine('lower', [{ id: '0605', sets: 3 }])
    const unscheduled = routine('spare', [{ id: '0605', sets: 12 }])
    const list = suggestionsFor(planWith([upper, lower, unscheduled], { 1: ['upper'], 3: ['lower'] }), 'hypertrophy')
    expect(only(list, 'hamstrings').changes[0].routineId).toBe('lower')
  })

  it('skips equipment that is not there and takes the next of the list (1459)', () => {
    const lower = routine('lower', [{ id: '0605', sets: 3 }])
    const S = planWith([upper, lower], { 1: ['upper'], 3: ['lower'] }, {
      equipFilterOn: true,
      activeEquipId: 'home',
      equipProfiles: [{ id: 'home', name: 'Home', equipment: ['dumbbell', 'cable', 'barbell', 'sled machine'] }],
    })
    const s = only(suggestionsFor(S, 'hypertrophy'), 'hamstrings')
    expect(s.changes).toEqual([{ routineId: 'lower', exId: '1459', from: null, to: 3 }])
  })

  it('makes no suggestion when nothing of the list fits the equipment', () => {
    const S = planWith([upper], { 1: ['upper'] }, {
      equipFilterOn: true,
      activeEquipId: 'bare',
      equipProfiles: [{ id: 'bare', name: 'Bare', equipment: ['body weight'] }],
    })
    expect(for_(suggestionsFor(S, 'hypertrophy'), 'hamstrings')).toEqual([])
  })
})

describe('high group: remove-sets', () => {
  // strength: triceps range tops at 12 weekly sets
  const heavy = () => state({ 1: ['a'] }, [routine('a', [
    { id: '0025', sets: 3 }, // triceps as a secondary muscle: 1.5
    { id: '0426', sets: 2 }, // secondary too, but already at the 2-set floor: 1
    { id: '0241', sets: 12 }, // main: 12
  ])])

  it('lowers only the exercises whose main group is the alert group (final review I1)', () => {
    const a = analyzePlan(heavy(), 'strength')
    // bench and overhead press add 1.5 and 1 through the triceps their sm names
    expect(a.groups.triceps.sets).toBe(14.5)
    const s = only(suggestionsFor(heavy(), 'strength'), 'triceps')
    expect(s.kind).toBe('remove-sets')
    expect(s.changes).toEqual([{ routineId: 'a', exId: '0241', from: 12, to: 9 }])
  })

  it('stops once the group is back at the maximum', () => {
    const S = state({ 1: ['a'] }, [routine('a', [{ id: '0025', sets: 6 }, { id: '0241', sets: 10 }])])
    // triceps: 3 + 10 = 13, one over the strength maximum of 12
    const s = only(suggestionsFor(S, 'strength'), 'triceps')
    expect(s.changes).toEqual([{ routineId: 'a', exId: '0241', from: 10, to: 9 }])
  })

  it('makes no remove-sets when only exercises of another main group carry the excess', () => {
    // 26 bench sets give triceps 13, over 12, but the bench exists for the chest
    const S = state({ 1: ['a'] }, [routine('a', [{ id: '0025', sets: 13 }, { id: '0047', sets: 13 }])])
    const a = analyzePlan(S, 'strength')
    expect(a.groups.triceps.status).toBe('high')
    const list = suggestionsFor(S, 'strength')
    expect(for_(list, 'triceps')).toEqual([])
    // the chest alert still lowers the chest exercises
    expect(only(list, 'chest').kind).toBe('remove-sets')
  })

  it('never lowers an exercise when another group it trains would drop below the minimum (review M4)', () => {
    // strength: glutes 14 (over 12), hamstrings exactly at the minimum of 6
    const S = state({ 1: ['a'] }, [routine('a', [{ id: 'c-hinge', sets: 6 }, { id: 'c-glute', sets: 8 }])], {
      customEx: [
        { id: 'c-hinge', n: 'Hinge', custom: true, bp: 'upper legs', primaries: ['gluteal', 'hamstring'], secondaries: [] },
        customFor('c-glute', 'gluteal'),
      ],
    })
    const a = analyzePlan(S, 'strength')
    expect(a.groups.glutes.sets).toBe(14)
    expect(a.groups.hamstrings.sets).toBe(6)
    const s = only(suggestionsFor(S, 'strength'), 'glutes')
    expect(s.changes).toEqual([{ routineId: 'a', exId: 'c-glute', from: 8, to: 6 }])
  })

  it('makes no suggestion when every exercise of the group would take another below the minimum', () => {
    // strength: glutes 14 (over 12); the hinge also gives the hamstrings their 6 sets, the minimum,
    // and the glute exercise is already at the 2-set floor
    const S = state({ 1: ['a'] }, [routine('a', [{ id: 'c-hinge', sets: 12 }, { id: 'c-glute', sets: 2 }])], {
      customEx: [
        { id: 'c-hinge', n: 'Hinge', custom: true, bp: 'upper legs', primaries: ['gluteal'], secondaries: ['hamstring'] },
        customFor('c-glute', 'gluteal'),
      ],
    })
    const a = analyzePlan(S, 'strength')
    expect(a.groups.glutes.sets).toBe(14)
    expect(a.groups.hamstrings.sets).toBe(6)
    expect(for_(suggestionsFor(S, 'strength'), 'glutes')).toEqual([])
  })

  it('takes only the sets the other groups can spare', () => {
    // same plan with hamstrings at 7: the hinge can give 2 sets (hamstrings 6), not the 2 the glutes ask
    // plus more, so it stops at the glutes maximum
    const S = state({ 1: ['a'] }, [routine('a', [{ id: 'c-hinge', sets: 14 }])], {
      customEx: [{ id: 'c-hinge', n: 'Hinge', custom: true, bp: 'upper legs', primaries: ['gluteal'], secondaries: ['hamstring'] }],
    })
    // glutes 14 → 12 needs 2 sets; hamstrings 7 → 6 allows 2 sets
    expect(only(suggestionsFor(S, 'strength'), 'glutes').changes).toEqual([{ routineId: 'a', exId: 'c-hinge', from: 14, to: 12 }])
    const tight = clone(S)
    tight.routines[0].ex.push({ id: 'c-glute', sets: 4 })
    tight.customEx.push(customFor('c-glute', 'gluteal'))
    // glutes 18 needs 6 sets off; the hinge can spare 2 (hamstrings 7 → 6), the glute exercise 2 (floor)
    expect(only(suggestionsFor(tight, 'strength'), 'glutes').changes).toEqual([
      { routineId: 'a', exId: 'c-hinge', from: 14, to: 12 },
      { routineId: 'a', exId: 'c-glute', from: 4, to: 2 },
    ])
  })

  it('leaves no exercise with fewer than 2 sets', () => {
    const list = suggestionsFor(heavy(), 'strength')
    for (const s of list) for (const c of s.changes) if (s.kind === 'remove-sets') expect(c.to).toBeGreaterThanOrEqual(2)
  })

  it('makes no suggestion when every exercise is already at the 2-set floor', () => {
    // 2 sets on 7 days is 14 weekly triceps sets, over the strength maximum, with nothing to take
    const S = state({ 0: ['a'], 1: ['a'], 2: ['a'], 3: ['a'], 4: ['a'], 5: ['a'], 6: ['a'] }, [routine('a', [{ id: '0241', sets: 2 }])])
    expect(analyzePlan(S, 'strength').groups.triceps.status).toBe('high')
    expect(for_(suggestionsFor(S, 'strength'), 'triceps')).toEqual([])
  })
})

describe('applySuggestion and restoreRoutines', () => {
  const base = () => state({ 1: ['push'], 3: ['lower'] }, [
    routine('push', [{ id: '0025', sets: 3 }, { id: '1278', sets: 3 }]),
    routine('lower', [{ id: '0605', sets: 3 }]),
    routine('other', [{ id: '0031', sets: 3 }]),
  ])

  it('add-sets changes the sets and returns the routines as they were', () => {
    const S = base()
    const before = clone(S.routines)
    const s = only(suggestionsFor(S, 'hypertrophy'), 'chest')
    const snapshot = applySuggestion(S, s)
    expect(S.routines[0].ex.map(e => e.sets)).toEqual([5, 5])
    expect(snapshot).toEqual([before[0]])
    // the other routines are untouched
    expect(S.routines[1]).toEqual(before[1])
    restoreRoutines(S, snapshot)
    expect(S.routines).toEqual(before)
  })

  it('add-exercise appends the exercise with the profile range, 3 sets and the isolation rest', () => {
    const S = base()
    const before = clone(S.routines)
    const s = only(suggestionsFor(S, 'hypertrophy'), 'hamstrings')
    const snapshot = applySuggestion(S, s)
    expect(S.routines[1].ex[1]).toEqual({ id: '0586', sets: 3, reps: 12, repsMin: 8, weight: 0, restSec: 90 })
    restoreRoutines(S, snapshot)
    expect(S.routines).toEqual(before)
  })

  it('add-exercise uses 4 to 6 reps for strength and 120 s rest for a compound', () => {
    const S = state({ 1: ['lower'] }, [routine('lower', [{ id: '0605', sets: 6 }])])
    const s = only(suggestionsFor(S, 'strength'), 'chest')
    // no upper-body routine, so the only routine of the week takes it
    applySuggestion(S, s)
    expect(S.routines[0].ex[1]).toEqual({ id: '0025', sets: 3, reps: 6, repsMin: 4, weight: 0, restSec: 120 })
  })

  it('add-exercise with health uses 8 to 12', () => {
    const S = state({ 1: ['lower'] }, [routine('lower', [{ id: '0605', sets: 6 }])])
    const s = only(suggestionsFor(S, 'health'), 'chest')
    applySuggestion(S, s)
    expect(S.routines[0].ex[1]).toMatchObject({ id: '0025', reps: 12, repsMin: 8 })
  })

  it('remove-sets lowers the sets and restores them', () => {
    const S = state({ 1: ['a'] }, [routine('a', [{ id: '0025', sets: 3 }, { id: '0426', sets: 2 }, { id: '0241', sets: 12 }])])
    const before = clone(S.routines)
    const s = only(suggestionsFor(S, 'strength'), 'triceps')
    const snapshot = applySuggestion(S, s)
    expect(S.routines[0].ex.map(e => e.sets)).toEqual([3, 2, 9])
    restoreRoutines(S, snapshot)
    expect(S.routines).toEqual(before)
  })

  it('restore does not bring back a routine deleted since the snapshot', () => {
    const S = base()
    const s = only(suggestionsFor(S, 'hypertrophy'), 'chest')
    const snapshot = applySuggestion(S, s)
    S.routines = S.routines.filter(r => r.id !== 'push')
    restoreRoutines(S, snapshot)
    expect(S.routines.map(r => r.id)).toEqual(['lower', 'other'])
  })

  it('does not alias the snapshot to the live routines', () => {
    const S = base()
    const s = only(suggestionsFor(S, 'hypertrophy'), 'chest')
    const snapshot = applySuggestion(S, s)
    restoreRoutines(S, snapshot)
    S.routines[0].ex[0].sets = 99
    expect(snapshot[0].ex[0].sets).toBe(3)
  })
})

describe('alerts without a suggestion', () => {
  // every group sits inside the range, but the plan is long, lopsided and repeats exercises
  const GROUP_PRIMARY: [Group, string, number][] = [
    ['chest', 'chest', 5], ['shoulders', 'deltoids', 4], ['triceps', 'triceps', 4],
    ['back', 'upper-back', 4], ['biceps', 'biceps', 4],
    ['quads', 'quadriceps', 6], ['hamstrings', 'hamstring', 4],
    ['glutes', 'gluteal', 4], ['calves', 'calves', 4], ['abs', 'abs', 4],
  ]
  const S = state({ 1: ['all'], 3: ['all'], 5: ['all'] },
    [routine('all', GROUP_PRIMARY.map(([g, , sets]) => ({ id: `c-${g}`, sets })))],
    { customEx: GROUP_PRIMARY.map(([g, muscle]) => customFor(`c-${g}`, muscle)) })

  it('has the long, repeated and balance alerts and no others', () => {
    const kinds = new Set(analyzePlan(S, 'hypertrophy').alerts.map((a: Alert) => a.kind))
    expect(kinds.has('long')).toBe(true)
    expect(kinds.has('repeated')).toBe(true)
    expect(kinds.has('balance-push-pull')).toBe(true)
    for (const k of ['missing', 'low', 'high', 'frequency'] as const) expect(kinds.has(k), k).toBe(false)
  })

  it('gives no suggestion for them', () => {
    expect(suggestionsFor(S, 'hypertrophy')).toEqual([])
  })

  it('gives none for an empty plan either', () => {
    expect(suggestionsFor(state({}, []), 'hypertrophy')).toEqual([])
  })
})

describe('Suggestion type (review M1)', () => {
  it('an added exercise always carries its profile', () => {
    // @ts-expect-error add-exercise needs the profile its rep range comes from
    const bad: Suggestion = { kind: 'add-exercise', group: 'chest', changes: [] }
    const ok: Suggestion = { kind: 'add-sets', group: 'chest', changes: [] }
    expect([bad.kind, ok.kind]).toEqual(['add-exercise', 'add-sets'])
  })
})
