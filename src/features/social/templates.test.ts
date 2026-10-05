import { describe, it, expect } from 'vitest'
import {
  addDays, challengeShare, checkChallenge, daysInclusive, daysLeft, mondayOf, nextMonday,
  pendingInvites, suggestedTarget, targetRange, weeksTouched
} from './templates'
import { challengeOf } from './test-social'
import type { NewChallenge } from './types'

const today = '2026-10-05'
const draft = (over: Partial<NewChallenge> = {}): NewChallenge => ({
  template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
  starts_on: '2026-10-05', ends_on: '2026-10-18', invitees: ['b'], share_volume: false, ...over
})

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
    expect(targetRange('workouts_count', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 500 })
    expect(targetRange('volume_total', '2026-10-05', '2026-11-03')).toEqual({ min: 1, max: 5000 })
  })

  it('suggests a goal from the weekly target, the period and the team', () => {
    expect(suggestedTarget('workouts_count', 'team', '2026-10-05', '2026-11-03', 3, 2)).toBe(24)
    expect(suggestedTarget('workouts_count', 'solo', '2026-10-05', '2026-11-03', 3, 2)).toBe(12)
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
    expect(pendingInvites(null)).toBe(0)
    expect(pendingInvites([challengeOf(), challengeOf({ id: 'c2', me: { joined: false, won: null } }),
      challengeOf({ id: 'c3', status: 'won', me: { joined: false, won: null } })])).toBe(1)
  })

  it('counts the last day as one day left', () => {
    expect(daysLeft(challengeOf(), '2026-10-18')).toBe(1)
    expect(daysLeft(challengeOf(), '2026-10-05')).toBe(14)
  })
})
