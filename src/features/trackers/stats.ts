// The numbers behind a tracker's detail screen. Pure: days are local YYYY-MM-DD strings, and a day
// with no entry is simply absent, never a zero.
import { shiftDay } from '../nutrition/days'
import type { Tracker, TrackerEntry, TrackerOption } from './types'

export type DaySummary = { value: number; count: number }

// The number an entry carries for its tracker: `value` for a number, `minutes` for a duration.
const amountOf = (t: Tracker, e: TrackerEntry): number | null => (t.kind === 'duration' ? e.minutes : e.value)

// One number per day with an entry: the sum or the average of the day's entries (the tracker's
// `aggregate`; a missing one counts as a sum). Only `number` and `duration` have a summary, in
// minutes for a duration.
export function daySummaries(t: Tracker, entries: TrackerEntry[]): Map<string, DaySummary> {
  const out = new Map<string, DaySummary>()
  if (t.kind === 'label') return out
  for (const e of entries) {
    const n = amountOf(t, e)
    if (n == null) continue
    const cur = out.get(e.day)
    out.set(e.day, cur ? { value: cur.value + n, count: cur.count + 1 } : { value: n, count: 1 })
  }
  if (t.aggregate === 'avg') for (const [d, s] of out) out.set(d, { value: s.value / s.count, count: s.count })
  return out
}

const WINDOW = 7

// For each of `days`, the average of the summaries of the days with an entry in [d - 6, d]; null
// when that window has none. The window follows the calendar, not the position in `days`.
export function movingAverage(summaries: Map<string, { value: number }>, days: string[]): (number | null)[] {
  return days.map(d => {
    let sum = 0
    let n = 0
    for (let i = 0; i < WINDOW; i++) {
      const s = summaries.get(shiftDay(d, -i))
      if (s) { sum += s.value; n++ }
    }
    return n ? sum / n : null
  })
}

// Whole calendar days from `from` to `to`, both YYYY-MM-DD (read in UTC so no zone or DST moves it).
export const daysBetween = (from: string, to: string): number => {
  const ms = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((ms(to) - ms(from)) / 86_400_000)
}

export type PeriodStats = {
  average: number | null
  min: number | null
  max: number | null
  daysWithEntries: number
  daysSinceLast: number | null
}

// Average, lowest and highest day summary over [from, to], and how many of those days have an
// entry. `daysSinceLast` looks at every entry given (the store's 90-day window), not only the
// period: 0 for today, 1 for yesterday, null with none. A label tracker has no numbers, only days.
export function periodStats(t: Tracker, entries: TrackerEntry[], from: string, to: string, today: string): PeriodStats {
  const summaries = daySummaries(t, entries)
  const inRange = (d: string) => d >= from && d <= to
  const values = [...summaries].filter(([d]) => inRange(d)).map(([, s]) => s.value)
  const days = new Set(entries.filter(e => inRange(e.day)).map(e => e.day))
  let last: string | null = null
  for (const e of entries) if (e.day <= today && (last == null || e.day > last)) last = e.day
  return {
    average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    daysWithEntries: days.size,
    daysSinceLast: last == null ? null : daysBetween(last, today),
  }
}

// How many entries picked each option, in the order of the options and zeros included. Entries
// keep the option's id, so a renamed option still counts; an id no option has any more is ignored.
export function labelCounts(t: Tracker, entries: TrackerEntry[]): { option: TrackerOption; count: number }[] {
  const counts = new Map<string, number>()
  for (const e of entries) if (e.option != null) counts.set(e.option, (counts.get(e.option) ?? 0) + 1)
  return (t.options ?? []).map(option => ({ option, count: counts.get(option.id) ?? 0 }))
}
