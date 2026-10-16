// Habits week rules, mirroring the server (close_habit_days and award_xp in 0027; spec 3.3, 4, 5.1).
// All dates are local YYYY-MM-DD strings; the week starts on Monday.
import { weekStartOf } from '../gamification/xp'
import { shiftDay } from '../nutrition/days'
import type { Habit, HabitCheck, HabitHistory } from './types'

type Check = Pick<HabitCheck, 'habit_id' | 'day'>
type Sorted = Pick<Habit, 'id' | 'sort'>

const WEEK_XP = 600

// Days left in the week counting today: 8 minus the ISO weekday (Monday 1 ... Sunday 7).
export function daysLeft(today: string): number {
  const dow = new Date(today + 'T00:00:00Z').getUTCDay() || 7
  return 8 - dow
}

// Target of a habit created today (spec 3.3): it cannot ask for more days than the week has left.
export function newTarget(perWeek: number, today: string): number {
  return Math.min(perWeek, daysLeft(today))
}

const byDayThenHabit = (order: Map<string, number>) => (a: Check, b: Check) => {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  const sa = order.get(a.habit_id) ?? Infinity
  const sb = order.get(b.habit_id) ?? Infinity
  if (sa !== sb) return sa - sb
  return a.habit_id < b.habit_id ? -1 : a.habit_id > b.habit_id ? 1 : 0
}

// A habit's valid checks are its first `target` checks by day. Result in emission order: by day,
// then habits.sort, then habit id. Habits without a target (or not listed) have none.
export function validChecks(
  checks: Check[], targets: Record<string, number>, habits: Sorted[],
): Check[] {
  const order = new Map(habits.map(h => [h.id, h.sort]))
  const cmp = byDayThenHabit(order)
  const seen = new Set<string>()
  const left = new Map<string, number>()
  const valid: Check[] = []
  for (const c of [...checks].sort(cmp)) {
    const key = c.habit_id + '|' + c.day
    if (seen.has(key) || !order.has(c.habit_id)) continue
    seen.add(key)
    const room = left.get(c.habit_id) ?? (targets[c.habit_id] ?? 0)
    if (room <= 0) continue
    left.set(c.habit_id, room - 1)
    valid.push(c)
  }
  return valid.sort(cmp)
}

// Q = sum of the targets, C = sum of min(checks, target). `done` counts every check of the habit.
export function weekSummary(
  checks: Check[], targets: Record<string, number>, habits: Sorted[],
): { q: number; c: number; byHabit: Record<string, { target: number; done: number; valid: number }> } {
  const valid = validChecks(checks, targets, habits)
  const byHabit: Record<string, { target: number; done: number; valid: number }> = {}
  for (const h of habits) byHabit[h.id] = { target: targets[h.id] ?? 0, done: 0, valid: 0 }
  const seen = new Set<string>()
  for (const c of checks) {
    const key = c.habit_id + '|' + c.day
    if (seen.has(key) || !byHabit[c.habit_id]) continue
    seen.add(key)
    byHabit[c.habit_id].done++
  }
  for (const c of valid) byHabit[c.habit_id].valid++
  const q = Object.values(byHabit).reduce((s, h) => s + h.target, 0)
  return { q, c: valid.length, byHabit }
}

export type HabitReason = 'habit_check' | 'habit_day' | 'habit_week_target'

// The XP the week pays, in the order the server emits it (plan decision 7). A valid check pays
// round(600 / P), P = max(Q, 7), never more than what is left of 600; with Q >= 7 the Q-th pays the
// rest. Each day with a valid check pays 30; the week pays on the day C reaches Q: 150 with Q >= 7,
// else round(150 * Q / 7). Maximum per week: 960.
export function habitWeekAwards(week: {
  habits: { id: string; sort: number; target: number }[]
  checks: { habit: string; day: string }[]
}): { reason: HabitReason; amount: number; ref: string }[] {
  const targets = Object.fromEntries(week.habits.map(h => [h.id, h.target]))
  const q = week.habits.reduce((s, h) => s + h.target, 0)
  const valid = validChecks(week.checks.map(c => ({ habit_id: c.habit, day: c.day })), targets, week.habits)
  const weekStart = valid.length ? weekStartOf(valid[0].day) : ''
  const each = Math.round(WEEK_XP / Math.max(q, 7))
  const awards: { reason: HabitReason; amount: number; ref: string }[] = []
  let paid = 0
  let n = 0
  for (let i = 0; i < valid.length; i++) {
    const { habit_id, day } = valid[i]
    n++
    const amount = q >= 7 && n === q ? WEEK_XP - paid : Math.min(each, WEEK_XP - paid)
    if (amount > 0) {
      awards.push({ reason: 'habit_check', amount, ref: `habit:${habit_id}:${day}` })
      paid += amount
    }
    if (valid[i + 1]?.day === day) continue
    awards.push({ reason: 'habit_day', amount: 30, ref: `habits:${day}` })
    if (q > 0 && n >= q && !awards.some(a => a.reason === 'habit_week_target')) {
      const bonus = q >= 7 ? 150 : Math.round((150 * q) / 7)
      if (bonus > 0) awards.push({ reason: 'habit_week_target', amount: bonus, ref: `habits-week:${weekStart}` })
    }
  }
  return awards
}

// "Late" on a card (plan decision 11): the missing checks need every day still available. Today
// counts as available only while the habit has not been checked today.
export function lateness(
  target: number, done: number, checkedToday: boolean, today: string,
): { late: boolean; missing: number; days: number } {
  const missing = Math.max(0, target - done)
  const days = daysLeft(today) - (checkedToday ? 1 : 0)
  return { late: missing > 0 && missing >= days, missing, days }
}

// Habits still missing checks first, then the complete ones; `sort` decides inside each group.
export function cardOrder<T extends { sort: number; done: number; target: number }>(rows: T[]): T[] {
  const missing = (r: T) => r.done < r.target
  return [...rows].sort((a, b) => Number(!missing(a)) - Number(!missing(b)) || a.sort - b.sort)
}

// Consecutive judged weeks (week_start <= today - 8, so the week closed at least 2 days ago) where
// the habit had a target above 0 and its counted checks reached it, from the latest one backwards.
// A week without a target row ends the run.
export function habitRun(
  habitId: string, history: Pick<HabitHistory, 'targets' | 'checks'>, today: string,
): number {
  const targets = new Map<string, number>()
  for (const t of history.targets) if (t.habit_id === habitId) targets.set(t.week_start, t.target)
  const counted = new Map<string, number>()
  for (const c of history.checks) {
    if (c.habit_id !== habitId || c.counted !== true) continue
    const ws = weekStartOf(c.day)
    counted.set(ws, (counted.get(ws) ?? 0) + 1)
  }
  let run = 0
  for (let ws = weekStartOf(shiftDay(today, -8)); ; ws = shiftDay(ws, -7)) {
    const target = targets.get(ws)
    if (!target || (counted.get(ws) ?? 0) < target) break
    run++
  }
  return run
}

export type WeekDot = { day: string; checked: boolean; markable: boolean }

// The seven days of the week of `today`, Monday first, for one habit (spec 7.3): whether it has a
// check, and whether it can still change (today and yesterday). On Monday yesterday is in the week
// before, so only today is markable; Sunday goes through the calendar's day sheet (plan decision 14).
export function weekDots(habitId: string, checks: Check[], today: string): WeekDot[] {
  const ws = weekStartOf(today)
  const yesterday = shiftDay(today, -1)
  const mine = new Set(checks.filter(c => c.habit_id === habitId).map(c => c.day))
  return Array.from({ length: 7 }, (_, i) => {
    const day = shiftDay(ws, i)
    return { day, checked: mine.has(day), markable: day === today || day === yesterday }
  })
}
