// Sleep pillar types. Clock times are always 'HH:MM'; dates are local YYYY-MM-DD in the profile's
// time zone. A night is dated by the day the person woke up.
export type SleepLog = {
  night: string
  bed_time: string
  wake_time: string
  duration_min: number
  quality: number | null
  note: string | null
  updated_at: string
}

export type SleepTarget = { valid_from: string; goal_min: number; bed_target: string }

export type NightClass = { logged: boolean; on_target: boolean; rested: boolean; bed_diff_min: number | null }

export type SleepNight = NightClass & {
  night: string
  duration_min: number | null
  quality: number | null
  target: { goal_min: number; bed_target: string } | null
  xp: number
  bed_time: string | null
  wake_time: string | null
  note: string | null
}

export type SleepWeek = { start: string; target_hit: boolean }
export type SleepPeriod = { started_on: string; ended_on: string | null }
export type SleepHistory = { nights: SleepNight[]; weeks: SleepWeek[]; periods: SleepPeriod[] }
