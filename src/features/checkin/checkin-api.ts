// Check-ins on the server: the photos in the private bucket `checkins`, the own rows of
// public.checkins, and the RPCs through which other accounts' posts are read (0017 to 0020).
// Writes the outbox sends throw a classified error (refused for good, or try again); reads and
// the social RPCs throw a SocialError with a code the screens can explain.
import { supabase } from '@/lib/supabase'
import { NutritionError, classify } from '@/lib/supabase-errors'
import { SocialError } from '../social/social-api'
import type {
  ChallengeFeedPage, CheckinFeedCursor, CheckinFeedPage, CheckinView, NoticesPage, SocialErrorCode
} from '../social/types'
import type { CheckinDetail, CheckinRow } from './types'

const BUCKET = 'checkins'
// A signed link lives an hour on the server; it is reused for 55 minutes, so none shown expires.
const LINK_SECONDS = 3600
const LINK_REUSE_MS = 55 * 60 * 1000

const bucket = () => supabase.storage.from(BUCKET)

export const photoPath = (userId: string, id: string, ext: 'jpg' | 'webp') => `${userId}/${id}.${ext}`

type StorageErr = { message?: string; status?: number; statusCode?: string | number } | null | undefined

// The bucket takes no file over 600 KB and only JPEG or WebP: sending the same file again cannot
// work. Anything else (no network, an expired session) is tried again later.
function storageError(e: StorageErr | unknown): NutritionError {
  const s = e as StorageErr
  const code = String(s?.statusCode ?? s?.status ?? '')
  if (code === '413' || code === '415') return new NutritionError('network', { refused: true, reason: 'refused', detail: s?.message ?? '' })
  return classify(e)
}

const alreadyThere = (e: StorageErr) =>
  String(e?.statusCode ?? '') === '409' || e?.status === 409 || /already exists|duplicate/i.test(e?.message ?? '')

// Uploads the photo of a check-in. The name is the check-in's id and an upload never overwrites, so
// a photo already there (an earlier try whose answer was lost) is this same photo.
export async function uploadPhoto(userId: string, id: string, blob: Blob, ext: 'jpg' | 'webp'): Promise<string> {
  const path = photoPath(userId, id, ext)
  let res: { error: StorageErr }
  try {
    res = await bucket().upload(path, blob, { contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', upsert: false, cacheControl: '3600' })
  } catch (e) { throw storageError(e) }
  if (res.error && !alreadyThere(res.error)) throw storageError(res.error)
  return path
}

// Removing a photo that is not there is not an error.
export async function removePhoto(path: string): Promise<void> {
  let res: { error: StorageErr }
  try { res = await bucket().remove([path]) } catch (e) { throw storageError(e) }
  if (res.error) throw storageError(res.error)
}

// The whole folder of an account, before the account is deleted (spec 6.3). It lists and removes
// a page at a time until the folder is empty, and stops if a round removes nothing.
export async function removeAllPhotos(userId: string): Promise<void> {
  const PAGE = 1000
  for (let round = 0; round < 100; round++) {
    const { data, error } = await bucket().list(userId, { limit: PAGE, offset: 0 })
    if (error) throw storageError(error)
    const names = (data ?? []).map(f => f.name).filter(Boolean)
    if (!names.length) return
    const res = await bucket().remove(names.map(n => `${userId}/${n}`))
    if (res.error) throw storageError(res.error)
    if (!res.data?.length || names.length < PAGE) return
  }
}

const links = new Map<string, { url: string; at: number }>()

// Signed links for the photos about to be shown. Only the paths without a fresh link are asked
// for; a path the server will not sign (not visible, gone) is left out of the answer.
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const out: Record<string, string> = {}
  const need: string[] = []
  for (const p of new Set(paths)) {
    const hit = links.get(p)
    if (hit && now - hit.at < LINK_REUSE_MS) out[p] = hit.url
    else if (!need.includes(p)) need.push(p)
  }
  for (const [p, l] of links) if (now - l.at >= LINK_REUSE_MS) links.delete(p)
  if (!need.length) return out
  let res: { data: { path: string | null; signedUrl: string | null; error: string | null }[] | null; error: unknown }
  try { res = await bucket().createSignedUrls(need, LINK_SECONDS) } catch { throw new SocialError('network') }
  if (res.error) throw new SocialError('network')
  for (const d of res.data ?? []) {
    if (!d.path || !d.signedUrl || d.error) continue
    links.set(d.path, { url: d.signedUrl, at: now })
    out[d.path] = d.signedUrl
  }
  return out
}

// Sign-out: links are per session.
export function clearSignedUrls(): void { links.clear() }

// A link that failed to show (the friendship ended, the file moved) is not reused: the next ask signs again.
export function forgetSignedUrl(path: string): void { links.delete(path) }

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>
async function write<T>(q: Answer<T>): Promise<T | null> {
  let res: { data: T | null; error: unknown }
  try { res = await q } catch (e) { throw classify(e) }
  if (res.error) throw classify(res.error)
  return res.data
}

// What an edit may change: day, activity and photo never do (checkins_guard, item_immutable).
const editable = (r: CheckinRow) => ({
  routine_id: r.routine_id, routine_name: r.routine_name, title: r.title, caption: r.caption, note: r.note,
  duration_min: r.duration_min, visibility: r.visibility, detail: r.detail, updated_at: r.updated_at
})

const updateRows = (r: CheckinRow) =>
  write<{ id: string }[]>(supabase.from('checkins').update(editable(r) as never).eq('id', r.id).select('id') as never)

// Edits an existing check-in. A row that is gone, or a newer edit already on the server (the
// last write wins by updated_at), updates nothing, and that is fine.
export async function updateCheckin(r: CheckinRow): Promise<void> {
  await updateRows(r)
}

// Puts a new check-in up, or brings it up to date if an earlier try already did. The update goes
// first because an insert, even one that ends in a conflict, runs the day-window check and an old
// day would be refused. Without user_id: the column defaults to auth.uid() and RLS checks it.
export async function upsertCheckin(r: CheckinRow): Promise<void> {
  if ((await updateRows(r))?.length) return
  const row = {
    id: r.id, day: r.day, activity: r.activity, routine_id: r.routine_id, routine_name: r.routine_name, title: r.title,
    caption: r.caption, note: r.note, duration_min: r.duration_min, visibility: r.visibility, photo_path: r.photo_path,
    detail: r.detail, created_at: r.created_at, updated_at: r.updated_at
  }
  try {
    await write(supabase.from('checkins').insert(row as never) as never)
  } catch (e) {
    // There already: it went in between the two calls, or a newer edit kept the old one out.
    if ((e as NutritionError).sqlstate === '23505') return
    throw e
  }
}

export async function deleteCheckin(id: string): Promise<void> {
  await write(supabase.from('checkins').delete().eq('id', id) as never)
}

export async function hasCheckin(id: string): Promise<boolean> {
  const rows = await write<{ id: string }[]>(supabase.from('checkins').select('id').eq('id', id) as never)
  return !!rows?.length
}

// The social side answers with typed messages (0018, 0020); these are the ones a screen explains.
const CODES: readonly SocialErrorCode[] = [
  'not_signed_in', 'not_found', 'invalid_emoji', 'invalid_comment', 'too_many_reactions', 'challenge_not_found'
]
const toError = (e: unknown): SocialError => {
  if (e instanceof SocialError) return e
  const msg = (e as { message?: unknown } | null)?.message
  return new SocialError(typeof msg === 'string' && (CODES as readonly string[]).includes(msg) ? (msg as SocialErrorCode) : 'network')
}

async function read<T>(q: Answer<T>): Promise<T | null> {
  let res: { data: T | null; error: unknown }
  try { res = await q } catch (e) { throw toError(e) }
  if (res.error) throw toError(res.error)
  return res.data
}

type Row = Record<string, unknown>
const toRow = (r: Row): CheckinRow => ({
  id: r.id as string, user_id: r.user_id as string, day: r.day as string, activity: r.activity as CheckinRow['activity'],
  routine_id: (r.routine_id as string | null) ?? null, routine_name: (r.routine_name as string | null) ?? null,
  title: r.title as string, caption: (r.caption as string | null) ?? null, note: (r.note as string | null) ?? null,
  duration_min: r.duration_min == null ? null : Number(r.duration_min), visibility: r.visibility as CheckinRow['visibility'],
  photo_path: r.photo_path as string, detail: (r.detail as CheckinDetail | null) ?? null,
  created_at: r.created_at as string, updated_at: r.updated_at as string
})

// My own check-ins of a range of days, with the private note and detail, newest first.
export async function fetchMyCheckins(from: string, to: string): Promise<CheckinRow[]> {
  const rows = await read<Row[]>(supabase.from('checkins').select('*').gte('day', from).lte('day', to)
    .order('created_at', { ascending: false }) as never)
  return (rows ?? []).map(toRow)
}

export async function hideCheckin(id: string): Promise<void> {
  let res: { error: unknown }
  try { res = await supabase.from('hidden_checkins').insert({ checkin_id: id }) } catch (e) { throw toError(e) }
  // 23505: hidden already.
  if (res.error && (res.error as { code?: unknown }).code !== '23505') throw toError(res.error)
}

// Challenges I am invited to and have not joined yet: the row create_challenge adds per invitee.
// RLS shows the other members too, hence the filter on user_id. Only invites that can still be
// accepted count (the rule of templates.ts canJoin): the challenge is active and `today` (the
// profile's local date) is not past its ends_on. The rows are checked again here in case the
// embedded filter does not apply.
export async function fetchPendingInvites(userId: string, today: string): Promise<string[]> {
  type Row = { challenge_id: string; challenges: { ends_on: string; status: string } | null }
  const rows = await read<Row[]>(supabase.from('challenge_members').select('challenge_id, challenges!inner(ends_on, status)')
    .eq('user_id', userId).is('joined_at', null).not('invited_by', 'is', null)
    .eq('challenges.status', 'active').gte('challenges.ends_on', today) as never)
  return (rows ?? []).filter(r => r.challenges?.status === 'active' && r.challenges.ends_on >= today).map(r => r.challenge_id)
}

type RpcAnswer = { data: unknown; error: unknown }
const callRpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<RpcAnswer>)(fn, args)

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await read<unknown>(callRpc(fn, args))) as T
}

export const fetchFeed = (cursor?: CheckinFeedCursor | null): Promise<CheckinFeedPage> =>
  rpc<CheckinFeedPage>('get_checkin_feed', { p_before: cursor?.before ?? null, p_before_key: cursor?.before_key ?? null })

export const fetchChallengeFeed = (id: string, cursor?: CheckinFeedCursor | null): Promise<ChallengeFeedPage> =>
  rpc<ChallengeFeedPage>('get_challenge_feed', { p_id: id, p_before: cursor?.before ?? null, p_before_key: cursor?.before_key ?? null })

export const fetchCheckin = (id: string): Promise<CheckinView> => rpc<CheckinView>('get_checkin', { p_id: id })

export async function react(id: string, emoji: string, on: boolean): Promise<void> {
  await rpc('react_checkin', { p_id: id, p_emoji: emoji, p_on: on })
}

export const comment = async (id: string, body: string): Promise<number> =>
  Number(await rpc<number>('comment_checkin', { p_id: id, p_body: body }))

export async function deleteComment(id: number): Promise<void> {
  await rpc('delete_comment', { p_id: id })
}

export const fetchNotices = (): Promise<NoticesPage> => rpc<NoticesPage>('get_notices', {})

export async function markNoticesRead(upto: number): Promise<void> {
  await rpc('mark_notices_read', { p_upto: upto })
}
