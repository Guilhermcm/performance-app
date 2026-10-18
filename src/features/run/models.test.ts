import { describe, expect, it } from 'vitest'
import { FAMILIES, buildPlan, checkAnswers, weekMinutes, type PlanWeek } from './models'
import type { Answers, Item, Reference, RunGoal } from './types'
import { predictMinutes, vdotFrom } from './vdot'

const TODAY = '2026-10-18'
const RACE: Reference = { kind: 'race', distanceM: 5000, minutes: 25, date: '2026-10-01' }
const GOALS = Object.keys(FAMILIES) as RunGoal[]

const answers = (o: Partial<Answers> = {}): Answers => ({
  goal: '5k', goalType: 'finish', reference: o.goal === 'start' ? { kind: 'none' } : RACE, days: 3, longDay: 0, ...o
})
const plan = (o: Partial<Answers> = {}) => buildPlan(answers(o), TODAY, null).weeks

// Every family with every allowed number of days, at the minimum deadline and with longer and
// shorter ones.
const VARIANTS = GOALS.flatMap(goal => FAMILIES[goal].days.map(days => ({ goal, days: days as 2 | 3 | 4 })))
const DEADLINES = (goal: RunGoal) => {
  const min = FAMILIES[goal].minWeeks
  return goal === 'maintain' ? [undefined] : [min, min + 1, min + 4, min + 7, min + 20, FAMILIES[goal].finishWeeks]
}
const CASES = VARIANTS.flatMap(v => DEADLINES(v.goal).map(weeks => ({ ...v, weeks })))
const name = (c: { goal: string; days: number; weeks?: number }) => `${c.goal}, ${c.days} days, ${c.weeks ?? '-'} weeks`

const has = (w: PlanWeek, type: string) => w.sessions.some(s => s.type === type)
const lastRegularBefore = (weeks: PlanWeek[], i: number) => {
  for (let j = i - 1; j >= 0; j--) if (!weeks[j].recovery) return weeks[j]
  return null
}
const peak = (weeks: PlanWeek[]) => weeks.filter(w => w.phase !== 'taper' && !w.recovery).at(-1)!
const blocksOf = (items: Item[]) => items.flatMap(it => ('repeat' in it ? it.blocks : [it]))

describe('buildPlan: shape', () => {
  it.each(CASES)('$goal, $days days, $weeks weeks: one session per running day, a long run and w{n}-s{k} ids', c => {
    const weeks = plan(c)
    expect(weeks.length).toBeGreaterThan(0)
    weeks.forEach((w, i) => {
      expect(w.index).toBe(i + 1)
      expect(w.sessions).toHaveLength(c.days)
      expect(w.sessions.map(s => s.id)).toEqual(w.sessions.map((_, k) => `w${w.index}-s${k + 1}`))
      if (c.goal !== 'start') expect(w.sessions.filter(s => s.type === 'long')).toHaveLength(1)
      for (const s of w.sessions) expect(s).not.toHaveProperty('day')
    })
  })

  it.each(CASES.filter(c => c.goal !== 'start' && c.goal !== 'maintain'))('$goal, $days days, $weeks weeks: phases in order, base with easy and long runs only', c => {
    const weeks = plan(c)
    const order = ['base', 'build', 'specific', 'taper']
    const phases = weeks.map(w => order.indexOf(w.phase))
    expect(phases).toEqual([...phases].sort((a, b) => a - b))
    for (const w of weeks.filter(w => w.phase === 'base')) {
      expect(w.sessions.every(s => s.type === 'easy' || s.type === 'long')).toBe(true)
    }
    for (const w of weeks.filter(w => w.phase !== 'base' && !w.recovery)) {
      expect(w.sessions.filter(s => s.type === 'tempo' || s.type === 'intervals')).toHaveLength(1)
    }
  })

  it('alternates tempo and intervals in the build phase and uses the family workout in the specific one', () => {
    const quality = (w: PlanWeek) => w.sessions.find(s => s.type === 'tempo' || s.type === 'intervals')?.type
    const half = plan({ goal: 'half', days: 3, weeks: 12 })
    expect(half.filter(w => w.phase === 'build' && !w.recovery).map(quality)).toEqual(['tempo', 'intervals', 'tempo'])
    expect(half.filter(w => w.phase === 'specific').map(quality)).toEqual(['tempo', 'tempo', 'tempo'])
    expect(plan({ goal: '5k', days: 3, weeks: 8 }).filter(w => w.phase === 'specific').map(quality)).toEqual(['intervals', 'intervals'])
  })

  it('builds the Decision 5 workouts: warm up, quality blocks, cool down', () => {
    const tenK = plan({ goal: '10k', days: 4, weeks: 10 })
    const spec = tenK.filter(w => w.phase === 'specific').map(w => w.sessions.find(s => s.type === 'tempo')!.blocks)
    expect(spec[0][0]).toEqual({ zone: 'easy', min: 10 })
    expect(spec[0][1]).toEqual({ repeat: 2, blocks: [{ zone: 'moderate', min: 12 }, { zone: 'easy', min: 2 }] })
    expect(spec.at(-1)![1]).toEqual({ zone: 'moderate', min: 20 })
    const half = plan({ goal: 'half', days: 3, weeks: 12 }).filter(w => w.phase === 'specific')
    expect(half.at(-1)!.sessions.find(s => s.type === 'tempo')!.blocks[1]).toEqual({ zone: 'moderate', min: 30 })
    const fiveK = plan({ goal: '5k', days: 3, weeks: 8 }).filter(w => w.phase === 'specific')
    expect(fiveK[0].sessions.find(s => s.type === 'intervals')!.blocks[1])
      .toEqual({ repeat: 5, blocks: [{ zone: 'hard', min: 3 }, { zone: 'easy', min: 3 }] })
    for (const w of [...tenK, ...fiveK]) {
      for (const s of w.sessions.filter(s => s.type === 'tempo' || s.type === 'intervals')) {
        const last = s.blocks.at(-1) as { zone: string; min: number }
        expect(last.zone).toBe('easy')
        expect(last.min).toBeGreaterThanOrEqual(5)
        expect(last.min).toBeLessThanOrEqual(10)
      }
    }
  })
})

describe('buildPlan: volume', () => {
  it.each(CASES.filter(c => c.goal !== 'start'))('$goal, $days days, $weeks weeks: no week above 110% of the last regular week', c => {
    const weeks = plan(c)
    weeks.forEach((w, i) => {
      const ref = lastRegularBefore(weeks, i)
      if (ref) expect(weekMinutes(w), `week ${w.index}`).toBeLessThanOrEqual(1.1 * weekMinutes(ref))
    })
  })

  it.each(CASES.filter(c => c.goal !== 'start'))('$goal, $days days, $weeks weeks: recovery every 4 weeks, about 75% and no intervals', c => {
    const weeks = plan(c)
    weeks.forEach((w, i) => {
      expect(w.recovery, `week ${w.index}`).toBe(w.index % 4 === 0 && w.phase !== 'taper')
      if (!w.recovery) return
      expect(has(w, 'intervals')).toBe(false)
      const ratio = weekMinutes(w) / weekMinutes(weeks[i - 1])
      expect(ratio, `week ${w.index}`).toBeGreaterThanOrEqual(0.7)
      expect(ratio, `week ${w.index}`).toBeLessThanOrEqual(0.8)
    })
  })

  it.each(CASES.filter(c => c.goal === '5k' || c.goal === '10k' || c.goal === 'half'))('$goal, $days days, $weeks weeks: taper of 1 or 2 weeks, 25% and 40% less', c => {
    const weeks = plan(c)
    const taper = weeks.filter(w => w.phase === 'taper')
    expect(taper).toHaveLength(c.goal === '5k' ? 1 : 2)
    expect(weeks.slice(-taper.length)).toEqual(taper)
    const top = weekMinutes(peak(weeks))
    expect(weekMinutes(taper.at(-1)!) / top).toBeCloseTo(0.6, 1)
    if (taper.length === 2) expect(weekMinutes(taper[0]) / top).toBeCloseTo(0.75, 1)
  })

  it('raises easy and long runs 8% a week up to the family caps', () => {
    const easyMin = (w: PlanWeek) => (w.sessions.find(s => s.type === 'easy')!.blocks[0] as { min: number }).min
    const longMin = (w: PlanWeek) => (w.sessions.find(s => s.type === 'long')!.blocks[0] as { min: number }).min
    const weeks = plan({ goal: 'half', days: 4, weeks: 20 })
    expect(easyMin(weeks[0])).toBe(40)
    expect(longMin(weeks[0])).toBe(52)
    expect(easyMin(weeks[1])).toBe(43)
    expect(longMin(weeks[1])).toBe(56)
    for (const w of weeks) {
      expect(easyMin(w)).toBeLessThanOrEqual(60)
      expect(longMin(w)).toBeLessThanOrEqual(120)
    }
    for (const w of plan({ goal: '10k', days: 4, weeks: 18 })) {
      expect(easyMin(w)).toBeLessThanOrEqual(55)
      expect(longMin(w)).toBeLessThanOrEqual(80)
    }
    for (const w of plan({ goal: '5k', days: 4, weeks: 16 })) {
      expect(easyMin(w)).toBeLessThanOrEqual(50)
      expect(longMin(w)).toBeLessThanOrEqual(60)
    }
  })

  it('starts from the reference: continuous minutes or the race family default', () => {
    const firstEasy = (o: Partial<Answers>) => plan(o)[0].sessions.find(s => s.type === 'easy')!.blocks
    expect(firstEasy({ goal: '5k', reference: { kind: 'continuous', minutes: 30 } })).toEqual([{ zone: 'easy', min: 24 }])
    expect(firstEasy({ goal: '5k', reference: { kind: 'continuous', minutes: 90 } })).toEqual([{ zone: 'easy', min: 40 }])
    expect(firstEasy({ goal: '5k' })).toEqual([{ zone: 'easy', min: 30 }])
    expect(firstEasy({ goal: '10k' })).toEqual([{ zone: 'easy', min: 35 }])
    expect(firstEasy({ goal: 'half' })).toEqual([{ zone: 'easy', min: 40 }])
    expect(firstEasy({ goal: 'maintain' })).toEqual([{ zone: 'easy', min: 30 }])
  })
})

describe('buildPlan: deadline', () => {
  const base = (weeks: PlanWeek[]) => weeks.filter(w => w.phase === 'base').length

  it('adds base weeks for a longer deadline, at most 8, and returns only the plan weeks', () => {
    const min = plan({ goal: '10k', weeks: 10 })
    expect(min).toHaveLength(10)
    const plus4 = plan({ goal: '10k', weeks: 14 })
    expect(plus4).toHaveLength(14)
    expect(base(plus4)).toBe(base(min) + 4)
    const plus20 = plan({ goal: '10k', weeks: 30 })
    expect(plus20).toHaveLength(18)
    expect(base(plus20)).toBe(base(min) + 8)
    expect(plus20.slice(-8).map(w => w.phase)).toEqual(min.slice(-8).map(w => w.phase))
  })

  it('reads the deadline from the race date', () => {
    expect(plan({ goal: 'half', raceDate: '2027-01-24' })).toHaveLength(14)
    expect(checkAnswers(answers({ goal: 'half', raceDate: '2027-01-24' }), TODAY)).toEqual({ ok: true, weeks: 14 })
  })

  it('shortens a finish plan by removing base weeks only', () => {
    const short = plan({ goal: 'half', weeks: 10 })
    const full = plan({ goal: 'half', weeks: 12 })
    expect(short).toHaveLength(10)
    expect(base(short)).toBe(base(full) - 2)
    expect(short.filter(w => w.phase !== 'base').map(w => w.phase)).toEqual(full.filter(w => w.phase !== 'base').map(w => w.phase))
  })
})

describe('checkAnswers', () => {
  it('accepts the minimum deadline and caps a longer one at 8 extra weeks', () => {
    expect(checkAnswers(answers({ goal: '10k', weeks: 10 }), TODAY)).toEqual({ ok: true, weeks: 10 })
    expect(checkAnswers(answers({ goal: '10k', weeks: 30 }), TODAY)).toEqual({ ok: true, weeks: 18 })
    expect(checkAnswers(answers({ goal: 'maintain', days: 2 }), TODAY)).toEqual({ ok: true, weeks: 8 })
  })

  it('too short: only the minimum deadline below 6 weeks for 10k', () => {
    expect(checkAnswers(answers({ goal: '10k', weeks: 5 }), TODAY)).toEqual({ ok: false, reason: 'too_short', minWeeks: 10 })
    expect(checkAnswers(answers({ goal: '10k', weeks: 6 }), TODAY)).toEqual({ ok: false, reason: 'too_short', minWeeks: 10, finishWeeks: 6 })
  })

  it('too short: the minimum deadline or a finish plan for half from 8 weeks', () => {
    expect(checkAnswers(answers({ goal: 'half', weeks: 10 }), TODAY)).toEqual({ ok: false, reason: 'too_short', minWeeks: 12, finishWeeks: 10 })
    expect(checkAnswers(answers({ goal: 'half', weeks: 7 }), TODAY)).toEqual({ ok: false, reason: 'too_short', minWeeks: 12 })
  })

  it('a time goal out of reach offers the time possible with VDOT + weeks / 4', () => {
    const reference: Reference = { kind: 'race', distanceM: 5000, minutes: 25 + 10 / 60, date: '2026-10-01' }
    expect(vdotFrom(5000, reference.minutes)).toBe(38)
    const r = checkAnswers(answers({ goal: '10k', goalType: 'time', targetMinutes: 40, weeks: 10, reference }), TODAY)
    expect(r).toMatchObject({ ok: false, reason: 'time_out_of_reach' })
    if (r.ok) return
    expect(Math.abs(r.possibleMinutes! - predictMinutes(40.5, 10000)) * 60).toBeLessThanOrEqual(1)
  })

  it('a time goal within VDOT + weeks / 4 (capped at +6) is accepted', () => {
    const reference: Reference = { kind: 'race', distanceM: 5000, minutes: 25 + 10 / 60, date: '2026-10-01' }
    const ok = predictMinutes(40.5, 10000) + 0.1
    expect(checkAnswers(answers({ goal: '10k', goalType: 'time', targetMinutes: ok, weeks: 10, reference }), TODAY)).toEqual({ ok: true, weeks: 10 })
    const cap = predictMinutes(44, 10000)
    expect(checkAnswers(answers({ goal: '10k', goalType: 'time', targetMinutes: cap + 0.1, weeks: 40, reference }), TODAY)).toEqual({ ok: true, weeks: 18 })
    expect(checkAnswers(answers({ goal: '10k', goalType: 'time', targetMinutes: cap - 0.5, weeks: 40, reference }), TODAY))
      .toMatchObject({ ok: false, reason: 'time_out_of_reach' })
  })

  it('a race reference older than 3 months is too old', () => {
    const old: Reference = { ...RACE, date: '2026-06-18' }
    expect(checkAnswers(answers({ goal: '10k', weeks: 10, reference: old }), TODAY)).toEqual({ ok: false, reason: 'reference_too_old' })
    const recent: Reference = { ...RACE, date: '2026-07-18' }
    expect(checkAnswers(answers({ goal: '10k', weeks: 10, reference: recent }), TODAY)).toEqual({ ok: true, weeks: 10 })
  })

  it('days outside the family range are not allowed', () => {
    expect(checkAnswers(answers({ goal: '10k', weeks: 10, days: 2 }), TODAY)).toEqual({ ok: false, reason: 'days_not_allowed' })
    expect(checkAnswers(answers({ goal: 'start', weeks: 8, days: 4 }), TODAY)).toEqual({ ok: false, reason: 'days_not_allowed' })
    expect(checkAnswers(answers({ goal: '5k', weeks: 8, days: 2 }), TODAY)).toEqual({ ok: true, weeks: 8 })
  })
})

describe('start', () => {
  const rw = (repeat: number, run: number, walk: number): Item => ({ repeat, blocks: [{ zone: 'easy', min: run }, { zone: 'walk', min: walk }] })
  const TABLE: Item[][] = [
    [rw(8, 1, 2)], [rw(6, 2, 2)], [rw(5, 3, 2)], [rw(4, 3, 2)],
    [rw(3, 8, 2)], [rw(2, 12, 2)], [{ zone: 'easy', min: 20 }, rw(2, 5, 1)], [{ zone: 'easy', min: 30 }]
  ]

  it('follows the 8 weeks of Decision 7, week 4 as the recovery week', () => {
    const weeks = plan({ goal: 'start', days: 2, weeks: 8 })
    expect(weeks.map(w => w.sessions[0].blocks)).toEqual(TABLE)
    expect(weeks.map(w => w.sessions[1].blocks)).toEqual(TABLE)
    expect(weeks.map(w => w.recovery)).toEqual([false, false, false, true, false, false, false, false])
    expect(weeks.map(w => w.sessions[0].type)).toEqual([...Array(7).fill('runwalk'), 'easy'])
  })

  it('with 3 days, the third session repeats the day at 80% of the minutes', () => {
    const weeks = plan({ goal: 'start', days: 3, weeks: 8 })
    expect(weeks[0].sessions[2].blocks).toEqual([rw(6, 1, 2)])
    expect(weeks[4].sessions[2].blocks).toEqual([rw(3, 6, 2)])
    expect(weeks[6].sessions[2].blocks).toEqual([{ zone: 'easy', min: 16 }, rw(2, 4, 1)])
    expect(weeks[7].sessions[2].blocks).toEqual([{ zone: 'easy', min: 24 }])
    for (const w of weeks) {
      const [a, , c] = w.sessions.map(s => weekMinutes({ sessions: [s] }))
      expect(c / a).toBeGreaterThanOrEqual(0.7)
      expect(c / a).toBeLessThanOrEqual(0.9)
    }
  })

  it('with 25 continuous minutes, starts at the first week with a continuous block of 15 minutes or more', () => {
    const weeks = plan({ goal: 'start', days: 2, weeks: 8, reference: { kind: 'continuous', minutes: 25 } })
    expect(weeks).toHaveLength(2)
    expect(weeks.map(w => w.sessions[0].blocks)).toEqual(TABLE.slice(6))
    expect(weeks.map(w => w.index)).toEqual([1, 2])
    expect(checkAnswers(answers({ goal: 'start', days: 2, weeks: 4, reference: { kind: 'continuous', minutes: 25 } }), TODAY))
      .toEqual({ ok: true, weeks: 2 })
  })

  it('below 20 continuous minutes, starts at week 1', () => {
    expect(plan({ goal: 'start', days: 2, weeks: 8, reference: { kind: 'continuous', minutes: 19 } })).toHaveLength(8)
    expect(checkAnswers(answers({ goal: 'start', days: 2, weeks: 6 }), TODAY)).toEqual({ ok: false, reason: 'too_short', minWeeks: 8 })
  })
})

describe('maintain', () => {
  const tempoWeeks = (weeks: PlanWeek[]) => weeks.filter(w => has(w, 'tempo')).map(w => w.index)

  it.each([2, 3, 4] as const)('%i days: 8 weeks, recovery in 4 and 8, easy and long runs that do not grow', days => {
    const weeks = plan({ goal: 'maintain', days })
    expect(weeks).toHaveLength(8)
    expect(weeks.filter(w => w.recovery).map(w => w.index)).toEqual([4, 8])
    expect(weeks.some(w => has(w, 'intervals'))).toBe(false)
    const regular = weeks.filter(w => !w.recovery)
    const easyMin = (w: PlanWeek) => (w.sessions.find(s => s.type === 'easy')!.blocks[0] as { min: number }).min
    expect(new Set(regular.slice(0, 2).map(easyMin)).size).toBe(1)
    expect(easyMin(weeks[0])).toBe(30)
  })

  it('tempo 2 x 10 once a week from week 3 with 3 or 4 days', () => {
    for (const days of [3, 4] as const) {
      const weeks = plan({ goal: 'maintain', days })
      expect(tempoWeeks(weeks)).toEqual([3, 4, 5, 6, 7, 8])
      for (const w of weeks.filter(w => has(w, 'tempo'))) {
        expect(w.sessions.filter(s => s.type === 'tempo')).toHaveLength(1)
        expect(w.sessions.find(s => s.type === 'tempo')!.blocks[1]).toEqual({ repeat: 2, blocks: [{ zone: 'moderate', min: 10 }, { zone: 'easy', min: 2 }] })
      }
    }
    expect(tempoWeeks(plan({ goal: 'maintain', days: 2 }))).toEqual([])
  })
})

describe('limits (Review Focus 2)', () => {
  it('3 continuous minutes for a 5k start with a 20 minute easy run', () => {
    const weeks = plan({ goal: '5k', reference: { kind: 'continuous', minutes: 3 } })
    const easy = weeks[0].sessions.filter(s => s.type === 'easy')
    expect(easy.length).toBeGreaterThan(0)
    for (const s of easy) expect(s.blocks).toEqual([{ zone: 'easy', min: 20 }])
  })

  const REFS: Reference[] = [
    { kind: 'race', distanceM: 5000, minutes: 15, date: '2026-10-01' },
    { kind: 'race', distanceM: 10000, minutes: 90, date: '2026-10-01' },
    { kind: 'race', distanceM: 1000, minutes: 3, date: '2026-10-01' },
    { kind: 'race', distanceM: 42195, minutes: 360, date: '2026-10-01' },
    { kind: 'continuous', minutes: 1 },
    { kind: 'continuous', minutes: 3 },
    { kind: 'continuous', minutes: 180 },
    { kind: 'none' }
  ]
  const ALL = CASES.flatMap(c => REFS.map(reference => ({ ...c, reference })))

  it(`every block within 1 to 300 minutes and every workout within 12 items (${ALL.length} plans)`, () => {
    for (const c of ALL) {
      const weeks = buildPlan(answers(c), TODAY, c.reference.kind === 'race' ? vdotFrom(c.reference.distanceM, c.reference.minutes) : null).weeks
      for (const w of weeks) {
        expect(Number.isFinite(weekMinutes(w)), name(c)).toBe(true)
        for (const s of w.sessions) {
          expect(s.blocks.length, name(c)).toBeGreaterThan(0)
          expect(s.blocks.length, name(c)).toBeLessThanOrEqual(12)
          for (const it of s.blocks) {
            if ('repeat' in it) {
              expect(Number.isInteger(it.repeat) && it.repeat >= 2 && it.repeat <= 20, name(c)).toBe(true)
              expect(it.blocks.length >= 1 && it.blocks.length <= 4, name(c)).toBe(true)
            }
          }
          for (const b of blocksOf(s.blocks)) {
            expect(Number.isInteger(b.min) && b.min >= 1 && b.min <= 300, `${name(c)} ${s.id} ${b.min}`).toBe(true)
          }
        }
      }
    }
  })
})

describe('weekMinutes', () => {
  it('sums blocks and repeats', () => {
    expect(weekMinutes({
      sessions: [
        { blocks: [{ zone: 'easy', min: 10 }, { repeat: 3, blocks: [{ zone: 'hard', min: 2 }, { zone: 'walk', min: 1 }] }] },
        { blocks: [{ zone: 'easy', min: 30 }] }
      ]
    })).toBe(49)
  })
})
