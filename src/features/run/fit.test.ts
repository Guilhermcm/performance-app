import { describe, expect, it } from 'vitest'
import { EXIDX } from '../../lib/exercises.js'
import { fitWeek, legDays, moveWarnings, weekWarnings, type FitWarning } from './fit'

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

  it('depends only on weekdays (0 = Sunday), not on the order the days arrive in', () => {
    // The same strength week and allowed days listed the way a Monday-start and a Sunday-start
    // screen would walk them, and with the sessions' week keys inserted in different orders.
    const monday = { [MON]: ['leg'], [WED]: ['upper'], [FRI]: ['upper'] }
    const reversed = Object.fromEntries(Object.entries(monday).reverse())
    const a = fitWeek(sessions, { week: monday, routines, longDay: SUN, allowedDays: [1, 2, 3, 4, 5, 6, 0] })
    const b = fitWeek(sessions, { week: reversed, routines, longDay: SUN, allowedDays: [0, 1, 2, 3, 4, 5, 6] })
    const c = fitWeek(sessions, { week: reversed, routines, longDay: SUN, allowedDays: [6, 5, 4, 3, 2, 1, 0, 3] })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    // and it is the same as leaving allowedDays out
    expect(fitWeek(sessions, { week: monday, routines, longDay: SUN })).toEqual(a)
  })

  it('treats only an omitted allowedDays as any day; an empty list throws', () => {
    expect(() => fitWeek(sessions, { week, routines, longDay: SUN, allowedDays: [] })).toThrow(Error)
    expect(() => fitWeek(sessions, { week, routines, longDay: SUN, allowedDays: [9, -1] })).toThrow(Error)
    expect(Object.keys(fitWeek(sessions, { week, routines, longDay: SUN }).placement)).toHaveLength(3)
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

describe('weekWarnings', () => {
  const week = { [MON]: ['leg'], [WED]: ['upper'], [FRI]: ['upper'] }
  const run = (id: string, type: 'long' | 'tempo' | 'intervals' | 'easy', day: number) => ({ id, type, day })

  it('is empty for a week that follows the rules', () => {
    expect(weekWarnings([run('a', 'long', SUN), run('b', 'intervals', THU), run('c', 'easy', SAT)], week, routines))
      .toEqual({ a: [], b: [], c: [] })
  })
  it('reports the other session too when a move creates two hard days in a row', () => {
    const before = [run('a', 'long', SUN), run('b', 'intervals', THU), run('t', 'tempo', SAT)]
    // the tempo moves to Wednesday, the day before the intervals run on Thursday
    const moved = before.map(s => (s.id === 't' ? { ...s, day: WED } : s))
    const warnings = weekWarnings(moved, week, routines)
    expect(warnings.b).toEqual(['hard_in_a_row'])
    expect(warnings.t).toEqual(expect.arrayContaining(['hard_in_a_row', 'shared_with_strength_hard']))
    // moveWarnings alone only knows about the moved session
    const placement = Object.fromEntries(before.map(s => [s.id, s.day]))
    expect(moveWarnings('t', WED, placement, before, { week, routines })).toEqual(warnings.t)
  })
})

describe('race day (final review I1 and M6)', () => {
  const quality = [{ id: 'w9-s1', type: 'long' as const }, { id: 'w9-s2', type: 'tempo' as const }]
  it('counts race day as a hard day: no quality run the day before it', () => {
    // Race on Sunday, Monday to Saturday left. Friday is free and far from everything else.
    for (const longDay of [SAT, SUN, MON]) {
      const { placement, warnings } = fitWeek(quality, { week: {}, routines, longDay, allowedDays: [MON, TUE, WED, THU, FRI, SAT], raceDay: SUN })
      expect(placement['w9-s2']).not.toBe(SAT)
      expect(warnings['w9-s2']).toEqual([])
    }
  })
  it('keeps the quality run off the day before the race even when the only other day follows leg day', () => {
    // Race on Wednesday: Monday and Tuesday left, legs on Sunday. The long run takes the day before
    // the race, though Monday is nearer its Sunday.
    const { placement, warnings } = fitWeek(quality, { week: { [SUN]: ['leg'] }, routines, longDay: SUN, allowedDays: [MON, TUE], raceDay: WED })
    expect(placement['w9-s2']).toBe(MON)
    expect(warnings['w9-s2']).toEqual(['after_leg_day'])
  })
  it('warns live about a quality run the day before the race', () => {
    const placed = [{ id: 'w9-s1', type: 'long' as const, day: MON }, { id: 'w9-s2', type: 'tempo' as const, day: SAT }]
    expect(weekWarnings(placed, {}, routines, SUN)['w9-s2']).toEqual(['hard_in_a_row'])
    expect(weekWarnings(placed, {}, routines)['w9-s2']).toEqual([])
    const at = { 'w9-s1': MON, 'w9-s2': WED }
    expect(moveWarnings('w9-s2', SAT, at, quality, { week: {}, routines, raceDay: SUN })).toEqual(['hard_in_a_row'])
    expect(moveWarnings('w9-s2', FRI, at, quality, { week: {}, routines, raceDay: SUN })).toEqual([])
    expect(moveWarnings('w9-s1', SAT, at, quality, { week: {}, routines, raceDay: SUN })).toEqual([])
  })
})
