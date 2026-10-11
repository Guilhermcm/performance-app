import { dateLocale } from '../../lib/i18n.js'

// Local calendar days (YYYY-MM-DD) are read at noon, so no time zone moves them a day.
const asDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)

export const fmtShortDay = (iso: string): string => asDate(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
export const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
export const fmtDecimal = (n: number): string => n.toLocaleString(dateLocale(), { maximumFractionDigits: 1 })

// "now", "5 min. ago", "2 hr. ago", "yesterday", up to a week; after that the date.
export function fmtAgo(iso: string, now: number = Date.now()): string {
  const s = Math.floor((now - new Date(iso).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto', style: 'short' })
  if (s < 60) return rtf.format(0, 'second')
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour')
  if (s < 7 * 86400) return rtf.format(-Math.floor(s / 86400), 'day')
  return fmtShortDay(iso)
}
