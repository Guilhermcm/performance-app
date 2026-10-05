import { dateLocale } from '../../lib/i18n.js'

// Local calendar days (YYYY-MM-DD) are read at noon, so no time zone moves them a day.
const asDate = (iso: string) => new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)

export const fmtShortDay = (iso: string): string => asDate(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
export const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
export const fmtDecimal = (n: number): string => n.toLocaleString(dateLocale(), { maximumFractionDigits: 1 })
