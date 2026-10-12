import { dateLocale, t } from '../../lib/i18n.js'
import { shiftDay } from '../nutrition/days'

// Clock arithmetic for the sleep pillar. Times are 'HH:MM' strings on a 1440 minute circle.
const DAY_MIN = 1440

export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

// Wraps around 24h in both directions: 1500 is 01:00 and -10 is 23:50.
export function fromMinutes(min: number): string {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}

export const shiftClock = (hhmm: string, by: number): string => fromMinutes(toMinutes(hhmm) + by)

// Time asleep, from bed to wake across midnight: (wake - bed) mod 1440.
export const durationMin = (bed: string, wake: string): number =>
  (((toMinutes(wake) - toMinutes(bed)) % DAY_MIN) + DAY_MIN) % DAY_MIN

// Shortest distance between two clock times on the circle, 0 to 720.
export function circularDiff(a: string, b: string): number {
  const d = Math.abs(toMinutes(a) - toMinutes(b))
  return Math.min(d, DAY_MIN - d)
}

// How far a bedtime is from the target, negative when earlier: -720 to 720.
export function signedDeviation(bed: string, target: string): number {
  const d = (((toMinutes(bed) - toMinutes(target)) % DAY_MIN) + DAY_MIN) % DAY_MIN
  return d > 720 ? d - DAY_MIN : d
}

// The calendar day the person went to bed for the night dated `night` (the day they woke up): the
// same day when bed is before wake (after midnight), the day before otherwise.
export const bedDate = (night: string, bed: string, wake: string): string =>
  toMinutes(bed) < toMinutes(wake) ? night : shiftDay(night, -1)

export const validDuration = (min: number): boolean => Number.isInteger(min) && min >= 60 && min <= 960

// "40 min" under an hour, "8h" on the hour, otherwise "7h 05". The unit words come from the packs.
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m === 0) return '0'
  if (m < 60) return t('{0} min', m)
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? t('{0}h', h) : t('{0}h {1}', h, String(r).padStart(2, '0'))
}

// A gap between two times, written tighter than a night's length: "25 min", "1h", "1h10". The
// sign is dropped; the sentence around it says before or after, over or under.
export function fmtGap(min: number): string {
  const m = Math.abs(Math.round(min))
  if (m < 60) return t('{0} min', m)
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? t('{0}h', h) : t('{0}h{1}', h, String(r).padStart(2, '0'))
}

// The clock in the language's own convention (24h or 12h). `locale` is for tests and callers that
// already know it; by default it is the app's current language.
export function fmtClock(hhmm: string, locale: string = dateLocale()): string {
  const m = toMinutes(hhmm)
  const at = new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60), m % 60))
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
  // 12h locales write "9:05 AM", not "09:05 AM"; 24h ones keep the two digits.
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
  if (cycle === 'h11' || cycle === 'h12') opts.hour = 'numeric'
  return new Intl.DateTimeFormat(locale, opts).format(at)
}
