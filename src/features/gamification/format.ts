import { dateLocale } from '../../lib/i18n.js'

// "1.110" in Portuguese, "1,110" in English.
export const fmtInt = (n: number): string => Math.round(n).toLocaleString(dateLocale())

export const fmtDay = (iso: string): string =>
  new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
