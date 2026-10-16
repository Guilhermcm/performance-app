import type { Challenge, ChallengeMember, ChallengeMode, ChallengeTemplate, NewChallenge } from './types'

// Challenge rules, the same ones public.create_challenge enforces (0004_social.sql, and
// 0015_nutrition_challenge.sql for the nutrition template, 0020_checkin_feed.sql for checkin_days,
// 0024_sleep_challenge.sql for the sleep template, 0029_habits_challenge.sql for the habits one), so
// the form explains a problem before the server refuses it. supabase/tests/challenge-rules-parity.test.ts
// runs both on the same cases.
// Dates are local YYYY-MM-DD strings.

export const MIN_DAYS = 7
export const MAX_DAYS = 92
export const MAX_INVITEES = 19
export const DURATIONS = [7, 14, 30, 60, 90] as const
// What a person can create. workouts_count (now the same training days) and volume_total stay in
// the types, MODES, GRACE and the detail screen for challenges that are already running.
export const TEMPLATES: readonly ChallengeTemplate[] = [
  'checkin_days', 'weeks_on_target', 'nutrition_days_on_target', 'sleep_nights_on_target', 'habit_checks'
]
export const MODES: Record<ChallengeTemplate, readonly ChallengeMode[]> = {
  checkin_days: ['team', 'solo'],
  workouts_count: ['team', 'solo'],
  weeks_on_target: ['solo'],
  volume_total: ['team', 'solo'],
  nutrition_days_on_target: ['team', 'solo'],
  sleep_nights_on_target: ['team', 'solo'],
  habit_checks: ['team', 'solo']
}
export const TARGET_STEP: Record<ChallengeTemplate, number> = {
  checkin_days: 1, workouts_count: 1, weeks_on_target: 1, volume_total: 5, nutrition_days_on_target: 1, sleep_nights_on_target: 1,
  habit_checks: 1
}
const MAX_TARGET = { checkin_days: 500, workouts_count: 500, volume_total: 5000 } as const
// public.challenge_grace: days past ends_on before a challenge closes. A nutrition day, a training
// day (0020_checkin_feed.sql), a night (0024_sleep_challenge.sql) and a habits day
// (0029_habits_challenge.sql) are judged at the start of D+2, so the last day of a challenge they pay
// needs two more. Volume comes from the workouts themselves.
export const GRACE: Record<ChallengeTemplate, number> = {
  checkin_days: 2, workouts_count: 2, weeks_on_target: 2, volume_total: 0, nutrition_days_on_target: 2, sleep_nights_on_target: 2,
  habit_checks: 2
}

// The two templates that count training days (a day with a check-in, or an older workout).
export const isTrainingDays = (template: ChallengeTemplate): boolean => template === 'checkin_days' || template === 'workouts_count'
// The pillar templates: one day (or night) on target at most per person, by the closed days.
const isPillarDays = (template: ChallengeTemplate): template is 'nutrition_days_on_target' | 'sleep_nights_on_target' =>
  template === 'nutrition_days_on_target' || template === 'sleep_nights_on_target'

const DAY = 86_400_000
const utc = (iso: string) => Date.parse(iso + 'T00:00:00Z')
export const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10)
export const daysInclusive = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY) + 1
export const mondayOf = (iso: string): string => addDays(iso, -((new Date(utc(iso)).getUTCDay() + 6) % 7))
export const nextMonday = (iso: string): string => addDays(mondayOf(iso), 7)
export const weeksTouched = (from: string, to: string): number => Math.round((utc(mondayOf(to)) - utc(mondayOf(from))) / (7 * DAY)) + 1

// Valid habit checks a person may count a day, at most, for the goal of a habits challenge.
const HABIT_CHECKS_PER_DAY = 10

// The goal a challenge may ask for. Days (or nights) on target go up to one a day per person, and
// habit checks to 10 a day per person: the days of the period in solo, times everyone (me and the
// invitees) in a team.
export function targetRange(template: ChallengeTemplate, startsOn: string, endsOn: string,
  mode: ChallengeMode = 'solo', invitees = 0): { min: number; max: number } {
  if (template === 'weeks_on_target') return { min: 1, max: weeksTouched(startsOn, endsOn) }
  if (isPillarDays(template) || template === 'habit_checks') {
    const perDay = template === 'habit_checks' ? HABIT_CHECKS_PER_DAY : 1
    return { min: 1, max: perDay * daysInclusive(startsOn, endsOn) * (mode === 'team' ? 1 + invitees : 1) }
  }
  return { min: 1, max: MAX_TARGET[template] }
}

export const clampTarget = (n: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.round(n)))

// A starting goal for the form: the weekly target over the period (times the people in a team),
// all but one of the weeks for weeks_on_target, and about 5 t per person a week of volume.
// `weekly` is the weekly goal of what counts: workouts, days on the nutrition target, nights on
// the sleep target or habit checks (habitsWeekly).
export function suggestedTarget(template: ChallengeTemplate, mode: ChallengeMode, startsOn: string, endsOn: string,
  weekly: number, people: number): number {
  const days = daysInclusive(startsOn, endsOn)
  const weeks = Math.max(1, Math.round(days / 7))
  const heads = mode === 'team' ? Math.max(1, people) : 1
  const raw = isTrainingDays(template) ? weekly * weeks * heads
    : template === 'weeks_on_target' ? weeksTouched(startsOn, endsOn) - 1
    : isPillarDays(template) ? Math.round((days * weekly) / 7) * heads
    : template === 'habit_checks' ? suggestHabitTarget(weekly, days) * heads
    : 5 * weeks * heads
  return clampTarget(raw, targetRange(template, startsOn, endsOn, mode, Math.max(0, people - 1)))
}

// The habit checks a week that a habits challenge suggests from (plan decision 19): my Q, or while it
// is 0 (no closed week yet, or a pillar just turned on) the weekly goals of my active habits.
export const habitsWeekly = (q: number, perWeekSum: number): number => (q > 0 ? q : perWeekSum)

// A habits challenge goal for one person: `weekly` checks a week (habitsWeekly) over the period, at least 1.
export function suggestHabitTarget(weekly: number, days: number): number {
  return Math.max(1, Math.round((weekly * days) / 7))
}

export type ChallengeProblem = 'title' | 'mode' | 'dates' | 'target' | 'invitees' | 'volume' | 'nutrition_off' | 'nutrition'
  | 'sleep_off' | 'sleep' | 'habits_off' | 'habits'

type PillarsOn = { nutritionOn?: boolean; sleepOn?: boolean; habitsOn?: boolean }

// nutritionOn, sleepOn and habitsOn: whether my Nutrition, Sleep and Habits pillars are on
// (profile.nutrition_enabled, sleep_enabled, habits_enabled). The server checks the pillar of a
// pillar template after the shape, then the opt-in, and so does this.
export function checkChallenge(c: NewChallenge, today: string,
  { nutritionOn = false, sleepOn = false, habitsOn = false }: PillarsOn = {}): ChallengeProblem | null {
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
  if (c.template === 'sleep_nights_on_target') {
    if (!sleepOn) return 'sleep_off'
    if (!c.share_sleep) return 'sleep'
  }
  if (c.template === 'habit_checks') {
    if (!habitsOn) return 'habits_off'
    if (!c.share_habits) return 'habits'
  }
  return null
}

// The scoreboard: everyone who joined by progress, best first, people with the same number sharing a
// position (1, 1, 3). The invited who have not joined come last, with no position.
export function rankMembers(c: Pick<Challenge, 'members'>): { member: ChallengeMember; pos: number | null }[] {
  const joined = c.members.filter(m => m.joined)
  const score = (m: ChallengeMember) => m.progress ?? 0
  const sorted = [...joined].sort((a, b) => score(b) - score(a))
  return [
    ...sorted.map(member => ({ member, pos: 1 + sorted.filter(o => score(o) > score(member)).length })),
    ...c.members.filter(m => !m.joined).map(member => ({ member, pos: null }))
  ]
}

// How far along, 0 to 1: the team's total, or my own progress in solo.
export function challengeShare(c: Challenge): number {
  const value = c.mode === 'team' ? c.total : (c.members.find(m => m.me)?.progress ?? 0)
  return Math.max(0, Math.min(1, value / c.target))
}

// An invitation I can still accept: the server refuses a join once the challenge's today is past
// ends_on (challenge_closed), even while a challenge stays active for its grace days.
export const canJoin = (c: Pick<Challenge, 'status' | 'me' | 'ends_on'>, today: string): boolean =>
  c.status === 'active' && !c.me.joined && today <= c.ends_on

export const pendingInvites = (list: readonly Challenge[] | null, today: string): number =>
  (list ?? []).filter(c => canJoin(c, today)).length

// The last day counts as one day left.
export const daysLeft = (c: Challenge, today: string): number => daysInclusive(today, c.ends_on)

// The first day the result exists: the server closes a challenge once the creator's today is past
// ends_on + GRACE (close_due_challenges, close_all_challenges).
export const resultOn = (c: Pick<Challenge, 'template' | 'ends_on'>): string => addDays(c.ends_on, GRACE[c.template] + 1)
