// Day arithmetic of the running plan on ISO days (YYYY-MM-DD), in UTC so no time zone or daylight
// saving change can shift a day. Weekdays follow S.week: 0 = Sunday to 6 = Saturday (getDay()).
export const DAY_MS = 86400000

export const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
export const isoOfMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => isoOfMs(utc(iso) + n * DAY_MS)
export const weekdayOf = (iso: string) => new Date(utc(iso)).getUTCDay()
/** The first day of the calendar week holding `iso`, for a week starting on weekday `ws`. */
export const weekStartDate = (iso: string, ws: number) => addDays(iso, -((weekdayOf(iso) - ws + 7) % 7))
export const weeksBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS / 7)
