// Writing and reading a tracker's values. Pure: the locale comes in as an argument (the app's
// `dateLocale()`), and the words come from t()/tn().
import { t, tn } from '../../lib/i18n.js'
import { daysBetween } from './stats'
import type { Tracker } from './types'

const decimalSeparator = (locale: string): string => {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.1).find(p => p.type === 'decimal')?.value ?? '.'
  } catch {
    return '.'
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// What a person typed, as a number in the language's own notation: one decimal separator (a comma
// in pt-BR, a point in English), no thousands separator, an optional minus. Rounded to `decimals`
// (half away from zero). Anything else is null, so the sheet can refuse it rather than guess.
export function parseNumberInput(text: string, locale: string, decimals: number): number | null {
  const sep = decimalSeparator(locale)
  const s = text.trim().replace('−', '-')
  const m = new RegExp(`^(-?)(\\d+|\\d*${escapeRe(sep)}\\d+)$`).exec(s)
  if (!m) return null
  const abs = m[2].replace(sep, '.')
  const rounded = Number(`${Math.round(Number(`${abs}e${decimals}`))}e-${decimals}`)
  if (!Number.isFinite(rounded)) return null
  return rounded === 0 ? 0 : m[1] ? -rounded : rounded
}

// "45 min", "1 h", "1 h 25 min", "26 h 10 min": hours stay hours past a day. Rounded to the minute.
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return t('{0} min', m)
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? t('{0} h', h) : t('{0} h {1} min', h, r)
}

// A tracker's number as it reads on screen: the tracker's decimals and the language's separators,
// then the unit after a space ("1,8 L", "8.000 passos"); a duration is written by formatDuration.
export function formatValue(tracker: Tracker, n: number, locale: string): string {
  if (tracker.kind === 'duration') return formatDuration(n)
  const d = tracker.decimals ?? 0
  const num = new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
  return tracker.unit ? `${num} ${tracker.unit}` : num
}

// When a day was, against today: "today", "yesterday", "3 days ago". A day after today reads as today.
export function whenText(day: string, today: string): string {
  const n = daysBetween(day, today)
  if (n <= 0) return t('today')
  if (n === 1) return t('yesterday')
  return tn(n, '{0} days ago', n)
}
