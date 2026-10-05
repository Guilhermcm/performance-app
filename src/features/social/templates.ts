import type { Challenge, ChallengeMode, ChallengeTemplate, NewChallenge } from './types'

// Challenge rules, the same ones public.create_challenge enforces (0004_social.sql), so the form
// explains a problem before the server refuses it. Dates are local YYYY-MM-DD strings.

export const MIN_DAYS = 7
export const MAX_DAYS = 92
export const MAX_INVITEES = 19
export const DURATIONS = [7, 14, 30, 60, 90] as const
export const TEMPLATES: readonly ChallengeTemplate[] = ['workouts_count', 'weeks_on_target', 'volume_total']
export const MODES: Record<ChallengeTemplate, readonly ChallengeMode[]> = {
  workouts_count: ['team', 'solo'],
  weeks_on_target: ['solo'],
  volume_total: ['team', 'solo']
}
export const TARGET_STEP: Record<ChallengeTemplate, number> = { workouts_count: 1, weeks_on_target: 1, volume_total: 5 }
const MAX_TARGET = { workouts_count: 500, volume_total: 5000 } as const

const DAY = 86_400_000
const utc = (iso: string) => Date.parse(iso + 'T00:00:00Z')
export const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10)
export const daysInclusive = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY) + 1
export const mondayOf = (iso: string): string => addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7))
export const nextMonday = (iso: string): string => addDays(mondayOf(iso), 7)
export const weeksTouched = (from: string, to: string): number => Math.round((utc(mondayOf(to)) - utc(mondayOf(from))) / (7 * DAY)) + 1

export function targetRange(template: ChallengeTemplate, startsOn: string, endsOn: string): { min: number; max: number } {
  return { min: 1, max: template === 'weeks_on_target' ? weeksTouched(startsOn, endsOn) : MAX_TARGET[template] }
}

export const clampTarget = (n: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.round(n)))

// A starting goal for the form: the weekly workout target over the period (times the people in a
// team), all but one of the weeks for weeks_on_target, and about 5 t per person a week of volume.
export function suggestedTarget(template: ChallengeTemplate, mode: ChallengeMode, startsOn: string, endsOn: string,
  weekly: number, people: number): number {
  const weeks = Math.max(1, Math.round(daysInclusive(startsOn, endsOn) / 7))
  const heads = mode === 'team' ? Math.max(1, people) : 1
  const raw = template === 'workouts_count' ? weekly * weeks * heads
    : template === 'weeks_on_target' ? weeksTouched(startsOn, endsOn) - 1
    : 5 * weeks * heads
  return clampTarget(raw, targetRange(template, startsOn, endsOn))
}

export type ChallengeProblem = 'title' | 'mode' | 'dates' | 'target' | 'invitees' | 'volume'

export function checkChallenge(c: NewChallenge, today: string): ChallengeProblem | null {
  // btrim() strips spaces only and char_length() counts code points, not UTF-16 units.
  const title = [...c.title.replace(/^ +| +$/g, '')]
  if (title.length < 1 || title.length > 60) return 'title'
  if (!MODES[c.template].includes(c.mode)) return 'mode'
  const days = daysInclusive(c.starts_on, c.ends_on)
  if (days < MIN_DAYS || days > MAX_DAYS || c.starts_on < today || c.starts_on > addDays(today, 30)) return 'dates'
  const r = targetRange(c.template, c.starts_on, c.ends_on)
  if (!Number.isInteger(c.target) || c.target < r.min || c.target > r.max) return 'target'
  const people = new Set(c.invitees)
  if (people.size < 1 || people.size > MAX_INVITEES) return 'invitees'
  if (c.template === 'volume_total' && !c.share_volume) return 'volume'
  return null
}

// How far along, 0 to 1: the team's total, or my own progress in solo.
export function challengeShare(c: Challenge): number {
  const value = c.mode === 'team' ? c.total : (c.members.find(m => m.me)?.progress ?? 0)
  return Math.max(0, Math.min(1, value / c.target))
}

export const pendingInvites = (list: readonly Challenge[] | null): number =>
  (list ?? []).filter(c => c.status === 'active' && !c.me.joined).length

// The last day counts as one day left.
export const daysLeft = (c: Challenge, today: string): number => daysInclusive(today, c.ends_on)
