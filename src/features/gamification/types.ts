import type { Pillar } from '@/lib/database.types'
import type { AchievementStats } from './achievements'
import type { LevelInfo } from './xp'

export type { LevelInfo }

export type PillarProgress = LevelInfo & { xp: number }

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
}

// The answer of get_my_progress (supabase/migrations/0002_gamification.sql).
export type Progress = {
  today: string
  total_xp: number
  level: LevelInfo
  pillars: Partial<Record<Pillar, PillarProgress>>
  week: WeekProgress
  streak: { current: number; best: number; shields: number }
  achievements: { code: string; unlocked_at: string }[]
  stats: AchievementStats
}

export type XpLine =
  | { kind: 'workout'; amount: number; index: number; of: number }
  | { kind: 'extra'; amount: number }
  | { kind: 'goal'; amount: number }
  | { kind: 'pr'; amount: number; count: number }
  | { kind: 'weight'; amount: number }
  | { kind: 'achievement'; amount: number; code: string }
  | { kind: 'other'; amount: number }

export type XpPreview = { lines: XpLine[]; total: number }

export type Celebration = { kind: 'level'; level: number } | { kind: 'achievement'; code: string }

// confirmed: the event queue was empty when the progress was read, so it already counts them.
export type SyncResult = { progress: Progress | null; confirmed: boolean }
