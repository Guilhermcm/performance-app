import type { Progress, WeekProgress } from '../gamification/types'

export type Person = { id: string; name: string; avatar_url: string | null }

// progress_card (supabase/migrations/0002_gamification.sql): what friends may see of a Progress.
export type FriendCard = Omit<Progress, 'today' | 'stats' | 'week'> & { week: Omit<WeekProgress, 'weighed_today'> }

export type Friend = Person & { since: string; shares_activity: boolean; card: FriendCard }

export type MyInvite = { code: string; created_at: string; expires_at: string }
export type InviteStatus = 'open' | 'expired' | 'used' | 'self' | 'already_friends'
export type InviteInfo = { status: InviteStatus; expires_at: string; inviter: { name: string; avatar_url: string | null } }

export type LeaderboardRow = Person & {
  me: boolean
  xp: number
  level: number
  pos: number
  prev_pos: number
  gap: number | null
}
export type Leaderboard = { week_start: string; rows: LeaderboardRow[] }

export type ChallengeTemplate = 'workouts_count' | 'weeks_on_target' | 'volume_total'
export type ChallengeMode = 'team' | 'solo'
export type ChallengeStatus = 'active' | 'won' | 'lost' | 'cancelled'
export type ChallengeMember = Person & { me: boolean; joined: boolean; progress: number | null; won: boolean | null }

// One entry of get_challenges (supabase/migrations/0004_social.sql, challenge_json).
export type Challenge = {
  id: string
  template: ChallengeTemplate
  title: string
  mode: ChallengeMode
  target: number
  starts_on: string
  ends_on: string
  status: ChallengeStatus
  created_by: string | null // null once the creator deleted their account
  invited_by: string | null // display name of who invited me (null for the creator)
  total: number
  me: { joined: boolean; won: boolean | null }
  members: ChallengeMember[]
}

export type NewChallenge = {
  template: ChallengeTemplate
  title: string
  mode: ChallengeMode
  target: number
  starts_on: string
  ends_on: string
  invitees: string[]
  share_volume: boolean
}

export type FeedItem = { id: number; at: string; day: string; user: Person; sets: number | null; prs: string[] }
export type FeedCursor = { before: string; before_id: number }
export type FeedPage = { items: FeedItem[]; next: FeedCursor | null }

export type SocialErrorCode =
  | 'not_signed_in' | 'no_profile'
  | 'invite_not_found' | 'invite_expired' | 'invite_used' | 'self_invite' | 'already_friends' | 'invite_limit'
  | 'not_friends' | 'invalid_challenge' | 'challenge_limit' | 'challenge_not_found' | 'challenge_closed'
  | 'volume_opt_in_required'
  | 'network'
