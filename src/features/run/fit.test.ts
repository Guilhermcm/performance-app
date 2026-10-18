import { describe, expect, it } from 'vitest'
import { EXIDX } from '../../lib/exercises.js'
import { fitWeek, legDays, moveWarnings, type FitWarning } from './fit'

// Custom exercises (ids outside the catalogue) fall back to their body part, so `bp` decides the
// muscles: 'upper legs' is quadriceps/hamstring/gluteal, 'chest' and 'back' are not.
type Ex = { id: string; sets: number; bp: string }
const ex = (id: string, sets: number, bp: string): Ex => ({ id, sets, bp })
const routine = (id: string, exs: Ex[]) => ({ id, ex: exs })

const LEG = routine('leg', [ex('x-squat', 6, 'upper legs'), ex('x-curl', 4, 'upper legs'), ex('x-row', 2, 'back')]) // 10 of 12
const UPPER = routine('upper', [ex('x-bench', 5, 'chest'), ex('x-row', 5, 'back')])
const FULL = routine('full', [ex('x-squat', 5, 'upper legs'), ex('x-bench', 5, 'chest')]) // exactly half
const SIXTY = routine('sixty', [ex('x-squat', 6, 'upper legs'), ex('x-bench', 4, 'chest')])
const routines = [LEG, UPPER, FULL, SIXTY]

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 0
const sessions = [
  { id: 'w1-s1', type: 'long' as const },
  { id: 'w1-s2', type: 'intervals' as const },
  { id: 'w1-s3', type: 'easy' as const },
]
const next = (d: number) => (d + 1) % 7

describe('legDays', () => {
  it('marks a routine with 60% of the sets on legs and not one with 50%', () => {
    expect([...legDays({ [MON]: ['sixty'], [WED]: ['full'], [FRI]: ['upper'] }, routines)]).toEqual([MON])
  })
  it('sums the sets of two routines on the same day', () => {
    // upper (10) + sixty (6 legs of 10) = 6 of 20: not a leg day; full (5 of 10) + leg (10 of 12) = 15 of 22
    expect(legDays({ [MON]: ['upper', 'sixty'] }, routines).size).toBe(0)
    expect([...legDays({ [TUE]: ['full', 'leg'] }, routines)]).toEqual([TUE]) // 15 of 22
  })
  it('reads the muscles of catalogue exercises by id', () => {
    const catalogue = Object.values(EXIDX) as { id: string; bp?: string }[]
    const quad = catalogue.find(e => e.bp === 'upper legs')!
    const chest = catalogue.find(e => e.bp === 'chest')!
    const week = { [MON]: ['legs'], [TUE]: ['push'] }
    const set = [routine('legs', [{ id: quad.id, sets: 5, bp: '' }]), routine('push', [{ id: chest.id, sets: 5, bp: '' }])]
    expect([...legDays(week, set)]).toEqual([MON])
  })
  it('ignores unknown routines, empty days and routines without sets', () => {
    expect(legDays({ [MON]: ['gone'], [TUE]: [], [WED]: ['empty'] }, [routine('empty', [])]).size).toBe(0)
  })
})

describe('fitWeek', () => {
  const week = { [MON]: ['leg'], [WED]: ['upper'], [FRI]: ['upper'] }

  it('puts the long run on the preferred day and keeps hard days apart', () => {
    const { placement, warnings } = fitWeek(sessions, { week, routines, longDay: SUN })
    expect(placement['w1-s1']).toBe(SUN)
    expect(placement['w1-s2']).not.toBe(TUE)
    const quality = placement['w1-s2']
    const leg = legDays(week, routines)
    expect(leg.has(quality)).toBe(false)
    expect([...leg].some(d => next(d) === quality || next(quality) === d)).toBe(false)
    expect([FRI, WED, MON].includes(placement['w1-s3'])).toBe(false) // the easy run takes a free day
    expect(new Set(Object.values(placement)).size).toBe(3)
    expect(warnings).toEqual({ 'w1-s1': [], 'w1-s2': [], 'w1-s3': [] })
  })

  it('fits every session when six days have strength, and warns about hard runs on them', () => {
    const full = { [SUN]: ['upper'], [MON]: ['leg'], [TUE]: ['upper'], [WED]: ['upper'], [THU]: ['sixty'], [FRI]: ['upper'] }
    const three = [
      { id: 'a', type: 'long' as const },
      { id: 'b', type: 'intervals' as const },
      { id: 'c', type: 'easy' as const },
    ]
    const { placement, warnings } = fitWeek(three, { week: full, routines, longDay: SAT })
    expect(Object.keys(placement).sort()).toEqual(['a', 'b', 'c'])
    expect(placement.a).toBe(SAT)
    expect(new Set(Object.values(placement)).size).toBe(3)
    // the only free day is Saturday, taken by the long run, so the interval session shares a
    // strength day and says so
    expect(warnings.b).toContain('shared_with_strength_hard')
    expect(warnings.c).toEqual([])
  })

  it('shares a strength day with a quality run when no free day is left, never dropping it', () => {
    const full = { [SUN]: ['upper'], [MON]: ['upper'], [TUE]: ['upper'], [WED]: ['upper'], [THU]: ['upper'], [FRI]: ['upper'] }
    const three = [
      { id: 'a', type: 'long' as const },
      { id: 'b', type: 'tempo' as const },
      { id: 'c', type: 'intervals' as const },
    ]
    const { placement, warnings } = fitWeek(three, { week: full, routines, longDay: SAT })
    expect(Object.keys(placement)).toHaveLength(3)
    expect(warnings.b).toContain('shared_with_strength_hard')
    expect(warnings.c).toContain('shared_with_strength_hard')
  })

  it('never places before today when allowedDays is given', () => {
    // current week from Thursday, Monday-start: Thu Fri Sat Sun
    for (const allowedDays of [[THU, FRI, SAT, SUN], [SUN, THU, SAT, FRI], [THU, FRI, SAT]]) {
      const { placement } = fitWeek(sessions, { week, routines, longDay: SUN, allowedDays })
      for (const d of Object.values(placement)) expect(allowedDays).toContain(d)
    }
  })

  it('puts the long run on the nearest allowed day when the preferred one has passed', () => {
    const { placement } = fitWeek([{ id: 'a', type: 'long' }], { week: {}, routines, longDay: TUE, allowedDays: [THU, FRI, SAT] })
    expect(placement.a).toBe(THU)
  })

  it('does not depend on the week start: same weekdays whatever order the days arrive in', () => {
    const mondayFirst = { [MON]: ['leg'], [WED]: ['upper'], [FRI]: ['upper'] }
    const sundayFirst = { [FRI]: ['upper'], [WED]: ['upper'], [MON]: ['leg'] }
    const a = fitWeek(sessions, { week: mondayFirst, routines, longDay: SUN, allowedDays: [1, 2, 3, 4, 5, 6, 0] })
    const b = fitWeek(sessions, { week: sundayFirst, routines, longDay: SUN, allowedDays: [0, 1, 2, 3, 4, 5, 6] })
    expect(a).toEqual(b)
  })

  it('is deterministic', () => {
    const ctx = { week, routines, longDay: SUN }
    expect(fitWeek(sessions, ctx)).toEqual(fitWeek(sessions, ctx))
  })

  it('keeps the quality run off the day after a leg day when it can', () => {
    for (const legDay of [SUN, MON, TUE, WED, THU, FRI, SAT]) {
      const { placement } = fitWeek(
        [{ id: 'a', type: 'long' }, { id: 'b', type: 'tempo' }],
        { week: { [legDay]: ['leg'] }, routines, longDay: SUN },
      )
      expect(placement.b).not.toBe(next(legDay))
    }
  })
})

describe('moveWarnings', () => {
  const week = { [MON]: ['leg'], [WED]: ['upper'], [FRI]: ['upper'] }
  const ctx = { week, routines, longDay: SUN }
  const placement = { 'w1-s1': SUN, 'w1-s2': THU, 'w1-s3': SAT }

  it('warns about a quality run the day after leg', () => {
    expect(moveWarnings('w1-s2', TUE, placement, sessions, ctx)).toEqual(['after_leg_day'] satisfies FitWarning[])
  })
  it('returns nothing for a free day away from hard days', () => {
    expect(moveWarnings('w1-s2', THU, placement, sessions, ctx)).toEqual([])
  })
  it('warns about two hard days in a row', () => {
    expect(moveWarnings('w1-s2', SUN, { ...placement, 'w1-s1': SAT, 'w1-s3': THU }, [
      { id: 'w1-s1', type: 'tempo' }, sessions[1], sessions[2],
    ], ctx)).toEqual(['hard_in_a_row'])
  })
  it('warns when a quality run shares a day with strength', () => {
    expect(moveWarnings('w1-s2', WED, placement, sessions, ctx)).toEqual(['shared_with_strength_hard'])
  })
  it('never warns about an easy run', () => {
    expect(moveWarnings('w1-s3', TUE, placement, sessions, ctx)).toEqual([])
    expect(moveWarnings('w1-s3', WED, placement, sessions, ctx)).toEqual([])
  })
})
