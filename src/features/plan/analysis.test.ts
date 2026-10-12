import { describe, expect, it } from 'vitest'
import { analyzePlan, BIG_GROUPS, exerciseGroupWeights, GROUP_OF, type Alert, type Group } from './analysis'
import { estimateMinutes } from './time'
import { EXIDX } from '@/lib/exercises.js'
import { musclesOf } from '@/lib/muscles.js'
import { isCardio } from '@/lib/exercises.js'

type Ex = { id: string; sets: number; reps?: number; restSec?: number }
type Routine = { id: string; name: string; ex: Ex[] }

// A custom exercise with explicit muscles: primaries count 1, secondaries 0.5 in the analysis.
const custom = (id: string, primaries: string[], secondaries: string[] = []) => ({ id, n: id, custom: true, bp: 'back', primaries, secondaries })
const routine = (id: string, ex: Ex[]): Routine => ({ id, name: id, ex })
const plan = (week: Record<number, string[]>, routines: Routine[], customEx: object[] = []) =>
  ({ week: { ...week } as Record<number, string[]>, routines, customEx })

// chest-only and back-only helpers so a test can dial a group to an exact fractional total
const CHEST = custom('c-chest', ['chest'])
const CHEST_SEC = custom('c-chest-sec', ['triceps'], ['chest'])
const BICEPS = custom('c-biceps', ['biceps'])
const kinds = (alerts: Alert[]) => alerts.map(a => a.kind)

describe('analyzePlan volume', () => {
  it('counts the primary muscle as 1 set and each secondary as 0.5', () => {
    const weights = musclesOf((EXIDX as Record<string, object>)['0025']) as Record<string, number>
    const groupOf = GROUP_OF as Record<string, Group | undefined>
    const S = plan({ 1: ['push'] }, [routine('push', [{ id: '0025', sets: 3 }])])
    const a = analyzePlan(S, 'hypertrophy')
    const expected: Partial<Record<Group, number>> = {}
    for (const [slug, w] of Object.entries(weights)) {
      const g = groupOf[slug]
      if (g) expected[g] = Math.max(expected[g] ?? 0, 3 * (w === 1 ? 1 : 0.5))
    }
    expect(expected.chest).toBe(3)
    for (const g of Object.keys(a.groups) as Group[]) expect(a.groups[g].sets).toBe(expected[g] ?? 0)
    // the secondary muscles of the bench press show up as halves
    const secondary = Object.entries(weights).filter(([slug, w]) => w !== 1 && groupOf[slug])
    expect(secondary.length).toBeGreaterThan(0)
    for (const [slug] of secondary) expect(a.groups[groupOf[slug]!].sets).toBe(1.5)
  })

  it('reads a legacy scalar week day as a one-routine day', () => {
    const S = plan({}, [routine('push', [{ id: 'c-chest', sets: 3 }])], [CHEST])
    ;(S.week as Record<number, unknown>)[1] = 'push'
    const a = analyzePlan(S as never, 'hypertrophy')
    expect(a.empty).toBe(false)
    expect(a.groups.chest).toMatchObject({ sets: 3, days: 1 })
    expect(a.minutes.map(m => m.routineId)).toEqual(['push'])
  })

  it('counts a routine in two weekdays twice, with days = 2', () => {
    const S = plan({ 1: ['push'], 4: ['push'] }, [routine('push', [{ id: '0025', sets: 3 }])])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.groups.chest).toMatchObject({ sets: 6, days: 2 })
  })

  it('ignores a routine id in the week that has no routine', () => {
    const S = plan({ 1: ['gone', 'push'] }, [routine('push', [{ id: '0025', sets: 3 }])])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.groups.chest.sets).toBe(3)
    expect(a.minutes.map(m => m.routineId)).toEqual(['push'])
  })

  it('does not count a day where the group gets only 1.5 sets for frequency', () => {
    const S = plan({ 1: ['a'], 3: ['b'] }, [
      routine('a', [{ id: 'c-chest', sets: 4 }]),
      routine('b', [{ id: 'c-chest-sec', sets: 3 }]),
    ], [CHEST, CHEST_SEC])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.groups.chest).toMatchObject({ sets: 5.5, days: 1 })
  })

  it('sums several routines of the same weekday into one day', () => {
    const S = plan({ 1: ['a', 'b'] }, [
      routine('a', [{ id: 'c-chest-sec', sets: 2 }]),
      routine('b', [{ id: 'c-chest-sec', sets: 2 }]),
    ], [CHEST_SEC])
    expect(analyzePlan(S, 'hypertrophy').groups.chest).toMatchObject({ sets: 2, days: 1 })
  })

  it('maps abs and obliques into one abs group', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-core', sets: 4 }])], [custom('c-core', ['abs'], ['obliques'])])
    expect(analyzePlan(S, 'hypertrophy').groups.abs.sets).toBe(4)
  })
})

describe('analyzePlan status per profile', () => {
  const chestSets = (sets: number, profile: 'hypertrophy' | 'strength' | 'health') => {
    // sets of whole-number primary work plus one half-set secondary when the total ends in .5
    const whole = Math.floor(sets)
    const ex: Ex[] = [{ id: 'c-chest', sets: whole }]
    if (sets !== whole) ex.push({ id: 'c-chest-sec', sets: 1 })
    const S = plan({ 1: ['a'] }, [routine('a', ex)], [CHEST, CHEST_SEC])
    return analyzePlan(S, profile).groups.chest
  }

  it.each([
    ['hypertrophy', 9.5, 'low'], ['hypertrophy', 10, 'ok'], ['hypertrophy', 20, 'ok'], ['hypertrophy', 20.5, 'high'],
    ['strength', 5.5, 'low'], ['strength', 6, 'ok'], ['strength', 12, 'ok'], ['strength', 12.5, 'high'],
    ['health', 3.5, 'low'], ['health', 4, 'ok'], ['health', 10, 'ok'], ['health', 10.5, 'high'],
  ] as const)('%s with %s sets is %s', (profile, sets, status) => {
    const g = chestSets(sets, profile)
    expect(g.sets).toBe(sets)
    expect(g.status).toBe(status)
  })

  it('marks 0 sets as missing for a big group and low for the others', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-chest', sets: 10 }])], [CHEST])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.groups.back.status).toBe('missing')
    expect(a.groups.quads.status).toBe('missing')
    expect(a.groups.biceps.status).toBe('low')
    expect(a.groups.calves.status).toBe('low')
    expect(BIG_GROUPS).toEqual(['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes'])
  })
})

describe('analyzePlan alerts', () => {
  it('raises missing, low and high alerts in that order, with the group', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-chest', sets: 25 }, { id: 'c-biceps', sets: 3 }])], [CHEST, BICEPS])
    const a = analyzePlan(S, 'hypertrophy')
    const k = kinds(a.alerts)
    expect(k.indexOf('missing')).toBeLessThan(k.indexOf('low'))
    expect(k.indexOf('low')).toBeLessThan(k.indexOf('high'))
    expect(a.alerts).toContainEqual({ kind: 'missing', group: 'back' })
    expect(a.alerts).toContainEqual({ kind: 'low', group: 'biceps' })
    expect(a.alerts).toContainEqual({ kind: 'high', group: 'chest' })
    expect(a.alerts.filter(x => x.kind === 'missing').map(x => x.group)).toEqual(['back', 'shoulders', 'quads', 'hamstrings', 'glutes'])
  })

  it('raises the frequency alert only for hypertrophy', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-chest', sets: 12 }])], [CHEST])
    const hyper = analyzePlan(S, 'hypertrophy')
    expect(hyper.alerts).toContainEqual({ kind: 'frequency', group: 'chest' })
    expect(kinds(analyzePlan(S, 'strength').alerts)).not.toContain('frequency')
    expect(kinds(analyzePlan(S, 'health').alerts)).not.toContain('frequency')
  })

  it('does not raise a frequency alert for a group trained on 2 days', () => {
    const S = plan({ 1: ['a'], 4: ['a'] }, [routine('a', [{ id: 'c-chest', sets: 6 }])], [CHEST])
    expect(analyzePlan(S, 'hypertrophy').alerts).not.toContainEqual({ kind: 'frequency', group: 'chest' })
  })

  const pushPull = (push: number, pull: number) => {
    // push = chest only, pull = upper-back only; push 9 and pull 5.5 need a secondary half set
    const pullWhole = Math.floor(pull)
    const ex: Ex[] = [{ id: 'c-chest', sets: push }, { id: 'c-back', sets: pullWhole }]
    if (pull !== pullWhole) ex.push({ id: 'c-back-sec', sets: 1 })
    const S = plan({ 1: ['a'] }, [routine('a', ex)], [CHEST, custom('c-back', ['upper-back']), custom('c-back-sec', ['trapezius'], ['upper-back'])])
    return analyzePlan(S, 'hypertrophy')
  }

  it('does not alert push/pull at push 9 and pull 6, because 6 is 2/3 of 9', () => {
    const a = pushPull(9, 6)
    expect(a.balance).toMatchObject({ push: 9, pull: 6 })
    expect(kinds(a.alerts)).not.toContain('balance-push-pull')
  })

  it('alerts push/pull at push 9 and pull 5.5', () => {
    const a = pushPull(9, 5.5)
    // pull 5.5 is 5 primary sets of back plus one half-set secondary
    expect(a.balance.push).toBe(9)
    expect(a.alerts).toContainEqual({ kind: 'balance-push-pull' })
  })

  it('alerts quads against hamstrings, and not when both sides are 0', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-quad', sets: 12 }, { id: 'c-ham', sets: 4 }])], [custom('c-quad', ['quadriceps']), custom('c-ham', ['hamstring'])])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.balance).toMatchObject({ quads: 12, hamstrings: 4 })
    expect(a.alerts).toContainEqual({ kind: 'balance-quad-ham' })
    const none = analyzePlan(plan({ 1: ['a'] }, [routine('a', [{ id: 'c-chest', sets: 3 }])], [CHEST]), 'hypertrophy')
    expect(kinds(none.alerts)).not.toContain('balance-quad-ham')
  })

  it('computes the minutes of every scheduled routine once, and alerts above 75 min', () => {
    const long = routine('long', [{ id: 'c-chest', sets: 40, restSec: 90 }]) // 40 x 130 + 300 = 5500 s = 92 min
    const short = routine('short', [{ id: 'c-chest', sets: 3 }])
    const S = plan({ 1: ['long', 'short'], 3: ['long'] }, [long, short], [CHEST])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.minutes).toEqual([
      { routineId: 'long', minutes: estimateMinutes(long) },
      { routineId: 'short', minutes: estimateMinutes(short) },
    ])
    expect(a.alerts.filter(x => x.kind === 'long')).toEqual([{ kind: 'long', routineId: 'long' }])
  })

  it('does not alert a routine of exactly 75 min', () => {
    // 75 min = 4500 s: (4500 - 300) / 130 is not whole, so use rest 80: 120 s a set, 35 sets = 4200 + 300
    const r = routine('r', [{ id: 'c-chest', sets: 35, restSec: 80 }])
    expect(estimateMinutes(r)).toBe(75)
    const a = analyzePlan(plan({ 1: ['r'] }, [r], [CHEST]), 'hypertrophy')
    expect(kinds(a.alerts)).not.toContain('long')
  })

  it('alerts an exercise repeated in 3 days, not in 2, and not twice in one day', () => {
    const r = routine('r', [{ id: 'c-chest', sets: 3 }])
    const three = analyzePlan(plan({ 1: ['r'], 3: ['r'], 5: ['r'] }, [r], [CHEST]), 'hypertrophy')
    expect(three.alerts).toContainEqual({ kind: 'repeated', exId: 'c-chest' })
    const two = analyzePlan(plan({ 1: ['r'], 3: ['r'] }, [r], [CHEST]), 'hypertrophy')
    expect(kinds(two.alerts)).not.toContain('repeated')
    const sameDay = routine('d', [{ id: 'c-chest', sets: 3 }, { id: 'c-chest', sets: 3 }, { id: 'c-chest', sets: 3 }])
    expect(kinds(analyzePlan(plan({ 1: ['d'] }, [sameDay], [CHEST]), 'hypertrophy').alerts)).not.toContain('repeated')
  })

  it('orders alerts missing, low, high, frequency, balance, long, repeated', () => {
    const r = routine('r', [
      { id: 'c-chest', sets: 45, restSec: 90 }, { id: 'c-biceps', sets: 3 }, { id: 'c-quad', sets: 12 }, { id: 'c-ham', sets: 4 },
    ])
    const S = plan({ 1: ['r'], 3: ['r'], 5: ['r'] }, [r], [CHEST, BICEPS, custom('c-quad', ['quadriceps']), custom('c-ham', ['hamstring'])])
    // a group trained on one day only raises the frequency alert
    S.week[2] = ['solo']
    S.routines.push(routine('solo', [{ id: 'c-calf', sets: 12 }]))
    S.customEx.push(custom('c-calf', ['calves']))
    const k = kinds(analyzePlan(S, 'hypertrophy').alerts)
    const order = ['missing', 'low', 'high', 'frequency', 'balance-push-pull', 'balance-quad-ham', 'long', 'repeated']
    expect(k.map(x => order.indexOf(x))).toEqual([...k.map(x => order.indexOf(x))].sort((a, b) => a - b))
    for (const kind of ['missing', 'low', 'high', 'frequency', 'long', 'repeated']) expect(k).toContain(kind)
  })
})

describe('analyzePlan unknown and empty', () => {
  it('lists an exercise with no known muscle in unknown and adds nothing for it', () => {
    const none = { id: 'c-mystery', n: 'Mystery', custom: true }
    expect(musclesOf(none)).toEqual({})
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-mystery', sets: 5 }, { id: 'c-chest', sets: 3 }])], [none, CHEST])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.unknown).toEqual(['c-mystery'])
    expect(a.groups.chest.sets).toBe(3)
    // it still takes time in the routine
    expect(a.minutes[0].minutes).toBe(estimateMinutes(S.routines[0]))
  })

  it('sends a custom exercise with a body part but no muscle metadata to unknown', () => {
    // what the custom exercise form saves: a body part, no muscle chips
    const full = { id: 'c-full', n: 'Sandbag carry', bp: 'full body', custom: true }
    const legs = { id: 'c-legs', n: 'Sled push', bp: 'upper legs', custom: true }
    expect(Object.keys(musclesOf(full)).length).toBeGreaterThan(0) // the body-part fallback exists
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-full', sets: 4 }, { id: 'c-legs', sets: 4 }, { id: 'c-chest', sets: 3 }])], [full, legs, CHEST])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.unknown).toEqual(['c-full', 'c-legs'])
    expect(a.groups.chest.sets).toBe(3)
    for (const g of ['back', 'quads', 'hamstrings', 'glutes', 'abs'] as const) expect(a.groups[g].sets).toBe(0)
  })

  it('keeps a custom exercise that names its muscles in the volume', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'c-named', sets: 4 }])], [{ id: 'c-named', n: 'Named', bp: 'upper legs', custom: true, primaries: ['quadriceps'] }])
    const a = analyzePlan(S, 'hypertrophy')
    expect(a.unknown).toEqual([])
    expect(a.groups.quads.sets).toBe(4)
  })

  it('leaves cardio out of volume and frequency but keeps it in the minutes', () => {
    expect(isCardio('2138')).toBe(true)
    const bike = routine('bike', [{ id: '2138', sets: 3 }])
    const cardioCustom = { id: 'c-run', n: 'Run', bp: 'cardio', custom: true, primaries: ['quadriceps'] }
    const run = routine('run', [{ id: 'c-run', sets: 4 }])
    const a = analyzePlan(plan({ 1: ['bike'], 3: ['run'] }, [bike, run], [cardioCustom]), 'hypertrophy')
    for (const g of Object.values(a.groups)) expect(g).toMatchObject({ sets: 0, days: 0 })
    expect(a.unknown).toEqual([])
    expect(a.empty).toBe(false)
    expect(a.minutes).toEqual([
      { routineId: 'bike', minutes: estimateMinutes(bike) },
      { routineId: 'run', minutes: estimateMinutes(run) },
    ])
    expect(a.balance).toEqual({ push: 0, pull: 0, quads: 0, hamstrings: 0 })
  })

  it('treats an exercise id found nowhere as unknown', () => {
    const S = plan({ 1: ['a'] }, [routine('a', [{ id: 'nope', sets: 3 }])])
    expect(analyzePlan(S, 'hypertrophy').unknown).toEqual(['nope'])
  })

  it('lists an unknown exercise once even if it repeats', () => {
    const S = plan({ 1: ['a'], 2: ['a'] }, [routine('a', [{ id: 'nope', sets: 3 }])])
    expect(analyzePlan(S, 'hypertrophy').unknown).toEqual(['nope'])
  })

  it('reports an empty plan with no alerts', () => {
    for (const S of [plan({}, []), plan({ 1: ['gone'] }, []), { week: undefined, routines: undefined }]) {
      const a = analyzePlan(S, 'hypertrophy')
      expect(a.empty).toBe(true)
      expect(a.alerts).toEqual([])
      expect(a.minutes).toEqual([])
      expect(a.unknown).toEqual([])
      expect(a.balance).toEqual({ push: 0, pull: 0, quads: 0, hamstrings: 0 })
    }
  })

  it('is not empty once one scheduled routine has an exercise', () => {
    const a = analyzePlan(plan({ 1: ['a'] }, [routine('a', [{ id: 'c-chest', sets: 3 }])], [CHEST]), 'hypertrophy')
    expect(a.empty).toBe(false)
  })
})

describe('review T5-T6 follow-ups', () => {
  it('does not call cardio on 3 days a repeated exercise (M3)', () => {
    const bike = routine('bike', [{ id: '2138', sets: 3 }])
    const a = analyzePlan(plan({ 1: ['bike'], 3: ['bike'], 5: ['bike'] }, [bike]), 'hypertrophy')
    expect(kinds(a.alerts)).not.toContain('repeated')
  })

  it('exerciseGroupWeights gives the group weights under the analysis rules (M2)', () => {
    const S = { customEx: [CHEST_SEC, { id: 'c-bare', n: 'Bare', bp: 'upper legs', custom: true }] }
    // 1 for the main muscle, 0.5 for any other, the bigger weight per group
    expect(exerciseGroupWeights(S, 'c-chest-sec')).toEqual({ triceps: 1, chest: 0.5 })
    const bench = exerciseGroupWeights(S, '0025')
    expect(bench.chest).toBe(1)
    for (const w of Object.values(bench)) expect([0.5, 1]).toContain(w)
    // cardio, a custom with no muscles of its own, and an id found nowhere count for nothing
    expect(exerciseGroupWeights(S, '2138')).toEqual({})
    expect(exerciseGroupWeights(S, 'c-bare')).toEqual({})
    expect(exerciseGroupWeights(S, 'nope')).toEqual({})
  })
})
