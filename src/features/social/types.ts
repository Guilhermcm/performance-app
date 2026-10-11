import type { CheckinActivity, CheckinDetail, CheckinVisibility } from '../checkin/types'
import type { Progress, WeekProgress } from '../gamification/types'

export type Person = { id: string; name: string; avatar_url: string | null }

// progress_card (supabase/migrations/0012_nutrition_progress.sql): what friends may see of a
// Progress. No private badges, no nutrition block, no radar.
export type FriendCard = Omit<Progress, 'today' | 'stats' | 'week' | 'nutrition' | 'radar'> & { week: Omit<WeekProgress, 'weighed_today'> }

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

export type ChallengeTemplate = 'workouts_count' | 'weeks_on_target' | 'volume_total' | 'nutrition_days_on_target'
export type ChallengeMode = 'team' | 'solo'
export type ChallengeStatus = 'active' | 'won' | 'lost' | 'cancelled'
export type ChallengeMember = Person & { me: boolean; joined: boolean; progress: number | null; won: boolean | null }

// One entry of get_challenges (supabase/migrations/0004_social.sql, challenge_json). For a
// nutrition challenge a member's progress is only their count of days on target (0015).
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
  share_nutrition: boolean
}

export type FeedItem = { id: number; at: string; day: string; user: Person; sets: number | null; prs: string[] }
export type FeedCursor = { before: string; before_id: number }
export type FeedPage = { items: FeedItem[]; next: FeedCursor | null }

// The check-in feed (get_checkin_feed, supabase/migrations/0020_checkin_feed.sql). A post never
// carries the private note or the workout detail. Reactions come grouped, most used first.
export type ReactionGroup = { emoji: string; count: number; mine: boolean }

export type CheckinFeedItem = {
  type: 'checkin'
  key: string // 'checkin:<id>'
  at: string
  day: string
  user: Person
  activity: CheckinActivity
  title: string
  caption: string | null
  duration_min: number | null
  visibility: CheckinVisibility
  photo_path: string
  // "3rd workout of the week", "6 week streak". Null on a post of mine still waiting to go up.
  context: { week_count: number; streak: number } | null
  reactions: ReactionGroup[]
  comments_count: number
  // Mine and still in the outbox: shown as "sending", with the photo from this phone.
  pending?: boolean
  photo?: Blob
}

// A workout_completed from before the check-in cutover, as the old feed showed it.
export type WorkoutFeedItem = { type: 'workout'; key: string; at: string; day: string; user: Person; sets: number | null; prs: string[] }

export type CheckinFeedEntry = CheckinFeedItem | WorkoutFeedItem
export type CheckinFeedCursor = { before: string; before_key: string }
export type CheckinFeedPage = { items: CheckinFeedEntry[]; next: CheckinFeedCursor | null }

// get_challenge_feed: a post the caller may see comes whole; any other only as a stub that still
// counts on the board ("Check-in privado"), with no photo, title, caption or activity.
export type PrivateCheckinItem = { type: 'checkin'; key: string; at: string; day: string; user: Person; private: true }
export type ChallengeFeedEntry = (CheckinFeedItem & { private: false }) | PrivateCheckinItem
export type ChallengeFeedPage = { items: ChallengeFeedEntry[]; next: CheckinFeedCursor | null }

export type CheckinComment = { id: number; user: Person; body: string; created_at: string; can_delete: boolean }

// get_checkin: one post with who reacted and its comments. note and detail only on my own posts.
export type CheckinView = {
  id: string
  user: Person
  day: string
  activity: CheckinActivity
  routine_name: string | null
  title: string
  caption: string | null
  duration_min: number | null
  visibility: CheckinVisibility
  photo_path: string
  created_at: string
  reactions: (ReactionGroup & { users: Person[] })[]
  comments: CheckinComment[]
  note?: string | null
  detail?: CheckinDetail | null
}

// get_notices (0018_checkin_social.sql), newest first. The titles are null once the post or the
// challenge is gone.
export type NoticeKind = 'reaction' | 'comment' | 'challenge_invite'
export type SocialNotice = {
  id: number
  kind: NoticeKind
  actor: Person
  checkin_id: string | null
  checkin_title: string | null
  challenge_id: string | null
  challenge_title: string | null
  created_at: string
  read: boolean
}
export type NoticesPage = { items: SocialNotice[]; unread: number }

export type SocialErrorCode =
  | 'not_signed_in' | 'no_profile'
  | 'invite_not_found' | 'invite_expired' | 'invite_used' | 'self_invite' | 'already_friends' | 'invite_limit'
  | 'not_friends' | 'invalid_challenge' | 'challenge_limit' | 'challenge_not_found' | 'challenge_closed'
  | 'volume_opt_in_required' | 'nutrition_opt_in_required' | 'nutrition_off'
  | 'not_found' | 'invalid_emoji' | 'invalid_comment' | 'too_many_reactions'
  | 'network'
