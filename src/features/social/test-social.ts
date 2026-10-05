import { progressOf } from '../gamification/test-progress'
import type { Challenge, FeedItem, Friend, FriendCard, LeaderboardRow } from './types'

export const ME = '00000000-0000-0000-0000-00000000000a'
export const BIA = '00000000-0000-0000-0000-00000000000b'
export const CAIO = '00000000-0000-0000-0000-00000000000c'

export function friendOf(id: string, name: string, over: Partial<Friend> = {}): Friend {
  const p = progressOf(400, { xp: 250, workouts: 2 }, { streak: { current: 3, best: 5, shields: 1 } })
  const w = p.week
  const card: FriendCard = {
    total_xp: p.total_xp, level: p.level, pillars: p.pillars, streak: p.streak, achievements: p.achievements,
    week: { start: w.start, xp: w.xp, max: w.max, target: w.target, workouts: w.workouts, extras: w.extras, prs: w.prs, target_hit: w.target_hit, pillars: w.pillars }
  }
  return { id, name, avatar_url: null, since: '2026-10-01T12:00:00Z', shares_activity: true, card, ...over }
}

export const rowOf = (id: string, name: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow =>
  ({ id, name, avatar_url: null, me: id === ME, xp: 0, level: 1, pos: 1, prev_pos: 1, gap: null, ...over })

// Ana (me) and Bia in a two-week team challenge for 6 workouts, 3 done.
export function challengeOf(over: Partial<Challenge> = {}): Challenge {
  return {
    id: 'c1', template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
    starts_on: '2026-10-05', ends_on: '2026-10-18', status: 'active', created_by: ME, invited_by: null,
    total: 3, me: { joined: true, won: null },
    members: [
      { id: ME, name: 'Ana', avatar_url: null, me: true, joined: true, progress: 2, won: null },
      { id: BIA, name: 'Bia', avatar_url: null, me: false, joined: true, progress: 1, won: null }
    ],
    ...over
  }
}

export const feedItemOf = (id: number, over: Partial<FeedItem> = {}): FeedItem =>
  ({ id, at: '2026-10-07T18:30:00Z', day: '2026-10-07', user: { id: BIA, name: 'Bia', avatar_url: null }, sets: 18, prs: [], ...over })
