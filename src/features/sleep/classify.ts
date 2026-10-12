// Night classification (spec 4.2), mirrored from classify_sleep_night in 0022_sleep_close.sql.
// On target: asleep for at least the goal minus 15 minutes AND in bed within 45 minutes of the
// bedtime target (circular). Both bounds are inclusive. Rested: on target with quality 4 or more.
import { circularDiff } from './time'
import type { NightClass, SleepLog } from './types'

export const GOAL_SLACK_MIN = 15
export const BED_SLACK_MIN = 45
export const RESTED_QUALITY = 4

export function classifyNight(
  log: Pick<SleepLog, 'bed_time' | 'duration_min' | 'quality'> | null,
  target: { goal_min: number; bed_target: string } | null,
): NightClass {
  if (!log) return { logged: false, on_target: false, rested: false, bed_diff_min: null }
  if (!target) return { logged: true, on_target: false, rested: false, bed_diff_min: null }
  const bed_diff_min = circularDiff(log.bed_time, target.bed_target)
  const on_target = log.duration_min >= target.goal_min - GOAL_SLACK_MIN && bed_diff_min <= BED_SLACK_MIN
  const rested = on_target && (log.quality ?? 0) >= RESTED_QUALITY
  return { logged: true, on_target, rested, bed_diff_min }
}
