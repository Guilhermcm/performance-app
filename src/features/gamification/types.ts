import type { Pillar } from '@/lib/database.types'
import type { AchievementStats } from './achievements'
import type { LevelInfo } from './xp'

export type { LevelInfo }

export type PillarProgress = LevelInfo & { xp: number }

// The pillars of the roadmap; the radar has one axis per pillar, released or not.
export type PillarKey = 'strength' | 'nutrition' | 'sleep' | 'habits'

export type WeekProgress = {
  start: string
  xp: number
  max: number
  target: number
  workouts: number
  extras: number
  prs: number
  target_hit: boolean
  weighed_today: boolean
  // The week's XP by pillar; bonus is the general XP (badges, challenges). sleep is missing from a
  // progress cached before the sleep pillar existed.
  pillars: { strength: number; nutrition: number; sleep?: number; bonus: number }
}

// The owner's nutrition block (my_progress_extras, 0012_nutrition_progress.sql).
export type NutritionProgress = {
  target: number
  on_target: number
  logged: number
  streak: { current: number; best: number; shields: number }
  confirms_on: string
  last_closed: { day: string; logged: boolean; on_target: boolean; balanced: boolean; xp: number } | null
  last_week: { start: string; target_hit: boolean } | null
}

// The owner's Treino block (my_progress_extras, 0019_training_days.sql), once a check-in was ever
// posted: the day today's check-ins are confirmed (today + 2) and the last closed day that paid.
export type TrainingProgress = {
  confirms_on: string
  last_closed: { day: string; detailed: boolean; xp: number } | null
}

// The owner's sleep block (my_progress_extras, 0023_sleep_progress.sql), once the pillar was ever
// turned on: T of the running week, its closed nights on target and logged, the sleep_week streak,
// the day tonight closes (today + 2), the last closed night with the XP it paid and the last week
// whose seven nights closed.
export type SleepProgress = {
  target: number
  on_target: number
  logged: number
  streak: { current: number; best: number; shields: number }
  confirms_on: string
  last_closed: { night: string; logged: boolean; on_target: boolean; rested: boolean; xp: number } | null
  last_week: { start: string; target_hit: boolean } | null
}

// Consistency over the last 4 closed weeks and the 4 before them, 0 to 1; null without an active week.
export type RadarPoint = { current: number | null; previous: number | null }

// The answer of get_my_progress (supabase/migrations/0012_nutrition_progress.sql).
export type Progress = {
  today: string
  total_xp: number
  level: LevelInfo
  pillars: Partial<Record<Pillar, PillarProgress>>
  week: WeekProgress
  streak: { current: number; best: number; shields: number }
  achievements: { code: string; unlocked_at: string }[]
  stats: AchievementStats
  // Only once the nutrition pillar was ever turned on.
  nutrition?: NutritionProgress
  // Only once a check-in was ever posted.
  training?: TrainingProgress
  // Only once the sleep pillar was ever turned on.
  sleep?: SleepProgress
  radar: Partial<Record<PillarKey, RadarPoint>>
  // Not from get_my_progress: the check-in cutover (app_settings.training_checkin_since), read next
  // to it. From that day on live workouts, PRs and weigh-ins pay no XP. Null on a server without it.
  training_since?: string | null
}

export type XpLine =
  | { kind: 'workout'; amount: number; index: number; of: number }
  | { kind: 'extra'; amount: number }
  | { kind: 'goal'; amount: number }
  | { kind: 'pr'; amount: number; count: number }
  | { kind: 'weight'; amount: number }
  | { kind: 'achievement'; amount: number; code: string }
  | { kind: 'other'; amount: number }

// viaCheckin: a workout on or after the check-in cutover, whose day is paid by its check-in.
export type XpPreview = { lines: XpLine[]; total: number; viaCheckin?: boolean }

// pillar_level: a pillar's own level went up (the overall one is 'level'). week_target: the nutrition
// or sleep weekly goal was met in a closed week; the strength goal stays in the post-workout summary.
export type Celebration =
  | { kind: 'level'; level: number }
  | { kind: 'achievement'; code: string }
  | { kind: 'pillar_level'; pillar: PillarKey; level: number }
  | { kind: 'week_target'; pillar: 'nutrition' | 'sleep'; week_start: string }

// confirmed: the event queue was empty when the progress was read, so it already counts them.
export type SyncResult = { progress: Progress | null; confirmed: boolean }
