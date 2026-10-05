import type { DayClass } from '@/features/nutrition/types'

// The XP rules of the strength pillar, mirrored from supabase/migrations/0002_gamification.sql
// (session_xp, level_for, award_xp, close_weeks). The server is the authority; this file drives the
// preview shown before it answers. supabase/tests/fixtures/xp-scenarios.json runs against both
// sides, so a rule changed on one side only fails a test.

export const WEEK_SESSIONS_XP = 600
export const WEEK_TARGET_BONUS = 150
export const EXTRA_XP = 25
export const EXTRA_LIMIT = 2
export const PR_XP = 30
export const PR_LIMIT = 3
export const WEIGHT_XP = 10
export const WEEK_MAX = WEEK_SESSIONS_XP + WEEK_TARGET_BONUS + EXTRA_XP * EXTRA_LIMIT + PR_XP * PR_LIMIT + WEIGHT_XP * 7
export const SHIELD_EVERY = 4
export const SHIELD_MAX = 2

export type XpReason = 'workout' | 'workout_extra' | 'week_target' | 'pr' | 'weight'
export type XpEvent = { kind: 'workout_completed' | 'pr' | 'weight_logged'; on: string; ref: string }
export type XpAward = { reason: XpReason; amount: number; week: string }
export type LevelInfo = { level: number; into: number; need: number }
export type WeekCounts = { workouts: number; extras: number; prs: number }
export type StreakState = { current: number; best: number; shields: number }
type Pay = { reason: XpReason; amount: number }

// The index-th planned session of a week (1-based). The T-th takes the remainder, so a week's
// planned sessions always add up to 600 (T = 7: six of 86 and one of 84).
export function sessionXp(target: number, index: number): number {
  const each = Math.round(WEEK_SESSIONS_XP / target)
  return index < target ? each : WEEK_SESSIONS_XP - each * (target - 1)
}

// Monday of the week a local YYYY-MM-DD belongs to.
export function weekStartOf(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

// Level n needs 100 + 50·(n − 1) XP to reach n + 1.
export function levelFor(totalXp: number): LevelInfo {
  let left = Math.max(0, Math.floor(totalXp))
  let level = 1
  let need = 100
  while (left >= need) {
    left -= need
    level++
    need = 100 + 50 * (level - 1)
  }
  return { level, into: left, need }
}

// What one more workout pays, given what the week already paid.
export function workoutAwards(c: WeekCounts, target: number): Pay[] {
  if (c.workouts < target) {
    const out: Pay[] = [{ reason: 'workout', amount: sessionXp(target, c.workouts + 1) }]
    if (c.workouts + 1 === target) out.push({ reason: 'week_target', amount: WEEK_TARGET_BONUS })
    return out
  }
  return c.extras < EXTRA_LIMIT ? [{ reason: 'workout_extra', amount: EXTRA_XP }] : []
}

export function prAwards(c: WeekCounts): Pay[] {
  return c.prs < PR_LIMIT ? [{ reason: 'pr', amount: PR_XP }] : []
}

// Replays events in arrival order, the way award_xp sees them. A repeated (kind, ref) pays once,
// as the unique key on activity_events does; a weigh-in pays once per day.
export function replay(events: XpEvent[], targetFor: (week: string) => number): XpAward[] {
  const seen = new Set<string>()
  const weighed = new Set<string>()
  const weeks = new Map<string, WeekCounts>()
  const out: XpAward[] = []
  for (const ev of events) {
    const key = ev.kind + '|' + ev.ref
    if (seen.has(key)) continue
    seen.add(key)
    const week = weekStartOf(ev.on)
    const c = weeks.get(week) ?? { workouts: 0, extras: 0, prs: 0 }
    weeks.set(week, c)
    let pays: Pay[] = []
    if (ev.kind === 'workout_completed') pays = workoutAwards(c, targetFor(week))
    else if (ev.kind === 'pr') pays = prAwards(c)
    else if (!weighed.has(ev.on)) { weighed.add(ev.on); pays = [{ reason: 'weight', amount: WEIGHT_XP }] }
    for (const p of pays) {
      if (p.reason === 'workout') c.workouts++
      else if (p.reason === 'workout_extra') c.extras++
      else if (p.reason === 'pr') c.prs++
      out.push({ ...p, week })
    }
  }
  return out
}

// Judges closed weeks in order, as close_weeks does.
export function streakAfter(hits: boolean[], start: StreakState = { current: 0, best: 0, shields: 0 }): StreakState {
  let { current, best, shields } = start
  for (const hit of hits) {
    if (hit) {
      current++
      best = Math.max(best, current)
      if (current % SHIELD_EVERY === 0) shields = Math.min(SHIELD_MAX, shields + 1)
    } else if (current > 0 && shields > 0) {
      shields--
    } else {
      current = 0
    }
  }
  return { current, best, shields }
}

// Nutrition pillar (spec 6.3), mirrored from the nutrition branch of award_xp in
// 0010_nutrition_close.sql. Reuses sessionXp and weekStartOf: on-target days up to the T-th pay
// sessionXp(T, i), the T-th also pays the weekly bonus, extras and balanced days have weekly caps.
export const NUTRITION_EXTRA_XP = 25
export const NUTRITION_EXTRA_LIMIT = 2
export const NUTRITION_BALANCED_XP = 30
export const NUTRITION_BALANCED_LIMIT = 3
export const NUTRITION_LOGGED_XP = 10

export type NutritionReason =
  | 'nutrition_day'
  | 'nutrition_day_extra'
  | 'nutrition_week_target'
  | 'nutrition_balanced'
  | 'nutrition_logged'

// Days in closing order (the server closes them oldest first). Per day the order is logged,
// on target (with the weekly bonus on the T-th), balanced, as the cron emits the events.
export function nutritionWeekAwards(
  days: { on: string; classes: DayClass }[],
  target: number,
): { reason: NutritionReason; amount: number; week: string }[] {
  const weeks = new Map<string, { days: number; extras: number; balanced: number }>()
  const out: { reason: NutritionReason; amount: number; week: string }[] = []
  for (const d of days) {
    const week = weekStartOf(d.on)
    const c = weeks.get(week) ?? { days: 0, extras: 0, balanced: 0 }
    weeks.set(week, c)
    const pay = (reason: NutritionReason, amount: number) => out.push({ reason, amount, week })
    if (d.classes.logged) pay('nutrition_logged', NUTRITION_LOGGED_XP)
    if (d.classes.on_target) {
      if (c.days < target) {
        c.days++
        pay('nutrition_day', sessionXp(target, c.days))
        if (c.days === target) pay('nutrition_week_target', WEEK_TARGET_BONUS)
      } else if (c.extras < NUTRITION_EXTRA_LIMIT) {
        c.extras++
        pay('nutrition_day_extra', NUTRITION_EXTRA_XP)
      }
    }
    if (d.classes.balanced && c.balanced < NUTRITION_BALANCED_LIMIT) {
      c.balanced++
      pay('nutrition_balanced', NUTRITION_BALANCED_XP)
    }
  }
  return out
}
