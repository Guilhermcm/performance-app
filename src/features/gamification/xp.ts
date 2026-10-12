import type { DayClass } from '@/features/nutrition/types'
import type { NightClass } from '@/features/sleep/types'

// The XP rules of the strength pillar (shown as Treino), mirrored from
// supabase/migrations/0002_gamification.sql (session_xp, level_for, award_xp, close_weeks) and, since
// the check-in cutover, from the training branch of award_xp in 0019_training_days.sql with the PR
// and weigh-in cutoff of 0020_checkin_feed.sql. The server is the authority; this file drives the
// preview shown before it answers. supabase/tests/fixtures/xp-scenarios.json and
// training-scenarios.json run against both sides, so a rule changed on one side only fails a test.

export const WEEK_SESSIONS_XP = 600
export const WEEK_TARGET_BONUS = 150
export const EXTRA_XP = 25
export const EXTRA_LIMIT = 2
export const PR_XP = 30
export const PR_LIMIT = 3
export const WEIGHT_XP = 10
export const WEEK_MAX = WEEK_SESSIONS_XP + WEEK_TARGET_BONUS + EXTRA_XP * EXTRA_LIMIT + PR_XP * PR_LIMIT + WEIGHT_XP * 7
// From the cutover (app_settings.training_checkin_since) days are paid by their check-in when they
// close (spec 5.1): a detailed day takes the place of a PR and the day with a photo that of a
// weigh-in, so the week still tops out at 960.
export const TRAINING_DETAILED_XP = 30
export const TRAINING_DETAILED_LIMIT = 3
export const TRAINING_LOGGED_XP = 10
export const TRAINING_WEEK_MAX = WEEK_SESSIONS_XP + WEEK_TARGET_BONUS + EXTRA_XP * EXTRA_LIMIT
  + TRAINING_DETAILED_XP * TRAINING_DETAILED_LIMIT + TRAINING_LOGGED_XP * 7
export const SHIELD_EVERY = 4
export const SHIELD_MAX = 2

export type XpReason =
  | 'workout' | 'workout_extra' | 'week_target' | 'pr' | 'weight'
  | 'training_day' | 'training_day_extra' | 'training_week_target' | 'training_detailed' | 'training_logged'
export type XpEvent = {
  kind: 'workout_completed' | 'pr' | 'weight_logged' | 'training_day' | 'training_detailed'
  on: string
  ref: string
}
export type XpAward = { reason: XpReason; amount: number; week: string }
export type LevelInfo = { level: number; into: number; need: number }
export type WeekCounts = { workouts: number; extras: number; prs: number }
export type StreakState = { current: number; best: number; shields: number }
type Pay = { reason: XpReason; amount: number }

// A day on or after the cutover: a live workout, a PR or a weigh-in on it pays no XP (the day is
// paid by its check-in). Without a cutover (a server from before check-ins) nothing is.
export const afterCutover = (day: string, since: string | null | undefined): boolean => !!since && day >= since

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
// as the unique key on activity_events does; a weigh-in pays once per day. `since` is the check-in
// cutover: from it on, live workouts, PRs and weigh-ins pay nothing, and a closed training day pays
// 10 for the day, then its place toward the goal (old and new days count together), and a detailed
// day 30, three a week. A live workout before the cutover on a day its check-in already paid is not
// paid again.
export function replay(events: XpEvent[], targetFor: (week: string) => number, since: string | null = null): XpAward[] {
  const seen = new Set<string>()
  const weighed = new Set<string>()
  const logged = new Set<string>()
  const weeks = new Map<string, WeekCounts & { detailed: number; hit: boolean }>()
  const out: XpAward[] = []
  for (const ev of events) {
    const key = ev.kind + '|' + ev.ref
    if (seen.has(key)) continue
    seen.add(key)
    const week = weekStartOf(ev.on)
    const c = weeks.get(week) ?? { workouts: 0, extras: 0, prs: 0, detailed: 0, hit: false }
    weeks.set(week, c)
    let pays: Pay[] = []
    if (ev.kind === 'workout_completed') {
      if (!afterCutover(ev.on, since) && !logged.has(ev.on)) pays = dayAwards(c, targetFor(week), false)
    } else if (ev.kind === 'training_day') {
      if (!logged.has(ev.on)) { logged.add(ev.on); pays.push({ reason: 'training_logged', amount: TRAINING_LOGGED_XP }) }
      pays.push(...dayAwards(c, targetFor(week), true))
    } else if (ev.kind === 'training_detailed') {
      if (c.detailed < TRAINING_DETAILED_LIMIT) pays = [{ reason: 'training_detailed', amount: TRAINING_DETAILED_XP }]
    } else if (afterCutover(ev.on, since)) {
      pays = []
    } else if (ev.kind === 'pr') pays = prAwards(c)
    else if (!weighed.has(ev.on)) { weighed.add(ev.on); pays = [{ reason: 'weight', amount: WEIGHT_XP }] }
    for (const p of pays) {
      if (p.reason === 'workout' || p.reason === 'training_day') c.workouts++
      else if (p.reason === 'workout_extra' || p.reason === 'training_day_extra') c.extras++
      else if (p.reason === 'week_target' || p.reason === 'training_week_target') c.hit = true
      else if (p.reason === 'pr') c.prs++
      else if (p.reason === 'training_detailed') c.detailed++
      out.push({ ...p, week })
    }
  }
  return out
}

// A day toward the week's goal, from a live workout (old reasons) or a check-in (training reasons).
// One goal bonus a week across both.
function dayAwards(c: WeekCounts & { hit: boolean }, target: number, checkin: boolean): Pay[] {
  return workoutAwards(c, target)
    .filter(p => p.reason !== 'week_target' || !c.hit)
    .map(p => (checkin ? { ...p, reason: TRAINING_REASON[p.reason as 'workout' | 'workout_extra' | 'week_target'] } : p))
}
const TRAINING_REASON = { workout: 'training_day', workout_extra: 'training_day_extra', week_target: 'training_week_target' } as const

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

// Sleep pillar (spec 4.2), mirrored from the sleep branch of award_xp in 0022_sleep_close.sql.
// Same shape as nutrition: on-target nights up to the T-th pay sessionXp(T, i), the T-th also pays
// the weekly bonus, extras are capped, a rested night pays a capped bonus and every logged night
// pays a little. The weekly cap is the same 960.
export const SLEEP_EXTRA_XP = 25
export const SLEEP_EXTRA_LIMIT = 2
export const SLEEP_RESTED_XP = 30
export const SLEEP_RESTED_LIMIT = 3
export const SLEEP_LOGGED_XP = 10

export type SleepReason =
  | 'sleep_night'
  | 'sleep_night_extra'
  | 'sleep_week_target'
  | 'sleep_rested'
  | 'sleep_logged'

// Nights in closing order (oldest first). Per night the order is logged, on target (with the
// weekly bonus on the T-th), rested, as the cron emits the events.
export function sleepWeekAwards(
  nights: { on: string; classes: Omit<NightClass, 'bed_diff_min'> }[],
  target: number,
): { reason: SleepReason; amount: number; week: string }[] {
  const weeks = new Map<string, { nights: number; extras: number; rested: number }>()
  const out: { reason: SleepReason; amount: number; week: string }[] = []
  for (const n of nights) {
    const week = weekStartOf(n.on)
    const c = weeks.get(week) ?? { nights: 0, extras: 0, rested: 0 }
    weeks.set(week, c)
    const pay = (reason: SleepReason, amount: number) => out.push({ reason, amount, week })
    if (n.classes.logged) pay('sleep_logged', SLEEP_LOGGED_XP)
    if (n.classes.on_target) {
      if (c.nights < target) {
        c.nights++
        pay('sleep_night', sessionXp(target, c.nights))
        if (c.nights === target) pay('sleep_week_target', WEEK_TARGET_BONUS)
      } else if (c.extras < SLEEP_EXTRA_LIMIT) {
        c.extras++
        pay('sleep_night_extra', SLEEP_EXTRA_XP)
      }
    }
    if (n.classes.rested && c.rested < SLEEP_RESTED_LIMIT) {
      c.rested++
      pay('sleep_rested', SLEEP_RESTED_XP)
    }
  }
  return out
}
