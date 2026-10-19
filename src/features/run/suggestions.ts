// The running plan's suggestions (spec §8.2, plan Decisions 9 to 11): one at a time, in this order.
//
// 1. Race passed: the day after `raceDate`, with no `raceResult`, ask for the race time.
// 2. Weak week: less than half of last week's workouts done → repeat it.
// 3. High effort: in each of the two weeks before this one, two or more Leve or Longão runs linked
//    to the plan with rpe 8 or more → step back a week.
// 4. Faster: a run of 3 km or more at rpe 8 or more whose VDOT (distance and duration) is above the
//    plan's, or a plan without one → update the paces.
//
// Rules 2 and 3 judge whole calendar weeks behind the current one (plan decision 8, progress.ts),
// never a maintain plan or maintain-phase weeks, and not once the plan is over (repeatOf). A key
// holds what its condition is about (`race:{raceDate}`, `weak:{week}`, `effort:{week}` with the
// current week's index, `faster:{check-in id}`), so a key put away in `dismissed` never comes back
// and the next rule shows instead. There is no suggestion to move ahead a week. Pure, no React.
import { addDays } from './dates'
import { MIN_VDOT, isRace } from './models'
import { weekSummary } from './progress'
import { repeatOf } from './run-adjust'
import { isReadable, weekDate } from './run-actions'
import type { RunLog } from './run-log'
import type { RunPlan } from './types'
import { vdotFrom } from './vdot'

export type Suggestion =
  | { key: string; kind: 'race_result'; raceDate: string }
  | { key: string; kind: 'repeat_week'; week: number; tight: boolean }
  | { key: string; kind: 'step_back'; week: number; tight: boolean }
  | { key: string; kind: 'faster'; vdot: number; checkinId: string; day: string }

// The rpe from which a run counts as hard (rules 3 and 4), and the shortest run rule 4 reads.
const HARD_RPE = 8
const MIN_KM = 3

// The Leve and Longão workouts linked to the plan, run at rpe 8 or more, in the calendar week at
// `offset`. Two check-ins for one workout count it once.
function hardEasyRuns(plan: RunPlan, offset: number, logs: RunLog[], weekStart: 0 | 1): number {
  const first = weekDate(plan, offset, weekStart)
  const last = addDays(first, 6)
  const sessions = new Set<string>()
  for (const l of logs) {
    const p = l.run?.planned
    if (l.day < first || l.day > last || l.day < plan.startDate || !p) continue
    if ((p.type === 'easy' || p.type === 'long') && (l.run?.rpe ?? 0) >= HARD_RPE) sessions.add(p.session)
  }
  return sessions.size
}

// Rule 4's runs from the plan start to today, the highest VDOT first (then the latest).
function fasterRuns(plan: RunPlan, logs: RunLog[], today: string): { vdot: number; log: RunLog }[] {
  const out: { vdot: number; log: RunLog }[] = []
  for (const l of logs) {
    const km = l.run?.distance_km
    const min = l.duration_min
    if (l.day < plan.startDate || l.day > today || !km || km < MIN_KM || (l.run?.rpe ?? 0) < HARD_RPE) continue
    if (typeof min !== 'number' || !(min > 0)) continue
    const vdot = vdotFrom(km * 1000, min)
    if (!Number.isFinite(vdot) || vdot < MIN_VDOT || (plan.vdot != null && vdot <= plan.vdot)) continue
    out.push({ vdot, log: l })
  }
  return out.sort((a, b) => b.vdot - a.vdot || (a.log.day < b.log.day ? 1 : a.log.day > b.log.day ? -1 : 0))
}

/**
 * The suggestion to show on `today`, or null: the first rule that holds whose key is not in
 * `plan.dismissed`. `logs` are the person's run check-ins (useRunLogs); `weekStart` is S.weekStart,
 * the fallback for plans saved without their own.
 */
export function nextSuggestion(plan: RunPlan | null, logs: RunLog[], today: string, weekStart: 0 | 1): Suggestion | null {
  if (!isReadable(plan)) return null
  const dismissed = plan.dismissed || {}
  const open = (s: Suggestion) => !(s.key in dismissed)

  if (isRace(plan.goal) && plan.raceDate && today > plan.raceDate && !plan.raceResult) {
    const s: Suggestion = { key: `race:${plan.raceDate}`, kind: 'race_result', raceDate: plan.raceDate }
    if (open(s)) return s
  }

  const repeat = repeatOf(plan, today, weekStart)
  if (repeat) {
    const { offset, tight } = repeat
    const week = plan.weeks[offset].index
    const last = weekSummary(plan, offset - 1, logs, weekStart)
    if (last.planned > 0 && last.done * 2 < last.planned) {
      const s: Suggestion = { key: `weak:${week}`, kind: 'repeat_week', week, tight }
      if (open(s)) return s
    }
    const twoBehind = offset >= 2 && plan.weeks[offset - 2].phase !== 'maintain'
    if (twoBehind && hardEasyRuns(plan, offset - 1, logs, weekStart) >= 2 && hardEasyRuns(plan, offset - 2, logs, weekStart) >= 2) {
      const s: Suggestion = { key: `effort:${week}`, kind: 'step_back', week, tight }
      if (open(s)) return s
    }
  }

  for (const { vdot, log } of fasterRuns(plan, logs, today)) {
    const s: Suggestion = { key: `faster:${log.id}`, kind: 'faster', vdot, checkinId: log.id, day: log.day }
    if (open(s)) return s
  }
  return null
}
