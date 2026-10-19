// How the person is doing on the running plan (spec §8.1, plan decision 8): which workouts of a
// week are done, the week's minutes and km, the volume per week and the milestones. Pure, no React.
//
// A plan week is a calendar week from the plan's week start (planWeekStart); `weekOffset` counts
// calendar weeks since the one holding `startDate`, from 0. In a plan that is not `maintain` it is
// the week's index minus 1; a maintain plan repeats its weeks, and their ids, every cycle.
//
// A check-in counts only in the calendar week it fell in. The linked ones match first (same plan
// week index and same session id), then the unlinked ones by their day; each check-in matches one
// workout at most and a workout is done once. A check-in linked to a workout that is not in its
// week matches nothing, so a second check-in for a workout never takes another one.
import { addDays, weekdayOf, weekStartDate, weeksBetween } from './dates'
import { weekMinutes } from './models'
import { currentWeek, isReadable, planWeekStart, weekDate } from './run-actions'
import type { RunLog } from './run-log'
import type { RunPlan, Week } from './types'

// The days the easy pace looks back over, today included.
const PACE_DAYS = 28

const round2 = (n: number) => Math.round(n * 100) / 100

// The plan week at `offset`, as currentWeek maps it (a maintain plan's cycles and opening days).
// The week's last day is never before `startDate`, which falls in week 0.
function weekAt(plan: RunPlan, offset: number, ws: 0 | 1): Week | null {
  if (!Number.isInteger(offset) || offset < 0) return null
  return currentWeek(plan, addDays(weekDate(plan, offset, ws), 6), ws)
}

// The check-ins of the calendar week at `offset` from the plan start on, in day order.
function logsIn(plan: RunPlan, offset: number, logs: RunLog[], ws: 0 | 1): RunLog[] {
  const first = weekDate(plan, offset, ws)
  const last = addDays(first, 6)
  return logs.filter(l => l.day >= first && l.day <= last && l.day >= plan.startDate)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function matched(week: Week, logs: RunLog[]): Set<string> {
  const done = new Set<string>()
  const ids = new Set(week.sessions.map(s => s.id))
  for (const l of logs) {
    const p = l.run?.planned
    if (p && p.week === week.index && ids.has(p.session)) done.add(p.session)
  }
  for (const l of logs) {
    if (l.run?.planned) continue
    const day = weekdayOf(l.day)
    const s = week.sessions.find(x => x.day === day && !done.has(x.id))
    if (s) done.add(s.id)
  }
  return done
}

/** The ids of the workouts done in the calendar week at `weekOffset` (plan decision 8). */
export function doneSessions(plan: RunPlan | null, weekOffset: number, logs: RunLog[], weekStart: 0 | 1): Set<string> {
  if (!isReadable(plan)) return new Set()
  const week = weekAt(plan, weekOffset, weekStart)
  return week ? matched(week, logsIn(plan, weekOffset, logs, weekStart)) : new Set()
}

/**
 * The week at `weekOffset`: workouts done against planned, and the minutes (duration_min) and km
 * (distance_km) of every run check-in of that calendar week, linked or not. Zeros outside the plan.
 */
export function weekSummary(plan: RunPlan | null, weekOffset: number, logs: RunLog[], weekStart: 0 | 1):
  { done: number; planned: number; minutes: number; km: number } {
  const week = isReadable(plan) ? weekAt(plan, weekOffset, weekStart) : null
  if (!plan || !week) return { done: 0, planned: 0, minutes: 0, km: 0 }
  const inWeek = logsIn(plan, weekOffset, logs, weekStart)
  return {
    done: matched(week, inWeek).size,
    planned: week.sessions.length,
    minutes: inWeek.reduce((n, l) => n + (l.duration_min ?? 0), 0),
    km: round2(inWeek.reduce((n, l) => n + (l.run?.distance_km ?? 0), 0))
  }
}

// The offset of the week holding `today`, or -1 before the plan's first week.
function offsetOn(plan: RunPlan, today: string, ws: 0 | 1): number {
  const first = weekDate(plan, 0, ws)
  return today < first ? -1 : weeksBetween(first, weekStartDate(today, planWeekStart(plan, ws)))
}

/**
 * The planned minutes and the minutes run per calendar week, from the plan's first week to the
 * current one (to the last week once a plan that is not `maintain` is over). `index` is the
 * calendar week's number from 1 (weekOffset + 1): the week's index outside a maintain plan.
 */
export function volumeSeries(plan: RunPlan | null, logs: RunLog[], weekStart: 0 | 1, today: string):
  { index: number; planned: number; done: number }[] {
  if (!isReadable(plan)) return []
  let last = offsetOn(plan, today, weekStart)
  if (plan.goal !== 'maintain') last = Math.min(last, plan.weeks.length - 1)
  const out: { index: number; planned: number; done: number }[] = []
  for (let i = 0; i <= last; i++) {
    const week = weekAt(plan, i, weekStart)
    out.push({
      index: i + 1,
      planned: week ? weekMinutes(week) : 0,
      done: logsIn(plan, i, logs, weekStart).reduce((n, l) => n + (l.duration_min ?? 0), 0)
    })
  }
  return out
}

/**
 * The milestones since the plan start: the longest Longão in minutes, the longest distance in km,
 * and the easy pace in seconds per km, the total time over the total distance of the Leve runs
 * linked to the plan with a distance and a duration in the last 28 days. Null without data.
 * Check-ins count from `startDate` to `today`; the week start plays no part (`_weekStart` keeps the
 * signature of the other functions).
 */
export function milestones(plan: RunPlan | null, logs: RunLog[], _weekStart: 0 | 1, today: string):
  { longestLong: number | null; maxKm: number | null; easyPace: number | null } {
  if (!isReadable(plan)) return { longestLong: null, maxKm: null, easyPace: null }
  const inPlan = logs.filter(l => l.day >= plan.startDate && l.day <= today)
  const max = (values: (number | null | undefined)[]) => {
    const ok = values.filter((v): v is number => typeof v === 'number')
    return ok.length ? Math.max(...ok) : null
  }
  const paceFrom = addDays(today, -(PACE_DAYS - 1))
  let seconds = 0, km = 0
  for (const l of inPlan) {
    const d = l.run?.distance_km
    if (l.day < paceFrom || l.run?.planned?.type !== 'easy' || !d || !l.duration_min) continue
    seconds += l.duration_min * 60
    km += d
  }
  return {
    longestLong: max(inPlan.filter(l => l.run?.planned?.type === 'long').map(l => l.duration_min)),
    maxKm: max(inPlan.map(l => l.run?.distance_km)),
    easyPace: km > 0 ? Math.round(seconds / km) : null
  }
}
