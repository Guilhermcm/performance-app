// The sleep goal: the one in force on a night, and the setup's defaults (spec 3.1).
import type { SleepTarget } from './types'

export const DEFAULT_GOAL = 480
export const DEFAULT_BED = '23:00'
export const DEFAULT_NIGHTS = 5

// The goal in force on a night: the latest one that started on or before it.
export function targetAt(targets: SleepTarget[], night: string): SleepTarget | null {
  let found: SleepTarget | null = null
  for (const x of targets) if (x.valid_from <= night && (!found || x.valid_from > found.valid_from)) found = x
  return found
}

// A goal row as a night carries it: hours and bedtime, without the day it started.
export const goalOf = (x: SleepTarget | null): { goal_min: number; bed_target: string } | null =>
  (x ? { goal_min: x.goal_min, bed_target: x.bed_target } : null)
