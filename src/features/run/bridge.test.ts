// The maintain weeks before a race plan that starts later (spec §5.3, R2 ruling on I6-1): built
// with the maintain cycle and the race answers' days and reference, never breaking the 110% rule
// into the race plan's first week, and never leaving more than 3 regular weeks between recovery
// weeks across the junction (final review M1).
import { describe, expect, it } from 'vitest'
import { FAMILIES, buildBridge, buildPlan, weekMinutes, type PlanWeek } from './models'
import { vdotFrom } from './vdot'
import type { Answers, Reference } from './types'

const TODAY = '2026-10-19'
const REFS: Reference[] = [
  { kind: 'race', distanceM: 5000, minutes: 15, date: '2026-10-01' },
  { kind: 'race', distanceM: 5000, minutes: 25, date: '2026-10-01' },
  { kind: 'race', distanceM: 10000, minutes: 90, date: '2026-10-01' },
  { kind: 'race', distanceM: 21097.5, minutes: 150, date: '2026-10-01' },
  { kind: 'race', distanceM: 1000, minutes: 40, date: '2026-10-01' },
  ...[1, 20, 25, 30, 40, 50, 180].map(minutes => ({ kind: 'continuous' as const, minutes })),
]
const vdotOf = (r: Reference) => (r.kind === 'race' ? vdotFrom(r.distanceM, r.minutes) : null)
const isRegular = (w: PlanWeek) => !w.recovery && w.phase !== 'taper'
// The longest run of regular weeks (neither recovery nor taper) in a row.
const longestRegularRun = (weeks: PlanWeek[]) => {
  let run = 0
  let most = 0
  for (const w of weeks) { run = isRegular(w) ? run + 1 : 0; most = Math.max(most, run) }
  return most
}
const lastRegularBefore = (weeks: PlanWeek[], i: number) => {
  for (let k = i - 1; k >= 0; k--) if (!weeks[k].recovery && weeks[k].phase !== 'taper') return weeks[k]
  return null
}

describe('buildBridge', () => {
  it('repeats the maintain cycle with the race days, phase maintain, ids from week 1, ending on a recovery week', () => {
    const a: Answers = { goal: '10k', goalType: 'finish', weeks: 30, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: 0 }
    const weeks = buildBridge(a, 10, null)
    expect(weeks.map(w => w.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(new Set(weeks.map(w => w.phase))).toEqual(new Set(['maintain']))
    // The cycle is entered at its week 3, so its recovery weeks (4 and 8) fall on the bridge's
    // weeks 2, 6 and 10: the week before the race plan is a recovery week.
    expect(weeks.map(w => w.recovery)).toEqual([false, true, false, false, false, true, false, false, false, true])
    expect(weeks[8].sessions.map(s => s.id)).toEqual(['w9-s1', 'w9-s2', 'w9-s3'])
    expect(weeks.every(w => w.sessions.length === 3)).toBe(true)
    expect(weeks.flatMap(w => w.sessions).every(s => s.type !== 'intervals')).toBe(true)
    expect(buildBridge({ ...a, goal: 'maintain' }, 4, null)).toEqual([])
  })

  for (const goal of ['5k', '10k', 'half'] as const) {
    for (const days of FAMILIES[goal].days as (2 | 3 | 4)[]) {
      it(`${goal}, ${days} days: the bridge and the race plan after it keep the 110% rule, the recovery spacing and the Longão longest`, () => {
        const bad: string[] = []
        const f = FAMILIES[goal]
        for (const ref of REFS) {
          const a: Answers = { goal, goalType: 'finish', weeks: f.minWeeks + 8, reference: ref, days, longDay: 0 }
          const { weeks: race, vdot } = buildPlan(a, TODAY, vdotOf(ref))
          // Every wait the questionnaire can give (a race up to 52 weeks out).
          for (let wait = 1; wait <= 48; wait++) {
            const weeks = [...buildBridge(a, wait, vdot), ...race]
            if (!weeks[wait - 1].recovery) bad.push(`${JSON.stringify(ref)} wait ${wait}: the week before the race plan is not a recovery week`)
            if (longestRegularRun(weeks) > 3) bad.push(`${JSON.stringify(ref)} wait ${wait}: ${longestRegularRun(weeks)} regular weeks in a row`)
            weeks.forEach((w, i) => {
              const m = weekMinutes(w)
              const prev = lastRegularBefore(weeks, i)
              const where = `${JSON.stringify(ref)} wait ${wait} week ${i + 1}`
              if (prev && m > 1.1 * weekMinutes(prev) + 1) bad.push(`${where}: ${m} of ${weekMinutes(prev)}`)
              const long = weekMinutes({ sessions: w.sessions.filter(s => s.type === 'long') })
              if (i < wait && w.sessions.some(s => weekMinutes({ sessions: [s] }) > long)) bad.push(`${where}: Longão ${long}`)
            })
          }
        }
        expect(bad).toEqual([])
      })
    }
  }
})
