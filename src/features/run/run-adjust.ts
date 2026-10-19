// The plan adjustments the suggestions apply (spec §8.2, plan Decisions 9 to 11): repeating the
// previous week, updating the VDOT, recording the race result and putting a suggestion away. The
// mutations take the store's draft `S` and are meant for `update(S => ...)`; they never touch the
// strength week or the routines.
//
// Repeating the previous week (Decision 9) serves both "Repeat the week" (weak week) and "Step back
// a week" (high effort): the current week gets the previous week's workouts again, fitted to the
// days left from today on. With a race date the previous week comes in as a new week at the
// current position and the first base week ahead of it goes, so the race stays in the last week;
// with no base week ahead the current week is swapped in place and the goal becomes finishing.
// Without a race date the plan grows a week, up to 64 weeks (at 64 the week is swapped). Weeks
// after the change get new indexes and ids (w{index}-s{k}), and their `weak:` and `effort:` keys in
// `dismissed` move with them; the weeks before never change. The rebuilt week numbers its workouts
// after the replaced week's highest k, so no check-in linked to the replaced week matches them.
import { weekOrder, weekStartOf } from '../../lib/format.js'
import { weekStartDate, weeksBetween, weekdayOf } from './dates'
import { FAMILIES, MAX_VDOT, MIN_VDOT, isRace } from './models'
import { fitRestOfWeek, isReadable, planWeekStart, renumberWeek, weekDate, type RunState } from './run-actions'
import type { RunPlan, Week } from './types'
import { vdotFrom } from './vdot'

/** The most weeks a plan holds (the `planned.week` range of a run check-in). */
export const MAX_WEEKS = 64

export type RepeatPlan = {
  // The current week's position in plan.weeks (its weekOffset); the week repeated is at offset - 1.
  offset: number
  // insert: the previous week comes in at `offset` (with a race date, the first base week ahead
  // goes). swap: it takes the current week's place.
  mode: 'insert' | 'swap'
  // A race date and no base week ahead: the goal becomes finishing.
  tight: boolean
}

// The race date the plan keeps the race on: race goals only, as the rest of the plan reads it.
const raceDateOf = (plan: RunPlan) => (isRace(plan.goal) ? plan.raceDate : undefined)

/**
 * How repeating the previous week would change the plan on `today`, or null when it does not
 * apply: a maintain plan, week 1, a week before the plan or after its last week, and a current or
 * previous week of the maintain phase (the weeks a race plan may open with). `weekStart` is
 * S.weekStart, the fallback for plans saved without their own.
 */
export function repeatOf(plan: RunPlan | null | undefined, today: string, weekStart: 0 | 1): RepeatPlan | null {
  if (!isReadable(plan) || plan.goal === 'maintain' || today < plan.startDate) return null
  const offset = weeksBetween(weekDate(plan, 0, weekStart), weekStartDate(today, planWeekStart(plan, weekStart)))
  const weeks = plan.weeks
  if (offset < 1 || offset >= weeks.length) return null
  if (weeks[offset].phase === 'maintain' || weeks[offset - 1].phase === 'maintain') return null
  if (raceDateOf(plan)) {
    // After the insertion the old current week sits right after the new one, so it counts as ahead.
    const baseAhead = weeks.some((w, i) => i >= offset && w.phase === 'base')
    return baseAhead ? { offset, mode: 'insert', tight: false } : { offset, mode: 'swap', tight: true }
  }
  return { offset, mode: weeks.length < MAX_WEEKS ? 'insert' : 'swap', tight: false }
}

// The highest k of the ids w{n}-s{k} of week `w` (0 without sessions).
const lastK = (w: Week) => Math.max(0, ...w.sessions.map(s => Number(/-s(\d+)$/.exec(s.id)?.[1] ?? 0)))

const WEEK_KEY = /^(weak|effort):(\d+)$/

// The `weak:{n}` and `effort:{n}` keys follow their weeks when an insertion renumbers them
// (`moved`: old index to new index). A key of an index another week now holds goes; the others stay.
function movedKeys(dismissed: Record<string, string>, moved: Map<number, number>): Record<string, string> {
  const taken = new Set(moved.values())
  const out: Record<string, string> = {}
  for (const [key, date] of Object.entries(dismissed)) {
    const m = WEEK_KEY.exec(key)
    if (!m || (!moved.has(Number(m[2])) && !taken.has(Number(m[2])))) out[key] = date
  }
  for (const [key, date] of Object.entries(dismissed)) {
    const m = WEEK_KEY.exec(key)
    const to = m && moved.get(Number(m[2]))
    if (m && to) out[`${m[1]}:${to}`] = date
  }
  return out
}

/**
 * Repeats the previous week on `today` (plan Decision 9; see the top of this file). The new week
 * holds only workouts from today on, before the race in the race week. The suggestions this answers,
 * `weak:{index}` and `effort:{index}` of the current week, go into `dismissed` with `today`, since
 * the previous week stays as it was. Does nothing when repeatOf says it does not apply.
 */
export function repeatPreviousWeek(S: RunState, today: string): void {
  const plan = S.runPlan
  const ws = weekStartOf(S) as 0 | 1
  const how = repeatOf(plan, today, ws)
  if (!plan || !how) return
  const { offset } = how
  const index = offset + 1
  const prev = plan.weeks[offset - 1]
  const first = weekDate(plan, offset, ws)
  // The days left in the current week, today included.
  const pws = planWeekStart(plan, ws)
  const left = weekOrder(pws).slice((weekdayOf(today) - pws + 7) % 7)
  // New ids after the replaced week's: a check-in linked earlier this week to one of its workouts
  // must not match a workout of the new week (plan decision 8 matches by week index and id).
  const k0 = lastK(plan.weeks[offset])
  const sessions = prev.sessions.map((s, k) => ({ id: `w${index}-s${k0 + k + 1}`, type: s.type, blocks: JSON.parse(JSON.stringify(s.blocks)) }))
  const week: Week = { index, phase: prev.phase, recovery: prev.recovery, sessions: fitRestOfWeek(S, plan, sessions, first, left) }

  if (how.mode === 'swap') {
    plan.weeks[offset] = week
    if (how.tight) {
      plan.goalType = 'finish'
      delete plan.targetTime
    }
  } else {
    const weeks = [...plan.weeks.slice(0, offset), week, ...plan.weeks.slice(offset)]
    if (raceDateOf(plan)) weeks.splice(weeks.findIndex((w, i) => i > offset && w.phase === 'base'), 1)
    // The weeks ahead of the current one that moved, by their old index. The old current week
    // moves too, but its keys stay with the current position, which keeps the same previous week.
    const moved = new Map<number, number>()
    weeks.forEach((w, i) => { if (i > offset && w.index > index && w.index !== i + 1) moved.set(w.index, i + 1) })
    plan.weeks = weeks.map((w, i) => (i > offset ? renumberWeek(w, i + 1) : w))
    plan.dismissed = movedKeys(plan.dismissed || {}, moved)
  }
  plan.dismissed = { ...(plan.dismissed || {}), [`weak:${index}`]: today, [`effort:${index}`]: today }
}

// A VDOT the plan can take: a number from MIN_VDOT (a walk) to MAX_VDOT (a typo above it).
const usable = (vdot: number) => Number.isFinite(vdot) && vdot >= MIN_VDOT && vdot <= MAX_VDOT

/**
 * Sets the plan's VDOT, with one decimal, from a race (`source` race) or a run, dated `date`. The
 * zone paces of every workout follow it (spec §5.3). A VDOT under the plan's usable floor
 * (MIN_VDOT), above MAX_VDOT, or not a number, changes nothing.
 */
export function updateVdot(S: RunState, vdot: number, source: 'race' | 'run', date: string): void {
  const plan = S.runPlan
  if (!isReadable(plan) || !usable(vdot)) return
  plan.vdot = Math.round(vdot * 10) / 10
  plan.vdotSource = source
  plan.vdotDate = date
}

/**
 * Records the race time, in minutes, of a race plan with a race date (plan Decision 10): the plan
 * keeps `raceResult` and, when the race's VDOT at the goal's distance is usable (raceVdotOf), takes
 * it, dated race day. A slow honest time, a VDOT under MIN_VDOT, is kept with the VDOT unchanged, so
 * the paces stay as they were (or the plan stays by feel). A time that does not fit the race
 * (raceTimeFits) changes nothing.
 */
export function recordRaceResult(S: RunState, minutes: number): void {
  const plan = S.runPlan
  if (!isReadable(plan) || !raceTimeFits(plan, minutes)) return
  plan.raceResult = { minutes }
  const vdot = raceVdotOf(plan, minutes)
  if (vdot != null) updateVdot(S, vdot, 'race', plan.raceDate!)
}

// The race's VDOT at the goal's distance, or null without a race (a race goal with a race date)
// or a time in minutes.
function rawRaceVdot(plan: RunPlan | null | undefined, minutes: number): number | null {
  if (!isReadable(plan) || !isRace(plan.goal) || !plan.raceDate || !Number.isFinite(minutes) || minutes <= 0) return null
  const distanceM = FAMILIES[plan.goal].distanceM
  if (!distanceM) return null
  const vdot = vdotFrom(distanceM, minutes)
  return Number.isFinite(vdot) ? vdot : null
}

/**
 * Whether `minutes` can be this plan's race time: there is a race and the time gives a VDOT of
 * MAX_VDOT or less. A faster one is a typo, like "1:52" read as m:ss for a half marathon (R3 I1).
 * A slow one fits: nobody is blamed for walking a race.
 */
export function raceTimeFits(plan: RunPlan | null | undefined, minutes: number): boolean {
  const vdot = rawRaceVdot(plan, minutes)
  return vdot != null && vdot <= MAX_VDOT
}

/**
 * The VDOT the plan takes from a race time of `minutes`, or null when there is no race, the time
 * does not fit it (raceTimeFits) or its VDOT is under MIN_VDOT, where the paces stay as they were.
 */
export function raceVdotOf(plan: RunPlan | null | undefined, minutes: number): number | null {
  const vdot = rawRaceVdot(plan, minutes)
  return vdot != null && usable(vdot) ? vdot : null
}

/** "Not now": the suggestion's key goes into `dismissed` with `today` (plan Decision 11). */
export function dismissSuggestion(S: RunState, key: string, today: string): void {
  const plan = S.runPlan
  if (!isReadable(plan)) return
  plan.dismissed = { ...(plan.dismissed || {}), [key]: today }
}
