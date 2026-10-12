// The data behind the two charts of /sono (spec 7.4) and the words that stand in for them: the
// description under each title, and the rows of "Show as table".
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { shiftDay } from '../nutrition/days'
import { BED_SLACK_MIN } from './classify'
import { nightAt } from './history'
import { fmtDuration, fmtGap, signedDeviation } from './time'
import type { SleepLog, SleepNight, SleepTarget } from './types'

export const DURATION_DAYS = 30
export const BEDTIME_DAYS = 14
// The bedtime chart's vertical axis stops 3 hours either side of the target.
export const BED_LIMIT = 180

// `duration` is null on a night with nothing logged; `goal` is the goal in force that night (null
// when there was none), so the goal line steps on the day a new goal starts.
export type DurationPoint = { night: string; duration: number | null; goal: number | null; onTarget: boolean }
// Minutes from the bedtime target, later positive, held to ±BED_LIMIT; `clamped` says which edge
// held a night that went further.
export type BedtimePoint = { night: string; dev: number; clamped: 'up' | 'down' | null }

// One point per day from today - 29 to today. A closed night speaks for itself and carries the goal
// it was judged by; an open one is judged by the goal in force that night, as a preview.
export function durationSeries(
  nights: SleepNight[], logs: Record<string, SleepLog>, targets: SleepTarget[], today: string,
): DurationPoint[] {
  return Array.from({ length: DURATION_DAYS }, (_, i) => {
    const n = nightAt(shiftDay(today, i - (DURATION_DAYS - 1)), nights, logs, targets)
    return { night: n.night, duration: n.logged ? n.duration_min : null, goal: n.target?.goal_min ?? null, onTarget: n.on_target }
  })
}

// The logged nights of the last 14 days, against today's bedtime target (plan decision 11).
export function bedtimeSeries(
  nights: SleepNight[], logs: Record<string, SleepLog>, bedTarget: string, today: string,
): BedtimePoint[] {
  const out: BedtimePoint[] = []
  for (let i = BEDTIME_DAYS - 1; i >= 0; i--) {
    const n = nightAt(shiftDay(today, -i), nights, logs, [])
    if (!n.logged || !n.bed_time) continue
    const raw = signedDeviation(n.bed_time, bedTarget)
    const clamped = raw > BED_LIMIT ? 'up' : raw < -BED_LIMIT ? 'down' : null
    out.push({ night: n.night, dev: Math.max(-BED_LIMIT, Math.min(BED_LIMIT, raw)), clamped })
  }
  return out
}

const nightsOnTarget = (n: number) => (n === 1 ? t('1 night on target') : tn(n, '{0} nights on target', n))
const nightsLogged = (n: number) => (n === 1 ? t('1 night logged') : tn(n, '{0} nights logged', n))

// "Average of 7h 25 over the last 30 days, 18 nights on target".
export function durationDescription(series: DurationPoint[]): string {
  const logged = series.filter(p => p.duration != null)
  if (!logged.length) return t('No nights logged in the last 30 days')
  const avg = Math.round(logged.reduce((s, p) => s + (p.duration as number), 0) / logged.length)
  return t('Average of {0} over the last 30 days, {1}', fmtDuration(avg), nightsOnTarget(series.filter(p => p.onTarget).length))
}

// "Last 14 days: 9 nights logged, 7 within 45 min of the target".
export function bedtimeDescription(series: BedtimePoint[]): string {
  if (!series.length) return t('No nights logged in the last 14 days')
  const within = series.filter(p => Math.abs(p.dev) <= BED_SLACK_MIN).length
  return t('Last 14 days: {0}, {1} within 45 min of the target', nightsLogged(series.length), within)
}

// Where a night stands, in words: the tooltip and the table say it, the colour only repeats it.
export function durationState(p: DurationPoint): string {
  if (p.duration == null) return t('Not logged')
  if (p.goal == null) return t('Logged')
  return p.onTarget ? t('On target') : t('Off target')
}

// "1h10 later", "25 min earlier"; a night held at the edge went further than the axis shows.
export function deviationText(p: BedtimePoint): string {
  if (p.clamped === 'up') return t('More than {0} later', fmtGap(BED_LIMIT))
  if (p.clamped === 'down') return t('More than {0} earlier', fmtGap(BED_LIMIT))
  if (p.dev === 0) return t('Right on time')
  return p.dev > 0 ? t('{0} later', fmtGap(p.dev)) : t('{0} earlier', fmtGap(p.dev))
}

// A short date for axis ticks and table rows: "Oct 1", "Thu, Oct 1".
export const shortDate = (iso: string, weekday = false): string =>
  new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), weekday
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short' })
