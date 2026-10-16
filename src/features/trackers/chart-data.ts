// The data behind a tracker's charts (spec 8.5) and the words that stand in for them: the
// description under the title, the axis steps and the counts. Pure apart from the language.
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { shiftDay } from '../nutrition/days'
import { formatDuration, formatValue } from './format'
import type { PeriodStats } from './stats'
import type { Tracker, TrackerOption } from './types'

export const PERIODS = [30, 90] as const
export type Period = (typeof PERIODS)[number]

export type LabelRow = { option: TrackerOption; count: number }

// The days of a period, oldest first, ending today.
export const periodDays = (today: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => shiftDay(today, i - (n - 1)))

export const entriesText = (n: number): string => (n === 1 ? t('1 entry') : tn(n, '{0} entries', n))
const daysWithEntriesText = (n: number): string => (n === 1 ? t('1 day with entries') : tn(n, '{0} days with entries', n))
export const emptyPeriodText = (days: number): string => tn(days, 'No entries in the last {0} days', days)
export const periodTitle = (days: number): string => tn(days, 'Last {0} days', days)

// The name of the first series: the day's total or the day's average, by the tracker's aggregate.
export const summaryName = (tracker: Tracker): string => (tracker.aggregate === 'avg' ? t('Day average') : t('Day total'))

// "Average of 1.9 L over the last 30 days, 24 days with entries": the period's stats (periodStats),
// the same numbers the detail shows under the chart.
export function lineDescription(tracker: Tracker, days: number, stats: Pick<PeriodStats, 'average' | 'daysWithEntries'>): string {
  if (stats.average == null) return emptyPeriodText(days)
  return t('Average of {0} over the last {1} days, {2}', formatValue(tracker, stats.average, dateLocale()), days, daysWithEntriesText(stats.daysWithEntries))
}

// The option picked most in the period; on a tie the first in the options order. Null with none.
export function mostFrequent(rows: LabelRow[]): LabelRow | null {
  let best: LabelRow | null = null
  for (const r of rows) if (r.count > 0 && (!best || r.count > best.count)) best = r
  return best
}

// "Most frequent: good, 12 of 20 entries".
export function labelDescription(rows: LabelRow[], days: number): string {
  const best = mostFrequent(rows)
  if (!best) return emptyPeriodText(days)
  const total = rows.reduce((s, r) => s + r.count, 0)
  return total === 1
    ? t('Most frequent: {0}, 1 of 1 entry', best.option.text)
    : tn(total, 'Most frequent: {0}, {1} of {2} entries', best.option.text, best.count, total)
}

// A long date for the tooltip, a short one for the axis and the table rows.
export const longDate = (iso: string): string =>
  new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

const round = (n: number) => Math.round(n * 1e9) / 1e9
const decimalsOf = (n: number): number => {
  const s = String(round(n))
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

const MINUTE_STEPS = [5, 10, 15, 20, 30]
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12, 24, 48]

function durationStep(hi: number): number {
  // Up to an hour the axis counts minutes; past it, whole hours, so a tick never reads "1 h 30 min".
  if (hi <= 60) return MINUTE_STEPS.find(s => s * 4 >= hi) ?? 30
  return 60 * (HOUR_STEPS.find(h => h * 60 * 4 >= hi) ?? Math.ceil(hi / (60 * 4 * 24)) * 24)
}

function numberStep(span: number, decimals: number): number {
  const floor = 10 ** -decimals
  const raw = span / 4
  if (raw <= floor) return floor
  const mag = 10 ** Math.floor(Math.log10(raw))
  // A step finer than the tracker writes would print the same tick twice, so 2.5 only where it fits.
  return [1, 2, 2.5, 5, 10].map(m => round(m * mag)).find(s => s >= raw && decimalsOf(s) <= decimals) ?? round(10 * mag)
}

// The value axis: round steps covering every value shown (the day summaries and the average). A
// duration starts at zero and steps in minutes or whole hours; a number starts at zero when its
// lowest value is under half the highest, else just under the lowest, and never steps finer than
// the tracker's decimals. Always two ticks at least.
export function valueTicks(tracker: Tracker, values: number[]): number[] {
  if (!values.length) return [0, 1]
  let lo = Math.min(...values)
  const hi = Math.max(...values)
  let step: number
  if (tracker.kind === 'duration') {
    lo = 0
    step = durationStep(Math.max(hi, 1))
  } else {
    if (lo >= 0 && lo < hi / 2) lo = 0
    // One value alone still gets an axis around it.
    step = numberStep(hi - lo || Math.abs(hi) / 2 || 1, tracker.decimals ?? 2)
  }
  let start = round(Math.floor(lo / step) * step)
  let end = round(Math.ceil(hi / step) * step)
  if (end === start) {
    if (start > 0 && tracker.kind !== 'duration') start = round(start - step)
    end = round(end + step)
  }
  const out: number[] = []
  for (let v = start; v <= end + step / 1e6; v = round(v + step)) out.push(v)
  return out
}

// A tick as the axis writes it: hours and minutes for a duration; for a number, the language's
// notation with as many decimals as the step needs (no unit: the legend carries it), short past
// ten thousand.
export function tickText(tracker: Tracker, v: number, ticks: number[]): string {
  if (tracker.kind === 'duration') return formatDuration(v)
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1
  const big = Math.max(...ticks.map(Math.abs)) >= 10_000
  return new Intl.NumberFormat(dateLocale(), big
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { minimumFractionDigits: decimalsOf(step), maximumFractionDigits: decimalsOf(step) }).format(v)
}
