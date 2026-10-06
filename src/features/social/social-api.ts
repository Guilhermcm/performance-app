import { supabase } from '@/lib/supabase'
import type {
  Challenge, FeedCursor, FeedPage, Friend, InviteInfo, Leaderboard, MyInvite, NewChallenge, Person, SocialErrorCode
} from './types'

const CODES: readonly SocialErrorCode[] = [
  'not_signed_in', 'no_profile', 'invite_not_found', 'invite_expired', 'invite_used', 'self_invite',
  'already_friends', 'invite_limit', 'not_friends', 'invalid_challenge', 'challenge_limit',
  'challenge_not_found', 'challenge_closed', 'volume_opt_in_required', 'nutrition_opt_in_required', 'nutrition_off'
]

export class SocialError extends Error {
  readonly code: SocialErrorCode
  constructor(code: SocialErrorCode) {
    super(code)
    this.name = 'SocialError'
    this.code = code
  }
}

// The database raises its typed errors with the code as the message (0004_social.sql). Anything
// else (no network, an expired session, a server we cannot explain) is "try again".
export function toSocialError(e: unknown): SocialError {
  if (e instanceof SocialError) return e
  const msg = (e as { message?: unknown } | null)?.message
  return new SocialError(typeof msg === 'string' && (CODES as readonly string[]).includes(msg) ? (msg as SocialErrorCode) : 'network')
}

type RpcAnswer = { data: unknown; error: { message: string } | null }
// The social RPCs are not in database.types.ts; their shapes live in ./types.
const callRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<RpcAnswer>)(fn, args)

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: RpcAnswer
  try { res = await callRpc(fn, args) } catch (e) { throw toSocialError(e) }
  if (res.error) throw toSocialError(res.error)
  return res.data as T
}

export const createInvite = () => rpc<{ code: string; expires_at: string }>('create_invite')
export const getInvite = (code: string) => rpc<InviteInfo>('get_invite', { p_code: code })
export const acceptInvite = async (code: string): Promise<Person> =>
  (await rpc<{ friend: Person }>('accept_invite', { p_code: code })).friend

export async function listMyInvites(now: Date = new Date()): Promise<MyInvite[]> {
  const { data, error } = await supabase.from('friend_invites').select('code, created_at, expires_at')
    .is('used_at', null).gt('expires_at', now.toISOString()).order('created_at', { ascending: false })
  if (error) throw toSocialError(error)
  return (data ?? []) as MyInvite[]
}

export async function cancelInvite(code: string): Promise<void> {
  const { error } = await supabase.from('friend_invites').delete().eq('code', code)
  if (error) throw toSocialError(error)
}

// friendships keeps the pair ordered (user_a < user_b); lowercase uuid strings sort like uuids.
export async function removeFriend(me: string, friend: string): Promise<void> {
  const [a, b] = me < friend ? [me, friend] : [friend, me]
  const { error } = await supabase.from('friendships').delete().eq('user_a', a).eq('user_b', b)
  if (error) throw toSocialError(error)
}

export const getFriends = () => rpc<Friend[]>('get_friends')
export const getWeeklyLeaderboard = () => rpc<Leaderboard>('get_weekly_leaderboard')
export const getAlltimeLeaderboard = () => rpc<Leaderboard>('get_alltime_leaderboard')
export const getChallenges = () => rpc<Challenge[]>('get_challenges')

// Every parameter by name (0015_nutrition_challenge.sql): PostgREST picks the function by the names
// sent, so a call stays unambiguous while old and new signatures meet during a deploy, and
// social-api.test.ts checks the names against the newest migration.
export const createChallenge = async (c: NewChallenge): Promise<string> =>
  (await rpc<{ id: string }>('create_challenge', {
    p_template: c.template, p_title: c.title, p_mode: c.mode, p_target: c.target,
    p_starts_on: c.starts_on, p_ends_on: c.ends_on, p_invitees: c.invitees, p_share_volume: c.share_volume,
    p_share_nutrition: c.share_nutrition
  })).id

// The opt-ins a template asks for when joining: volume_total shares the volume, the nutrition
// template the count of days on target.
export type JoinOptIns = { shareVolume?: boolean; shareNutrition?: boolean }
export const joinChallenge = async (id: string, { shareVolume = false, shareNutrition = false }: JoinOptIns = {}): Promise<void> => {
  await rpc<null>('join_challenge', { p_id: id, p_share_volume: shareVolume, p_share_nutrition: shareNutrition })
}
export const leaveChallenge = async (id: string): Promise<void> => {
  await rpc<null>('leave_challenge', { p_id: id })
}

export const getFeed = (cursor: FeedCursor | null = null) =>
  rpc<FeedPage>('get_feed', cursor ? { p_before: cursor.before, p_before_id: cursor.before_id } : {})
