// Pace model for the running plan (spec §4): VDOT from a race result, pace ranges per zone and
// race time prediction. Daniels and Gilbert's oxygen cost and %VO2max curves. Pure functions.
import { t } from '../../lib/i18n.js'

const A = 0.000104
const B = 0.182258
const C = -4.6

const oxygenCost = (v: number) => C + B * v + A * v * v
const fractionOfMax = (min: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min)
const rawVdot = (distanceM: number, minutes: number) => oxygenCost(distanceM / minutes) / fractionOfMax(minutes)

// VDOT of a race result, with one decimal.
export function vdotFrom(distanceM: number, minutes: number): number {
  return Math.round(rawVdot(distanceM, minutes) * 10) / 10
}

// Velocity in m/min at which the oxygen cost is `fraction` of the VDOT (positive root).
export function velocityAt(vdot: number, fraction: number): number {
  const c = C - fraction * vdot
  return (-B + Math.sqrt(B * B - 4 * A * c)) / (2 * A)
}

export type PaceRange = { fast: number; slow: number }

// Zone fractions of the VDOT (spec §4.2), [slow, fast].
const FRACTIONS = {
  easy: [0.59, 0.74],
  moderate: [0.83, 0.88],
  hard: [0.95, 1.0]
} as const

const paceAt = (vdot: number, fraction: number) => Math.round(60000 / velocityAt(vdot, fraction) / 5) * 5

// Pace ranges in seconds per km, rounded to 5 s. `fast` comes from the higher fraction.
export function zonePaces(vdot: number): Record<'easy' | 'moderate' | 'hard', PaceRange> {
  const out = {} as Record<'easy' | 'moderate' | 'hard', PaceRange>
  for (const zone of ['easy', 'moderate', 'hard'] as const) {
    const [slow, fast] = FRACTIONS[zone]
    out[zone] = { fast: paceAt(vdot, fast), slow: paceAt(vdot, slow) }
  }
  return out
}

// Race time in minutes at `distanceM` for a VDOT, by bisection between 1 and 600 min (1 s).
// A longer time always lowers the VDOT, so the search is monotonic.
export function predictMinutes(vdot: number, distanceM: number): number {
  let lo = 1
  let hi = 600
  while ((hi - lo) * 60 > 1) {
    const mid = (lo + hi) / 2
    if (rawVdot(distanceM, mid) > vdot) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// The VDOT a target time asks for; the inverse of predictMinutes.
export function requiredVdot(distanceM: number, minutes: number): number {
  return vdotFrom(distanceM, minutes)
}

export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatPaceRange(r: PaceRange): string {
  return t('{0} a {1} /km', formatPace(r.fast), formatPace(r.slow))
}
