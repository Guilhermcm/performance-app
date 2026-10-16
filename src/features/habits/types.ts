// Habits pillar types. Dates are local YYYY-MM-DD in the profile's time zone; the week starts on
// Monday. `counted` is null until the check's day closes (D+2); then whether it fit under the
// habit's target for that week.
export type Habit = {
  id: string
  name: string
  icon: string
  per_week: number
  sort: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type HabitCheck = { habit_id: string; day: string; counted: boolean | null }
export type HabitTarget = { habit_id: string; week_start: string; target: number }
export type HabitDay = { day: string; checks: number; valid: number; xp: number }
export type HabitPeriod = { started_on: string; ended_on: string | null }
export type HabitHistory = {
  days: HabitDay[]
  checks: HabitCheck[]
  targets: HabitTarget[]
  periods: HabitPeriod[]
}
