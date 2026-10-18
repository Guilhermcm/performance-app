// Hybrid-week fit (spec §6.2): places a week's running sessions on weekdays around the strength
// routines, and says which rule a placement breaks. Pure; the store actions call it.
//
// Days follow the app's S.week convention: 0 = Sunday to 6 = Saturday (getDay()). The fit works on
// weekdays, never on positions in the displayed week, so it gives the same answer whether the
// person's week starts on Sunday or Monday. "The next day" wraps (Saturday is followed by Sunday),
// which is the physical truth and keeps both week starts equivalent.
import { loadOfRoutine } from '../../lib/muscles.js'
import type { SessionType } from './types'

export type FitWarning = 'after_leg_day' | 'hard_in_a_row' | 'shared_with_strength_hard'

type Week = Record<number, string[]>
type Routine = { id: string; ex?: { id: string; sets?: number }[] }
type FitSession = { id: string; type: SessionType }
export type FitContext = {
  week: Week
  routines: Routine[]
  longDay: number
  // Weekdays the sessions may use (the current week from today on). Omitted or empty: any day.
  allowedDays?: number[]
}

const DAYS = [0, 1, 2, 3, 4, 5, 6]
const LEG_MUSCLES = ['quadriceps', 'hamstring', 'gluteal']
const next = (d: number) => (d + 1) % 7
const prev = (d: number) => (d + 6) % 7
const gap = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 7 - d) }
const isQuality = (type: SessionType) => type === 'tempo' || type === 'intervals'
// Rule 4: only an easy or run/walk session may share a day with a strength routine.
const isGentle = (type: SessionType) => type === 'easy' || type === 'runwalk'

/** Days whose routines put more than half of the effective sets on quadriceps, hamstrings and glutes. */
export function legDays(week: Week, routines: Routine[]): Set<number> {
  const byId = new Map(routines.map(r => [r.id, r]))
  const out = new Set<number>()
  for (const day of DAYS) {
    let total = 0
    let legs = 0
    for (const id of week[day] || []) {
      const load = loadOfRoutine(byId.get(id)) as Record<string, number>
      for (const muscle in load) {
        total += load[muscle]
        if (LEG_MUSCLES.includes(muscle)) legs += load[muscle]
      }
    }
    if (total > 0 && legs / total > 0.5) out.add(day)
  }
  return out
}

const strengthDaysOf = (week: Week) => new Set(DAYS.filter(d => (week[d] || []).length > 0))

type Facts = { leg: Set<number>; strength: Set<number> }

// The rules a session at `day` breaks, given where every session sits (`at`: id to day).
function warningsOf(session: FitSession, day: number, at: Record<string, number>, sessions: FitSession[], facts: Facts): FitWarning[] {
  const out: FitWarning[] = []
  const hardRunDays = new Set(sessions.filter(s => s.id !== session.id && isQuality(s.type)).map(s => at[s.id]))
  if (isQuality(session.type)) {
    if (facts.leg.has(prev(day))) out.push('after_leg_day')
    // The day after leg is already reported as after_leg_day; this covers the other neighbours.
    const hardNext = facts.leg.has(next(day)) || hardRunDays.has(next(day))
    if (hardRunDays.has(prev(day)) || hardNext) out.push('hard_in_a_row')
  }
  if (!isGentle(session.type) && facts.strength.has(day)) out.push('shared_with_strength_hard')
  return out
}

/** The warnings a session would carry if it moved to `day`, everything else staying where it is. */
export function moveWarnings(
  sessionId: string,
  day: number,
  placement: Record<string, number>,
  sessions: FitSession[],
  ctx: Pick<FitContext, 'week' | 'routines'>,
): FitWarning[] {
  const session = sessions.find(s => s.id === sessionId)
  if (!session) return []
  const facts = { leg: legDays(ctx.week, ctx.routines), strength: strengthDaysOf(ctx.week) }
  return warningsOf(session, day, { ...placement, [sessionId]: day }, sessions, facts)
}

// Lower is better, compared left to right: the spec's rules in order, then the tie-breaks.
function costOf(days: number[], sessions: FitSession[], ctx: FitContext, facts: Facts): number[] {
  const at: Record<string, number> = {}
  sessions.forEach((s, i) => { at[s.id] = days[i] })
  let longGap = 0
  let afterLeg = 0
  let inARow = 0
  let sharedHard = 0
  let gentleOnStrength = 0
  sessions.forEach((s, i) => {
    if (s.type === 'long') longGap += gap(days[i], ctx.longDay)
    const w = warningsOf(s, days[i], at, sessions, facts)
    if (w.includes('after_leg_day')) afterLeg++
    if (w.includes('hard_in_a_row')) inARow++
    if (w.includes('shared_with_strength_hard')) sharedHard++
    if (isGentle(s.type) && facts.strength.has(days[i])) gentleOnStrength++
  })
  const stacked = sessions.length - new Set(days).size
  // Tie-break: far from the nearest hard day (leg days and the other quality runs).
  let farness = 0
  sessions.forEach((s, i) => {
    const hard = [...facts.leg, ...sessions.flatMap((o, j) => (j !== i && isQuality(o.type) ? [days[j]] : []))]
    farness += hard.length ? Math.min(...hard.map(h => gap(days[i], h))) : 7
  })
  return [longGap, stacked, afterLeg, inARow, sharedHard, gentleOnStrength, -farness, ...days]
}

const before = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/**
 * Places the week's sessions on weekdays. Tries every placement (at most four sessions on seven
 * days) and keeps the best by spec §6.2: long run on the preferred day (the nearest allowed one
 * when it is gone), then no two sessions on one day, no quality run after leg, no two hard days in
 * a row, no hard run on a strength day, easy runs on free days; ties go to the day farthest from the
 * nearest hard day, then to the lowest weekday. Nothing is ever dropped: a rule that cannot hold is
 * broken as little as possible and reported in `warnings`.
 */
export function fitWeek(
  sessions: FitSession[],
  ctx: FitContext,
): { placement: Record<string, number>; warnings: Record<string, FitWarning[]> } {
  const facts = { leg: legDays(ctx.week, ctx.routines), strength: strengthDaysOf(ctx.week) }
  const allowed = [...new Set((ctx.allowedDays || []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
  const candidates = allowed.length ? allowed : DAYS

  let best: number[] | null = null
  let bestCost: number[] = []
  const days: number[] = []
  const search = (i: number) => {
    if (i === sessions.length) {
      const cost = costOf(days, sessions, ctx, facts)
      if (!best || before(cost, bestCost)) { best = [...days]; bestCost = cost }
      return
    }
    for (const d of candidates) { days[i] = d; search(i + 1) }
  }
  search(0)

  const placement: Record<string, number> = {}
  sessions.forEach((s, i) => { placement[s.id] = (best || [])[i] })
  const warnings: Record<string, FitWarning[]> = {}
  for (const s of sessions) warnings[s.id] = warningsOf(s, placement[s.id], placement, sessions, facts)
  return { placement, warnings }
}
