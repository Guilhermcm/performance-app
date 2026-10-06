import { isoOf } from '../../lib/format.js'

// Local calendar arithmetic on YYYY-MM-DD strings (the diary's day keys).
export const shiftDay = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return isoOf(new Date(y, m - 1, d + by))
}

const FALLBACK_TZ = 'America/Sao_Paulo'

// The calendar day (YYYY-MM-DD) it is in `timezone` at `now`. The diary follows the profile's
// time zone, not the device's. A missing or invalid zone falls back to Sao Paulo.
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string {
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  try { return fmt(timezone || FALLBACK_TZ) } catch { return fmt(FALLBACK_TZ) }
}
