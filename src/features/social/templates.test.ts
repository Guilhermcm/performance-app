import { describe, it, expect } from 'vitest'
import {
  GRACE, MODES, TARGET_STEP, TEMPLATES, addDays, challengeShare, checkChallenge, daysInclusive, daysLeft, mondayOf, nextMonday,
  canJoin, pendingInvites, rankMembers, resultOn, habitsWeekly, suggestHabitTarget, suggestedTarget, targetRange, weeksTouched
} from './templates'
import { challengeOf } from './test-social'
import type { NewChallenge } from './types'

const today = '2026-10-05'
const draft = (over: Partial<NewChallenge> = {}): NewChallenge => ({
  template: 'checkin_days', title: 'Outubro forte', mode: 'team', target: 6,
  starts_on: '2026-10-05', ends_on: '2026-10-18', invitees: ['b'], share_volume: false, share_nutrition: false, share_sleep: false, share_habits: false,
  ...over
})
const NUT = 'nutrition_days_on_target' as const
const SLEEP = 'sleep_nights_on_target' as const
const HABITS = 'habit_checks' as const

describe('calendar helpers', () => {
  it('count days and weeks like the database', () => {
    expect(addDays('2026-10-05', 13)).toBe('2026-10-18')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(daysInclusive('2026-10-05', '2026-10-18')).toBe(14)
    expect(mondayOf('2026-10-11')).toBe('2026-10-05')
    expect(mondayOf('2026-10-05')).toBe('2026-10-05')
    expect(nextMonday('2026-10-07')).toBe('2026-10-12')
    expect(nextMonday('2026-10-05')).toBe('2026-10-12')
    expect(weeksTouched('2026-10-05', '2026-10-18')).toBe(2)
    expect(weeksTouched('2026-10-07', '2026-10-13')).toBe(2)
  })
})

describe('checkChallenge (mirror of create_challenge)', () => {
  it('accepts a valid challenge and the edges', () => {
    expect(checkChallenge(draft(), today)).toBeNull()
    expect(checkChallenge(draft({ ends_on: '2026-10-11' }), today)).toBeNull()
    expect(checkChallenge(draft({ ends_on: '2027-01-04' }), today)).toBeNull()
    expect(checkChallenge(draft({ starts_on: '2026-11-04', ends_on: '2026-11-10' }), today)).toBeNull()
    expect(checkChallenge(draft({ invitees: Array.from({ length: 19 }, (_, i) => 'p' + i) }), today)).toBeNull()
    expect(checkChallenge(draft({ title: '\u{1F4AA}'.repeat(60) }), today)).toBeNull()
  })

  it.each([
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(61) }, 'title'],
    [{ template: 'weeks_on_target', mode: 'team', target: 1 }, 'mode'],
    [{ ends_on: '2026-10-10' }, 'dates'],
    [{ ends_on: '2027-01-05' }, 'dates'],
    [{ starts_on: '2026-10-04', ends_on: '2026-10-17' }, 'dates'],
    [{ starts_on: '2026-11-05', ends_on: '2026-11-18' }, 'dates'],
    [{ target: 0 }, 'target'],
    [{ target: 2.5 }, 'target'],
    [{ target: 501 }, 'target'],
    [{ template: 'weeks_on_target', mode: 'solo', target: 3 }, 'target'],
    [{ invitees: [] }, 'invitees'],
    [{ invitees: Array.from({ length: 20 }, (_, i) => 'p' + i) }, 'invitees'],
    [{ template: 'volume_total', target: 20 }, 'volume']
  ] as [Partial<NewChallenge>, string][])('refuses %j as %s', (over, problem) => {
    expect(checkChallenge(draft(over), today)).toBe(problem)
  })
})

describe('targets', () => {
  it('bounds weeks_on_target by the weeks the period touches', () => {
    expect(targetRange('weeks_on_target', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 5 })
    expect(targetRange('checkin_days', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 500 })
    expect(targetRange('workouts_count', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 500 })
    expect(targetRange('volume_total', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 5000 })
  })

  it('suggests a goal from the weekly target, the period and the team', () => {
    expect(suggestedTarget('checkin_days', 'team', '2026-10-05', '2026-11-03', 3, 2)).toBe(24)
    expect(suggestedTarget('checkin_days', 'solo', '2026-10-05', '2026-11-03', 3, 2)).toBe(12)
    expect(suggestedTarget('workouts_count', 'team', '2026-10-05', '2026-11-03', 3, 2)).toBe(24)
    expect(suggestedTarget('weeks_on_target', 'solo', '2026-10-05', '2026-11-03', 3, 2)).toBe(4)
    expect(suggestedTarget('volume_total', 'team', '2026-10-05', '2026-11-03', 3, 2)).toBe(40)
  })
})

describe('progress helpers', () => {
  it('measures the team total or my own progress', () => {
    expect(challengeShare(challengeOf())).toBe(0.5)
    expect(challengeShare(challengeOf({ mode: 'solo', target: 2 }))).toBe(1)
    expect(challengeShare(challengeOf({ total: 60 }))).toBe(1)
  })

  it('counts invitations waiting for an answer', () => {
    const today = '2026-10-06'
    expect(pendingInvites(null, today)).toBe(0)
    expect(pendingInvites([challengeOf(), challengeOf({ id: 'c2', me: { joined: false, won: null } }),
      challengeOf({ id: 'c3', status: 'won', me: { joined: false, won: null } })], today)).toBe(1)
  })

  it('stops counting an invitation once its last day has passed, even while the challenge is still active', () => {
    const invite = challengeOf({ template: 'nutrition_days_on_target', ends_on: '2026-10-18', me: { joined: false, won: null } })
    expect(pendingInvites([invite], '2026-10-18')).toBe(1)
    expect(canJoin(invite, '2026-10-18')).toBe(true)
    expect(pendingInvites([invite], '2026-10-19')).toBe(0)
    expect(canJoin(invite, '2026-10-19')).toBe(false)
  })

  it('ranks the people who joined by progress, ties sharing a position, and leaves the invited last', () => {
    const m = (id: string, progress: number | null, joined = true) => ({ id, name: id, avatar_url: null, me: id === 'me', joined, progress, won: null })
    const ranked = rankMembers(challengeOf({ members: [m('a', 3), m('me', 5), m('b', 5), m('inv', null, false), m('z', 0)] }))
    expect(ranked.map(r => [r.member.id, r.pos])).toEqual([['me', 1], ['b', 1], ['a', 3], ['z', 4], ['inv', null]])
    expect(rankMembers(challengeOf({ members: [m('a', null), m('b', 2)] })).map(r => [r.member.id, r.pos])).toEqual([['b', 1], ['a', 2]])
  })

  it('counts the last day as one day left', () => {
    expect(daysLeft(challengeOf(), '2026-10-18')).toBe(1)
    expect(daysLeft(challengeOf(), '2026-10-05')).toBe(14)
  })
})

describe('checkin_days (training days)', () => {
  it('is the template people create, for teams and for solo; the old ones are not offered', () => {
    expect(TEMPLATES).toEqual(['checkin_days', 'weeks_on_target', 'nutrition_days_on_target', 'sleep_nights_on_target', 'habit_checks'])
    expect(TEMPLATES).not.toContain('workouts_count')
    expect(TEMPLATES).not.toContain('volume_total')
    expect(MODES.checkin_days).toEqual(['team', 'solo'])
    // The old templates stay known, for the challenges already running.
    expect(MODES.workouts_count).toEqual(['team', 'solo'])
    expect(MODES.volume_total).toEqual(['team', 'solo'])
  })

  it('takes the goal range of workouts_count, as create_challenge does', () => {
    expect(TARGET_STEP.checkin_days).toBe(1)
    expect(checkChallenge(draft({ target: 1 }), today)).toBeNull()
    expect(checkChallenge(draft({ target: 500 }), today)).toBeNull()
    expect(checkChallenge(draft({ target: 501 }), today)).toBe('target')
    expect(checkChallenge(draft({ target: 0 }), today)).toBe('target')
    expect(checkChallenge(draft({ target: 2.5 }), today)).toBe('target')
    expect(checkChallenge(draft({ mode: 'solo', target: 10 }), today)).toBeNull()
  })

  it('asks for no opt-in and for neither the Nutrition nor the Sleep pillar', () => {
    expect(checkChallenge(draft({ share_volume: false, share_nutrition: false }), today, { nutritionOn: false, sleepOn: false })).toBeNull()
  })
})

// The same rules as create_challenge in supabase/migrations/0015_nutrition_challenge.sql;
// supabase/tests/challenge-rules-parity.test.ts runs both against the same cases.
describe('nutrition_days_on_target', () => {
  const nut = (over: Partial<NewChallenge> = {}) => draft({ template: NUT, target: 10, share_nutrition: true, ...over })
  const on = { nutritionOn: true }

  it('is a template for teams and for solo', () => {
    expect(TEMPLATES).toContain(NUT)
    expect(MODES[NUT]).toEqual(['team', 'solo'])
  })

  it('bounds the goal by the days, times the people in a team', () => {
    expect(targetRange(NUT, '2026-10-05', '2026-10-11', 'solo', 1)).toEqual({ min: 1, max: 7 })
    expect(targetRange(NUT, '2026-10-05', '2026-10-11', 'team', 1)).toEqual({ min: 1, max: 14 })
    expect(targetRange(NUT, '2026-10-05', '2026-10-11', 'team', 2)).toEqual({ min: 1, max: 21 })
    expect(targetRange(NUT, '2026-10-05', '2027-01-04', 'solo', 19)).toEqual({ min: 1, max: 92 })
    expect(targetRange(NUT, '2026-10-05', '2027-01-04', 'team', 19)).toEqual({ min: 1, max: 1840 })
  })

  it('suggests the weekly days on target over the period, per person in a team', () => {
    expect(suggestedTarget(NUT, 'solo', '2026-10-05', '2026-11-03', 5, 2)).toBe(21)
    expect(suggestedTarget(NUT, 'team', '2026-10-05', '2026-11-03', 5, 2)).toBe(42)
    expect(suggestedTarget(NUT, 'solo', '2026-10-05', '2026-10-11', 7, 1)).toBe(7)
  })

  it('accepts the edges', () => {
    expect(checkChallenge(nut(), today, on)).toBeNull()
    expect(checkChallenge(nut({ mode: 'solo', target: 14 }), today, on)).toBeNull()
    expect(checkChallenge(nut({ mode: 'team', target: 28 }), today, on)).toBeNull()
    expect(checkChallenge(nut({ mode: 'team', target: 42, invitees: ['b', 'c'] }), today, on)).toBeNull()
  })

  it.each([
    [{ mode: 'solo', target: 15 }, 'target'],
    [{ mode: 'team', target: 29 }, 'target'],
    [{ mode: 'team', target: 43, invitees: ['b', 'c'] }, 'target'],
    [{ target: 0 }, 'target'],
    [{ ends_on: '2027-01-05' }, 'dates'],
    [{ share_nutrition: false }, 'nutrition']
  ] as [Partial<NewChallenge>, string][])('refuses %j as %s', (over, problem) => {
    expect(checkChallenge(nut(over), today, on)).toBe(problem)
  })

  it('needs the pillar on, before the opt-in', () => {
    expect(checkChallenge(nut(), today, { nutritionOn: false })).toBe('nutrition_off')
    expect(checkChallenge(nut({ share_nutrition: false }), today)).toBe('nutrition_off')
    // The other templates do not care about the pillar.
    expect(checkChallenge(draft(), today, { nutritionOn: false })).toBeNull()
  })

  it('gives the result two days later for templates paid by closed days, as challenge_grace does', () => {
    expect(GRACE).toEqual({
      checkin_days: 2, workouts_count: 2, weeks_on_target: 2, volume_total: 0, nutrition_days_on_target: 2, sleep_nights_on_target: 2,
      habit_checks: 2
    })
    // ends_on 2026-10-18: its last day closes at the start of the 20th, the challenge on the 21st.
    expect(resultOn(challengeOf({ template: NUT }))).toBe('2026-10-21')
    expect(resultOn(challengeOf())).toBe('2026-10-21')
    expect(resultOn(challengeOf({ template: 'checkin_days' }))).toBe('2026-10-21')
    expect(resultOn(challengeOf({ template: 'volume_total' }))).toBe('2026-10-19')
  })
})

// The same rules as create_challenge in supabase/migrations/0024_sleep_challenge.sql;
// supabase/tests/challenge-rules-parity.test.ts runs both against the same cases.
describe('sleep_nights_on_target', () => {
  const sleep = (over: Partial<NewChallenge> = {}) => draft({ template: SLEEP, target: 10, share_sleep: true, ...over })
  const on = { sleepOn: true }

  it('is a template for teams and for solo, a night at a time', () => {
    expect(TEMPLATES).toContain(SLEEP)
    expect(MODES[SLEEP]).toEqual(['team', 'solo'])
    expect(TARGET_STEP[SLEEP]).toBe(1)
  })

  it('bounds the goal by the nights of the period, times the people in a team', () => {
    expect(targetRange(SLEEP, '2026-10-05', '2026-10-11', 'solo', 1)).toEqual({ min: 1, max: 7 })
    expect(targetRange(SLEEP, '2026-10-05', '2026-10-11', 'team', 1)).toEqual({ min: 1, max: 14 })
    expect(targetRange(SLEEP, '2026-10-05', '2026-10-11', 'team', 2)).toEqual({ min: 1, max: 21 })
    expect(targetRange(SLEEP, '2026-10-05', '2027-01-04', 'solo', 19)).toEqual({ min: 1, max: 92 })
    expect(targetRange(SLEEP, '2026-10-05', '2027-01-04', 'team', 19)).toEqual({ min: 1, max: 1840 })
  })

  it('suggests the weekly nights on target over the period, per person in a team', () => {
    expect(suggestedTarget(SLEEP, 'solo', '2026-10-05', '2026-11-03', 5, 2)).toBe(21)
    expect(suggestedTarget(SLEEP, 'team', '2026-10-05', '2026-11-03', 5, 2)).toBe(42)
    expect(suggestedTarget(SLEEP, 'solo', '2026-10-05', '2026-10-11', 7, 1)).toBe(7)
    expect(suggestedTarget(SLEEP, 'solo', '2026-10-05', '2026-11-03', 3, 1)).toBe(13)
  })

  it('accepts the edges', () => {
    expect(checkChallenge(sleep(), today, on)).toBeNull()
    expect(checkChallenge(sleep({ mode: 'solo', target: 14 }), today, on)).toBeNull()
    expect(checkChallenge(sleep({ mode: 'team', target: 28 }), today, on)).toBeNull()
    expect(checkChallenge(sleep({ mode: 'team', target: 42, invitees: ['b', 'c'] }), today, on)).toBeNull()
  })

  it.each([
    [{ mode: 'solo', target: 15 }, 'target'],
    [{ mode: 'team', target: 29 }, 'target'],
    [{ mode: 'team', target: 43, invitees: ['b', 'c'] }, 'target'],
    [{ target: 0 }, 'target'],
    [{ target: 2.5 }, 'target'],
    [{ ends_on: '2027-01-05' }, 'dates'],
    [{ share_sleep: false }, 'sleep']
  ] as [Partial<NewChallenge>, string][])('refuses %j as %s', (over, problem) => {
    expect(checkChallenge(sleep(over), today, on)).toBe(problem)
  })

  it('needs the pillar on, before the opt-in, as the server checks them', () => {
    expect(checkChallenge(sleep(), today, { sleepOn: false })).toBe('sleep_off')
    expect(checkChallenge(sleep({ share_sleep: false }), today)).toBe('sleep_off')
    // The shape comes first, as on the server.
    expect(checkChallenge(sleep({ target: 0, share_sleep: false }), today)).toBe('target')
    // Nutrition does not open the sleep template, nor the sleep opt-in the nutrition one.
    expect(checkChallenge(sleep({ share_nutrition: true }), today, { nutritionOn: true })).toBe('sleep_off')
    expect(checkChallenge(draft({ template: NUT, target: 10, share_sleep: true }), today, { nutritionOn: true, sleepOn: true })).toBe('nutrition')
    // The other templates do not care about the pillar.
    expect(checkChallenge(draft(), today, { sleepOn: false })).toBeNull()
  })

  it('gives the result two days after the last night, as challenge_grace does', () => {
    expect(GRACE[SLEEP]).toBe(2)
    // ends_on 2026-10-18: that night closes at the start of the 20th, the challenge on the 21st.
    expect(resultOn(challengeOf({ template: SLEEP }))).toBe('2026-10-21')
  })
})

// The same rules as create_challenge in supabase/migrations/0029_habits_challenge.sql;
// supabase/tests/challenge-rules-parity.test.ts runs both against the same cases.
describe('habit_checks', () => {
  const habits = (over: Partial<NewChallenge> = {}) => draft({ template: HABITS, target: 20, share_habits: true, ...over })
  const on = { habitsOn: true }

  it('is the last template, for teams and for solo, a check at a time', () => {
    expect(TEMPLATES[TEMPLATES.length - 1]).toBe(HABITS)
    expect(MODES[HABITS]).toEqual(['team', 'solo'])
    expect(TARGET_STEP[HABITS]).toBe(1)
  })

  it('bounds the goal by 10 checks a day of the period, times the people in a team', () => {
    expect(targetRange(HABITS, '2026-10-05', '2026-10-18', 'solo', 1)).toEqual({ min: 1, max: 140 })
    expect(targetRange(HABITS, '2026-10-05', '2026-10-18', 'solo', 2)).toEqual({ min: 1, max: 140 })
    expect(targetRange(HABITS, '2026-10-05', '2026-10-18', 'team', 1)).toEqual({ min: 1, max: 280 })
    expect(targetRange(HABITS, '2026-10-05', '2026-10-18', 'team', 2)).toEqual({ min: 1, max: 420 })
    expect(targetRange(HABITS, '2026-10-05', '2027-01-04', 'team', 19)).toEqual({ min: 1, max: 18400 })
  })

  it('accepts the edges', () => {
    expect(checkChallenge(habits(), today, on)).toBeNull()
    expect(checkChallenge(habits({ mode: 'solo', target: 140 }), today, on)).toBeNull()
    expect(checkChallenge(habits({ mode: 'team', target: 420, invitees: ['b', 'c'] }), today, on)).toBeNull()
    expect(checkChallenge(habits({ target: 1 }), today, on)).toBeNull()
  })

  it.each([
    [{ mode: 'solo', target: 141 }, 'target'],
    [{ mode: 'team', target: 281 }, 'target'],
    [{ mode: 'team', target: 421, invitees: ['b', 'c'] }, 'target'],
    [{ target: 0 }, 'target'],
    [{ target: 2.5 }, 'target'],
    [{ ends_on: '2027-01-05' }, 'dates'],
    [{ share_habits: false }, 'habits']
  ] as [Partial<NewChallenge>, string][])('refuses %j as %s', (over, problem) => {
    expect(checkChallenge(habits(over), today, on)).toBe(problem)
  })

  it('needs the pillar on, before the opt-in, as the server checks them', () => {
    expect(checkChallenge(habits(), today, { habitsOn: false })).toBe('habits_off')
    expect(checkChallenge(habits({ share_habits: false }), today)).toBe('habits_off')
    // The shape comes first, as on the server.
    expect(checkChallenge(habits({ target: 0, share_habits: false }), today)).toBe('target')
    // Another pillar does not open the habits template, nor its opt-in another one.
    expect(checkChallenge(habits({ share_sleep: true, share_nutrition: true }), today, { nutritionOn: true, sleepOn: true })).toBe('habits_off')
    expect(checkChallenge(habits({ share_habits: false, share_sleep: true }), today, { habitsOn: true })).toBe('habits')
    expect(checkChallenge(draft({ template: SLEEP, target: 10, share_habits: true }), today, { sleepOn: true, habitsOn: true })).toBe('sleep')
    // The other templates do not care about the pillar.
    expect(checkChallenge(draft(), today, { habitsOn: false })).toBeNull()
  })

  it('suggests Q checks a week over the period, or the weekly goals of the active habits while Q is 0 (plan decision 19)', () => {
    expect(suggestHabitTarget(habitsWeekly(10, 10), 14)).toBe(20)
    expect(suggestHabitTarget(habitsWeekly(10, 3), 14)).toBe(20)
    expect(suggestHabitTarget(habitsWeekly(0, 6), 7)).toBe(6)
    expect(suggestHabitTarget(habitsWeekly(0, 0), 7)).toBe(1)
    expect(suggestHabitTarget(habitsWeekly(5, 0), 30)).toBe(21)
    // Per person in a team, and never past the range.
    expect(suggestedTarget(HABITS, 'solo', '2026-10-05', '2026-10-18', 10, 3)).toBe(20)
    expect(suggestedTarget(HABITS, 'team', '2026-10-05', '2026-10-18', 10, 3)).toBe(60)
    expect(suggestedTarget(HABITS, 'solo', '2026-10-05', '2026-10-11', 0, 1)).toBe(1)
    expect(suggestedTarget(HABITS, 'solo', '2026-10-05', '2026-10-11', 140, 1)).toBe(70)
  })

  it('gives the result two days after the last day, as challenge_grace does', () => {
    expect(GRACE[HABITS]).toBe(2)
    // ends_on 2026-10-18: that day closes at the start of the 20th, the challenge on the 21st.
    expect(resultOn(challengeOf({ template: HABITS }))).toBe('2026-10-21')
  })
})
