// Sleep statistics (spec 7.3). All of them read logged nights, closed or still open.
import { weekStartOf } from '../gamification/xp'
import { shiftDay } from '../nutrition/days'
import { signedDeviation } from './time'
import type { NightClass, SleepNight } from './types'

export type StatNight = { night: string; bed_time: string; duration_min: number; goal_min: number | null }

const inWindow = (nights: StatNight[], today: string, days: number) => {
  const from = shiftDay(today, -(days - 1))
  return nights.filter(n => n.night >= from && n.night <= today)
}

// Mean minutes asleep in [today - (days - 1), today]; null with no logged night in it.
export function averageDuration(nights: StatNight[], today: string, days: 7 | 30): number | null {
  const w = inWindow(nights, today, days)
  if (!w.length) return null
  return Math.round(w.reduce((s, n) => s + n.duration_min, 0) / w.length)
}

export const STABLE_SD = 30
export const OK_SD = 60

// Population SD of the signed bedtime deviation from the target over the last 14 days, rounded to
// the minute. The target only decides where midnight falls; the spread does not depend on it.
export function regularity(
  nights: StatNight[], today: string, bedTarget: string,
): { sd: number; label: 'stable' | 'ok' | 'irregular' } | null {
  const w = inWindow(nights, today, 14)
  if (w.length < 3) return null
  const dev = w.map(n => signedDeviation(n.bed_time, bedTarget))
  const mean = dev.reduce((s, d) => s + d, 0) / dev.length
  const sd = Math.round(Math.sqrt(dev.reduce((s, d) => s + (d - mean) ** 2, 0) / dev.length))
  return { sd, label: sd <= STABLE_SD ? 'stable' : sd <= OK_SD ? 'ok' : 'irregular' }
}

// Minutes short of the goal, Monday through today: each logged night counts max(0, goal - slept),
// nights above the goal never offset the others and nights without a log add nothing.
export function weekDebt(nights: StatNight[], today: string): number {
  const from = weekStartOf(today)
  return nights
    .filter(n => n.night >= from && n.night <= today && n.goal_min != null)
    .reduce((s, n) => s + Math.max(0, (n.goal_min as number) - n.duration_min), 0)
}

// Nights on target in the current week: those already closed, plus the preview of the open ones.
export function nightsOnTarget(
  closed: SleepNight[], open: { night: string; cls: NightClass }[], today: string, target: number,
): { closed: number; preview: number; target: number } {
  const from = weekStartOf(today)
  const here = (night: string) => night >= from && night <= today
  return {
    closed: closed.filter(n => here(n.night) && n.on_target).length,
    preview: open.filter(o => here(o.night) && o.cls.on_target).length,
    target,
  }
}
