import type { Challenge, ChallengeMode, ChallengeTemplate, NewChallenge } from './types'

// Challenge rules, the same ones public.create_challenge enforces (0004_social.sql, and
// 0015_nutrition_challenge.sql for the nutrition template), so the form explains a problem before
// the server refuses it. supabase/tests/challenge-rules-parity.test.ts runs both on the same cases.
// Dates are local YYYY-MM-DD strings.

export const MIN_DAYS = 7
export const MAX_DAYS = 92
export const MAX_INVITEES = 19
export const DURATIONS = [7, 14, 30, 60, 90] as const
export const TEMPLATES: readonly ChallengeTemplate[] = ['workouts_count', 'weeks_on_target', 'volume_total', 'nutrition_days_on_target']
export const MODES: Record<ChallengeTemplate, readonly ChallengeMode[]> = {
  workouts_count: ['team', 'solo'],
  weeks_on_target: ['solo'],
  volume_total: ['team', 'solo'],
  nutrition_days_on_target: ['team', 'solo']
}
export const TARGET_STEP: Record<ChallengeTemplate, number> = {
  workouts_count: 1, weeks_on_target: 1, volume_total: 5, nutrition_days_on_target: 1
}
const MAX_TARGET = { workouts_count: 500, volume_total: 5000 } as const
// public.challenge_grace: days past ends_on before a challenge closes. A nutrition day is judged
// at the start of D+2, so the last day of a nutrition challenge needs two more.
export const GRACE: Record<ChallengeTemplate, number> = {
  workouts_count: 0, weeks_on_target: 0, volume_total: 0, nutrition_days_on_target: 2
}

const DAY = 86_400_000
const utc = (iso: string) => Date.parse(iso + 'T00:00:00Z')
export const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10)
export const daysInclusive = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY) + 1
export const mondayOf = (iso: string): string => addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7))
export const nextMonday = (iso: string): string => addDays(mondayOf(iso), 7)
export const weeksTouched = (from: string, to: string): number => Math.round((utc(mondayOf(to)) - utc(mondayOf(from))) / (7 * DAY)) + 1

// The goal a challenge may ask for. Days on target go up to one a day per person: the days of the
// period in solo, times everyone (me and the invitees) in a team.
export function targetRange(template: ChallengeTemplate, startsOn: string, endsOn: string,
  mode: ChallengeMode = 'solo', invitees = 0): { min: number; max: number } {
  if (template === 'weeks_on_target') return { min: 1, max: weeksTouched(startsOn, endsOn) }
  if (template === 'nutrition_days_on_target') {
    return { min: 1, max: daysInclusive(startsOn, endsOn) * (mode === 'team' ? 1 + invitees : 1) }
  }
  return { min: 1, max: MAX_TARGET[template] }
}

export const clampTarget = (n: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.round(n)))

// A starting goal for the form: the weekly target over the period (times the people in a team),
// all but one of the weeks for weeks_on_target, and about 5 t per person a week of volume.
// `weekly` is the weekly goal of what counts: workouts, or days on the nutrition target.
export function suggestedTarget(template: ChallengeTemplate, mode: ChallengeMode, startsOn: string, endsOn: string,
  weekly: number, people: number): number {
  const days = daysInclusive(startsOn, endsOn)
  const weeks = Math.max(1, Math.round(days / 7))
  const heads = mode === 'team' ? Math.max(1, people) : 1
  const raw = template === 'workouts_count' ? weekly * weeks * heads
    : template === 'weeks_on_target' ? weeksTouched(startsOn, endsOn) - 1
    : template === 'nutrition_days_on_target' ? Math.round((days * weekly) / 7) * heads
    : 5 * weeks * heads
  return clampTarget(raw, targetRange(template, startsOn, endsOn, mode, Math.max(0, people - 1)))
}

export type ChallengeProblem = 'title' | 'mode' | 'dates' | 'target' | 'invitees' | 'volume' | 'nutrition_off' | 'nutrition'

// nutritionOn: whether my Nutrition pillar is on (profile.nutrition_enabled). The server checks it
// for the nutrition template after the shape, then the opt-in, and so does this.
export function checkChallenge(c: NewChallenge, today: string, { nutritionOn = false }: { nutritionOn?: boolean } = {}): ChallengeProblem | null {
  // btrim() strips spaces only and char_length() counts code points, not UTF-16 units.
  const title = [...c.title.replace(/^ +| +$/g, '')]
  if (title.length < 1 || title.length > 60) return 'title'
  if (!MODES[c.template].includes(c.mode)) return 'mode'
  const days = daysInclusive(c.starts_on, c.ends_on)
  if (days < MIN_DAYS || days > MAX_DAYS || c.starts_on < today || c.starts_on > addDays(today, 30)) return 'dates'
  const people = new Set(c.invitees)
  const r = targetRange(c.template, c.starts_on, c.ends_on, c.mode, people.size)
  if (!Number.isInteger(c.target) || c.target < r.min || c.target > r.max) return 'target'
  if (people.size < 1 || people.size > MAX_INVITEES) return 'invitees'
  if (c.template === 'volume_total' && !c.share_volume) return 'volume'
  if (c.template === 'nutrition_days_on_target') {
    if (!nutritionOn) return 'nutrition_off'
    if (!c.share_nutrition) return 'nutrition'
  }
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

// The first day the result exists: the server closes a challenge once the creator's today is past
// ends_on + GRACE (close_due_challenges, close_all_challenges).
export const resultOn = (c: Pick<Challenge, 'template' | 'ends_on'>): string => addDays(c.ends_on, GRACE[c.template] + 1)
