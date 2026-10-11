import { useCheckins } from './useCheckins'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { useToday } from '../nutrition/use-today'
import { shiftDay } from '../nutrition/days'
import { weekStartOf } from '../gamification/xp'

// Days of the week [from, to] with at least one check-in: several posts on a day count once, as the
// server counts training days (spec 3.2).
export function trainingDaysIn(rows: { day: string }[], from: string, to: string): number {
  return new Set(rows.filter(r => r.day >= from && r.day <= to).map(r => r.day)).size
}

// This week's training days against the Treino goal, for the Plan: the check-ins on this phone
// (posted or still going up) count at once, before the server confirms the days at D+2. The week
// is the pillar's, Monday first, in the profile's time zone; the goal is the one the server froze
// for it, else the profile's days per week. Null without a signed-in account.
export function useWeekTraining(): { days: number; target: number } | null {
  const userId = useCheckins(s => s.userId)
  const mine = useCheckins(s => s.mine)
  const tz = useProfile(s => s.profile?.timezone)
  const perWeek = useProfile(s => s.profile?.days_per_week)
  const week = useProgress(s => s.progress?.week)
  const today = useToday(tz)
  if (!userId) return null
  const from = weekStartOf(today)
  const target = week?.start === from && week.target ? week.target : perWeek ?? 3
  return { days: trainingDaysIn(mine, from, shiftDay(from, 6)), target }
}
