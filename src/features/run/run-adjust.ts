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
// after the change get new indexes and ids (w{index}-s{k}); the weeks before never change.
import { weekOrder, weekStartOf } from '../../lib/format.js'
import { weekStartDate, weeksBetween, weekdayOf } from './dates'
import { FAMILIES, MIN_VDOT, isRace } from './models'
import { fitRestOfWeek, isReadable, planWeekStart, weekDate, type RunState } from './run-actions'
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

// Week `w` as plan week `index`: the index and the ids move along, the rest stays.
const renumbered = (w: Week, index: number): Week => ({
  ...w, index, sessions: w.sessions.map(s => ({ ...s, id: s.id.replace(/^w\d+-/, `w${index}-`) }))
})

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
  const sessions = prev.sessions.map((s, k) => ({ id: `w${index}-s${k + 1}`, type: s.type, blocks: JSON.parse(JSON.stringify(s.blocks)) }))
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
    plan.weeks = weeks.map((w, i) => (i > offset ? renumbered(w, i + 1) : w))
  }
  plan.dismissed = { ...(plan.dismissed || {}), [`weak:${index}`]: today, [`effort:${index}`]: today }
}

/**
 * Sets the plan's VDOT, with one decimal, from a race (`source` race) or a run, dated `date`. The
 * zone paces of every workout follow it (spec §5.3). A VDOT under the plan's usable floor
 * (MIN_VDOT), or not a number, changes nothing.
 */
export function updateVdot(S: RunState, vdot: number, source: 'race' | 'run', date: string): void {
  const plan = S.runPlan
  if (!isReadable(plan) || !Number.isFinite(vdot) || vdot < MIN_VDOT) return
  plan.vdot = Math.round(vdot * 10) / 10
  plan.vdotSource = source
  plan.vdotDate = date
}

/**
 * Records the race time, in minutes, of a race plan with a race date (plan Decision 10): the plan
 * keeps `raceResult` and takes the race's VDOT at the goal's distance, dated race day.
 */
export function recordRaceResult(S: RunState, minutes: number): void {
  const plan = S.runPlan
  if (!isReadable(plan) || !isRace(plan.goal) || !plan.raceDate || !Number.isFinite(minutes) || minutes <= 0) return
  plan.raceResult = { minutes }
  const distanceM = FAMILIES[plan.goal].distanceM
  if (distanceM) updateVdot(S, vdotFrom(distanceM, minutes), 'race', plan.raceDate)
}

/** "Not now": the suggestion's key goes into `dismissed` with `today` (plan Decision 11). */
export function dismissSuggestion(S: RunState, key: string, today: string): void {
  const plan = S.runPlan
  if (!isReadable(plan)) return
  plan.dismissed = { ...(plan.dismissed || {}), [key]: today }
}
