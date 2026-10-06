// The history calendar's month (spec 2b §4): pure layout of a month from what get_nutrition_days
// returned and the pillar periods, plus the per-account copy of the months already read.
import { shiftDay } from './days'
import { HISTORY_KEY } from './storage-keys'
import type { NutritionDay, NutritionHistory, NutritionPeriod, NutritionWeek } from './types'

export type Period = NutritionPeriod

// on_target and logged come from a closed day; none is a day inside a period that did not log
// enough (or has no closed row); open is today or yesterday, which can still change; inactive is
// outside every period, or a day still to come (then `future`).
export type DayState = 'on_target' | 'logged' | 'none' | 'inactive' | 'open'

export type MonthCell = { day: string; inMonth: boolean; state: DayState; future: boolean; data: NutritionDay | null }

// One Monday-to-Sunday row with its week summary, given only to a week that has begun and has a day
// inside a period.
export type MonthWeek = { start: string; cells: MonthCell[]; summary: NutritionWeek | null }

export const monthOf = (day: string): string => day.slice(0, 7)

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const n = y * 12 + (m - 1) + by
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`
}

const firstDay = (month: string) => `${month}-01`
const lastDay = (month: string) => shiftDay(firstDay(shiftMonth(month, 1)), -1)
// Read at noon, so no time zone moves the day.
const mondayOf = (day: string) => shiftDay(day, -((new Date(day + 'T12:00:00').getDay() + 6) % 7))

// A period with ended_on = started_on - 1 covers no day, and this test leaves it out on its own.
export const activeOn = (periods: Period[], day: string): boolean =>
  periods.some(p => p.started_on <= day && (p.ended_on == null || p.ended_on >= day))

// The month navigation starts at: the first period that covers at least one day.
export function firstMonth(periods: Period[]): string | null {
  let first: string | null = null
  for (const p of periods) {
    if (p.ended_on != null && p.ended_on < p.started_on) continue
    if (!first || p.started_on < first) first = p.started_on
  }
  return first ? monthOf(first) : null
}

function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d)
  return out
}

// A day of the month, up to today, inside a period. Without one the month has nothing to show.
export function monthHasActiveDay(month: string, periods: Period[], today: string): boolean {
  const end = lastDay(month) < today ? lastDay(month) : today
  return daysOf(firstDay(month), end).some(d => activeOn(periods, d))
}

// The range to ask get_nutrition_days for: the month up to today, and only when it holds a day
// inside a period that has already closed (two days back or more). A month before the first period,
// between periods, or whose active days are all still open asks nothing.
export function monthRange(month: string, periods: Period[], today: string): { from: string; to: string } | null {
  const from = firstDay(month)
  const to = lastDay(month) < today ? lastDay(month) : today
  const closed = shiftDay(today, -2)
  const end = to < closed ? to : closed
  if (from > end || !daysOf(from, end).some(d => activeOn(periods, d))) return null
  return { from, to }
}

// Every day of the month's rows (its weeks run into the months around it) had closed when it was
// read, so nothing in it can change any more: a saved copy is final.
export function isSettled(month: string, fetchedOn: string): boolean {
  const lastRowEnd = shiftDay(mondayOf(lastDay(month)), 6)
  return lastRowEnd <= shiftDay(fetchedOn, -2)
}

export function buildMonth(month: string, days: NutritionDay[], weeks: NutritionWeek[], periods: Period[], today: string): MonthWeek[] {
  const byDay = new Map(days.map(d => [d.day, d]))
  const byWeek = new Map(weeks.map(w => [w.start, w]))
  const yesterday = shiftDay(today, -1)

  const cellOf = (day: string): MonthCell => {
    const data = byDay.get(day) ?? null
    const base = { day, inMonth: monthOf(day) === month, future: day > today, data }
    if (day > today) return { ...base, state: 'inactive' }
    const active = activeOn(periods, day)
    if (day >= yesterday) return { ...base, state: active ? 'open' : 'inactive' }
    // A closed row speaks for its day, an imported one outside the periods included.
    if (data) return { ...base, state: data.on_target ? 'on_target' : data.logged ? 'logged' : 'none' }
    return { ...base, state: active ? 'none' : 'inactive' }
  }

  const out: MonthWeek[] = []
  for (let start = mondayOf(firstDay(month)); start <= lastDay(month); start = shiftDay(start, 7)) {
    const cells = Array.from({ length: 7 }, (_, i) => cellOf(shiftDay(start, i)))
    const counted = cells.some(c => !c.future && activeOn(periods, c.day))
    out.push({ start, cells, summary: counted ? byWeek.get(start) ?? null : null })
  }
  return out
}

// The saved copy: one account at a time, like the diary's own copy. Months are kept with the day
// they were read so a settled one is never asked again.
export type SavedMonth = { fetchedOn: string; data: NutritionHistory }
export type HistoryCache = { userId: string; periods: Period[] | null; months: Record<string, SavedMonth> }

const MAX_MONTHS = 24

export function readHistory(userId: string): HistoryCache {
  try {
    const c = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null')
    if (c && c.userId === userId && c.months && typeof c.months === 'object') {
      return { userId, periods: Array.isArray(c.periods) ? c.periods : null, months: c.months }
    }
  } catch { /* broken or blocked: start over */ }
  return { userId, periods: null, months: {} }
}

export function writeHistory(c: HistoryCache): void {
  // The most recent months stay when the copy grows past the cap.
  const keep = Object.keys(c.months).sort().slice(-MAX_MONTHS)
  const months = Object.fromEntries(keep.map(k => [k, c.months[k]]))
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify({ ...c, months })) } catch { /* full or blocked */ }
}
