import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { classify } from '@/lib/supabase-errors'
import { t } from '../../lib/i18n.js'
import * as api from './checkin-api'
import { enqueueCheckin, flushCheckins, pendingCheckins, type CheckinOp } from './outbox'
import { preparePhoto } from './photo'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from '../nutrition/days'
import type { CheckinActivity, CheckinDetail, CheckinRow, CheckinVisibility } from './types'
import type { CheckinFeedCursor, CheckinFeedEntry, CheckinFeedItem, NoticesPage, Person, SocialNotice } from '../social/types'

const CACHE = 'perf_checkins_v1'
// Days of my own check-ins kept in the store (Home, the week); "Meus treinos" asks for the rest.
export const WINDOW_DAYS = 14
const PAGE = 20

// One of my check-ins. `pending` while the outbox still holds a write of it; `photo` is the
// prepared photo of a post not yet uploaded, for the screen to show meanwhile.
export type MyCheckin = CheckinRow & { pending?: boolean; photo?: Blob }

export type CheckinInput = {
  day: string
  activity: CheckinActivity
  routineId?: string | null
  routineName?: string | null
  title: string
  caption?: string | null
  note?: string | null
  durationMin?: number | null
  visibility: CheckinVisibility
  photo: File | Blob
  detail?: CheckinDetail | null
}

// What an edit may change; day, activity and photo stay as they are.
export type CheckinPatch = Partial<Pick<CheckinRow, 'title' | 'caption' | 'note' | 'duration_min' | 'visibility' | 'detail' | 'routine_id' | 'routine_name'>>

// A post the server refused for good and that left the queue: a closed day, or anything else.
export type Dropped = { id: string; reason: 'day_closed' | 'refused'; title: string }

type Status = 'idle' | 'loading' | 'ready' | 'error'

export type CheckinStore = {
  userId: string | null
  status: Status
  stale: boolean
  // The last WINDOW_DAYS days, newest first, with the queued writes laid on top.
  mine: MyCheckin[]
  // Mine of today, in the profile's time zone.
  today: MyCheckin[]
  feed: CheckinFeedEntry[]
  feedNext: CheckinFeedCursor | null
  feedStatus: Status
  feedStale: boolean
  notices: SocialNotice[]
  // Challenges I was invited to and have not joined.
  invites: string[]
  // The Social tab counter: unread notices plus pending invites, an invite counted once.
  unread: number
  dropped: Dropped[]
  bind(userId: string): Promise<void>
  refresh(): Promise<void>
  post(input: CheckinInput): Promise<string>
  // `base`: the row when it is older than the window (from fetchMyCheckins).
  edit(id: string, patch: CheckinPatch, base?: CheckinRow): Promise<void>
  remove(id: string, base?: CheckinRow): Promise<void>
  flush(): Promise<void>
  loadFeed(more?: boolean): Promise<void>
  loadNotices(): Promise<void>
  readNotices(): Promise<void>
  hide(id: string): Promise<void>
  dismissDropped(): void
  reset(): void
}

type Saved = { userId: string; mine: CheckinRow[]; feed: CheckinFeedEntry[]; notices: NoticesPage; invites: string[] }

const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (s: Saved) => { try { localStorage.setItem(CACHE, JSON.stringify(s)) } catch { /* full or blocked */ } }
const drop = () => { try { localStorage.removeItem(CACHE) } catch { /* ignore */ } }

const uuid = () => crypto.randomUUID()
const stamp = () => new Date().toISOString()
const today = () => todayIn(useProfile.getState().profile?.timezone)
const blank = (s: string | null | undefined) => (s == null || !s.trim() ? null : s.trim())
const keyOf = (id: string) => `checkin:${id}`
const extOf = (path: string): 'jpg' | 'webp' | undefined => (path.endsWith('.webp') ? 'webp' : path.endsWith('.jpg') ? 'jpg' : undefined)

// Newest first by (at, key), the order the server pages in.
const byTime = <T extends { at: string; key: string }>(a: T, b: T) =>
  a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? 1 : a.key > b.key ? -1 : 0
const mineOrder = (a: CheckinRow, b: CheckinRow) => byTime({ at: a.created_at ?? '', key: a.id }, { at: b.created_at ?? '', key: b.id })

const unreadOf = (n: { items: SocialNotice[]; unread: number }, invites: string[]) => {
  const noticed = new Set(n.items.filter(i => i.kind === 'challenge_invite' && !i.read && i.challenge_id).map(i => i.challenge_id))
  return n.unread + invites.filter(id => !noticed.has(id)).length
}

const pick = (patch: CheckinPatch): CheckinPatch => {
  const out: CheckinPatch = {}
  for (const k of ['title', 'caption', 'note', 'duration_min', 'visibility', 'detail', 'routine_id', 'routine_name'] as const) {
    if (k in patch) (out as Record<string, unknown>)[k] = patch[k]
  }
  if (out.title != null) out.title = out.title.trim()
  if ('caption' in out) out.caption = blank(out.caption)
  if ('note' in out) out.note = blank(out.note)
  return out
}

// The feed card of a post of mine the server has not paged yet: no context or reactions, never the
// note. While it waits to go up it is `pending` and carries the photo from this phone.
const ownItem = (row: CheckinRow, me: Person, pending: Blob | null): CheckinFeedItem => ({
  type: 'checkin', key: keyOf(row.id), at: row.created_at ?? stamp(), day: row.day, user: me, activity: row.activity,
  title: row.title, caption: row.caption, duration_min: row.duration_min, visibility: row.visibility, photo_path: row.photo_path,
  context: null, reactions: [], comments_count: 0, ...(pending ? { pending: true, photo: pending } : {})
})
const withRow = (item: CheckinFeedItem, row: CheckinRow): CheckinFeedItem =>
  ({ ...item, title: row.title, caption: row.caption, duration_min: row.duration_min, visibility: row.visibility })

// What the server sent, with what the outbox has not delivered yet on top.
function overlayMine(base: CheckinRow[], ops: CheckinOp[], from: string): MyCheckin[] {
  const rows = new Map<string, MyCheckin>(base.map(r => [r.id, r]))
  for (const op of ops) {
    if (op.kind === 'checkin_delete') { rows.delete(op.id); continue }
    if (!op.row || (!rows.has(op.id) && op.row.day < from)) continue
    rows.set(op.id, { ...op.row, pending: true, ...(op.photo ? { photo: op.photo } : {}) })
  }
  return [...rows.values()].sort(mineOrder)
}

function overlayFeed(base: CheckinFeedEntry[], ops: CheckinOp[], me: Person): CheckinFeedEntry[] {
  let items = base
  for (const op of ops) {
    const key = keyOf(op.id)
    if (op.kind === 'checkin_delete') { items = items.filter(i => i.key !== key); continue }
    if (!op.row) continue
    const cur = items.find(i => i.key === key)
    if (cur && cur.type === 'checkin') items = items.map(i => (i.key === key ? { ...withRow(cur, op.row!), pending: true } : i))
    else if (!cur && op.photo) items = [...items, ownItem(op.row, me, op.photo)]
  }
  return [...items].sort(byTime)
}

// Whether the session the client holds belongs to this account: another account's session would
// send the queue as that person (spec 3.5: the queue is per account).
async function sessionIs(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.user?.id === userId
  } catch { return false }
}

// Sends one queued op: the photo first, then the row; for a delete, the photo, then the row.
async function send(userId: string, op: CheckinOp): Promise<void> {
  if (op.kind === 'checkin_delete') {
    for (const ext of op.ext ? [op.ext] : (['jpg', 'webp'] as const)) await api.removePhoto(api.photoPath(userId, op.id, ext))
    await api.deleteCheckin(op.id)
    return
  }
  const row = op.row!
  // An edit of a post that is up: only the editable columns, never the photo.
  if (!op.photo) { await api.updateCheckin(row); return }
  await api.uploadPhoto(userId, op.id, op.photo, op.ext ?? extOf(row.photo_path) ?? 'jpg')
  try {
    await api.upsertCheckin(row)
  } catch (e) {
    const err = classify(e)
    if (!err.refused) throw err
    // The row is there already (an earlier try went in and its answer was lost): done.
    if (await api.hasCheckin(op.id)) return
    // Refused for good: the photo just uploaded would be left with no post.
    try { await api.removePhoto(row.photo_path) } catch { /* best effort; the SETUP query finds orphans */ }
    throw err
  }
}

// Bumped on bind and reset: an answer from before a switch of account never lands in the next one.
let generation = 0
let refreshing: Promise<void> | null = null
let feedLoading: Promise<void> | null = null
// Ops sent since a pull started: its answer may predate them, so they are laid on it again.
let settleSeq = 0
let settled: { seq: number; op: CheckinOp }[] = []
// The server's copies, before the queue is laid on top.
let base: { mine: CheckinRow[]; feed: CheckinFeedEntry[]; notices: NoticesPage } = { mine: [], feed: [], notices: { items: [], unread: 0 } }
const emptyBase = () => ({ mine: [] as CheckinRow[], feed: [] as CheckinFeedEntry[], notices: { items: [] as SocialNotice[], unread: 0 } })

const initial = () => ({
  userId: null as string | null, status: 'idle' as Status, stale: false, mine: [] as MyCheckin[], today: [] as MyCheckin[],
  feed: [] as CheckinFeedEntry[], feedNext: null as CheckinFeedCursor | null, feedStatus: 'idle' as Status, feedStale: false,
  notices: [] as SocialNotice[], invites: [] as string[], unread: 0, dropped: [] as Dropped[]
})

export const useCheckins = create<CheckinStore>((set, get) => {
  const me = (): Person => {
    const p = useProfile.getState().profile
    return { id: get().userId ?? '', name: p?.display_name ?? '', avatar_url: p?.avatar_url ?? null }
  }
  const persist = () => {
    const { userId, invites } = get()
    if (userId) save({ userId, mine: base.mine, feed: base.feed.slice(0, PAGE), notices: base.notices, invites })
  }
  // Lays the queue over the server's copies and publishes the result.
  const compose = async () => {
    const userId = get().userId
    if (!userId) return
    const gen = generation
    let ops: CheckinOp[] = []
    try { ops = await pendingCheckins(userId) } catch { /* no queue to show */ }
    if (gen !== generation) return
    const day = today()
    const mine = overlayMine(base.mine, ops, shiftDay(day, -WINDOW_DAYS))
    set({ mine, today: mine.filter(r => r.day === day), feed: overlayFeed(base.feed, ops, me()) })
  }
  // A sent op is now the server's: fold it into the copies so it does not wait for the next pull.
  const settle = (op: CheckinOp) => {
    settled = [...settled.slice(-49), { seq: ++settleSeq, op }]
    apply(op)
  }
  const replay = (mark: number) => { for (const e of settled) if (e.seq > mark) apply(e.op) }
  const apply = (op: CheckinOp) => {
    const key = keyOf(op.id)
    if (op.kind === 'checkin_delete') {
      base = { ...base, mine: base.mine.filter(r => r.id !== op.id), feed: base.feed.filter(i => i.key !== key) }
      return
    }
    const row = op.row!
    const cur = base.feed.find(i => i.key === key)
    base = {
      ...base,
      mine: [...base.mine.filter(r => r.id !== op.id), row].sort(mineOrder),
      feed: cur?.type === 'checkin' ? base.feed.map(i => (i.key === key ? withRow(cur, row) : i))
        : !cur && op.photo ? [...base.feed, ownItem(row, me(), null)].sort(byTime) : base.feed
    }
  }
  const setNotices = (n: NoticesPage, invites: string[]) => {
    base = { ...base, notices: n }
    set({ notices: n.items, invites, unread: unreadOf(n, invites) })
  }

  return {
    ...initial(),

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // the queue goes out and my check-ins and notices are pulled.
    bind(userId) {
      if (get().userId === userId) return Promise.resolve()
      const saved = readSaved(userId)
      generation++
      refreshing = null
      feedLoading = null
      settled = []
      base = saved ? { mine: saved.mine, feed: saved.feed, notices: saved.notices } : emptyBase()
      const invites = saved?.invites ?? []
      const day = today()
      // The saved copy at once; the queue is laid on top as soon as it is read.
      const mine = [...base.mine].sort(mineOrder)
      set({
        ...initial(), userId, status: saved ? 'ready' : 'loading', stale: !!saved,
        mine, today: mine.filter(r => r.day === day), feed: base.feed,
        feedStatus: saved?.feed.length ? 'ready' : 'idle', feedStale: !!saved?.feed.length,
        feedNext: saved && saved.feed.length >= PAGE ? { before: saved.feed[PAGE - 1].at, before_key: saved.feed[PAGE - 1].key } : null,
        notices: base.notices.items, invites, unread: unreadOf(base.notices, invites)
      })
      void compose()
      return get().refresh()
    },

    refresh() {
      if (refreshing) return refreshing
      const userId = get().userId
      if (!userId) return Promise.resolve()
      const gen = generation
      const job = (async () => {
        // A queue that cannot go out now must not stop the pull.
        try { await get().flush() } catch { /* tried again on the next refresh */ }
        if (gen !== generation) return
        const day = today()
        const mark = settleSeq
        try {
          const rows = await api.fetchMyCheckins(shiftDay(day, -WINDOW_DAYS), day)
          if (gen !== generation) return
          base = { ...base, mine: rows }
          replay(mark)
          await compose()
          if (gen !== generation) return
          set({ status: 'ready', stale: false })
          persist()
        } catch {
          if (gen !== generation) return
          set(s => ({ status: s.status === 'ready' ? 'ready' : 'error', stale: s.status === 'ready' }))
        }
        await get().loadNotices()
      })().finally(() => { if (gen === generation) refreshing = null })
      refreshing = job
      return job
    },

    async post(input) {
      const userId = get().userId
      if (!userId) throw new Error('not_signed_in')
      const prepared = await preparePhoto(input.photo)
      const id = uuid()
      const now = stamp()
      const row: CheckinRow = {
        id, day: input.day, activity: input.activity, routine_id: input.routineId ?? null, routine_name: input.routineName ?? null,
        title: input.title.trim(), caption: blank(input.caption), note: blank(input.note), duration_min: input.durationMin ?? null,
        visibility: input.visibility, photo_path: api.photoPath(userId, id, prepared.ext), detail: input.detail ?? null,
        created_at: now, updated_at: now
      }
      await enqueueCheckin(userId, { kind: 'checkin', id, row, photo: prepared.blob, ext: prepared.ext })
      await compose()
      void get().flush().catch(() => {})
      return id
    },

    async edit(id, patch, given) {
      const userId = get().userId
      if (!userId) return
      const cur = get().mine.find(r => r.id === id) ?? given
      if (!cur) return
      const { pending: _p, photo: _ph, ...plain } = cur as MyCheckin
      const row: CheckinRow = { ...plain, ...pick(patch), id, day: cur.day, activity: cur.activity, photo_path: cur.photo_path, updated_at: stamp() }
      // A post still waiting to go up keeps its photo: this op takes the place of the one queued.
      const queued = (await pendingCheckins(userId)).find(o => o.id === id && o.kind === 'checkin')
      await enqueueCheckin(userId, { kind: 'checkin', id, row, ...(queued?.photo ? { photo: queued.photo, ext: queued.ext } : {}) })
      await compose()
      void get().flush().catch(() => {})
    },

    async remove(id, given) {
      const userId = get().userId
      if (!userId) return
      const cur = get().mine.find(r => r.id === id) ?? given
      const ext = cur ? extOf(cur.photo_path) : undefined
      await enqueueCheckin(userId, { kind: 'checkin_delete', id, ...(ext ? { ext } : {}) })
      await compose()
      void get().flush().catch(() => {})
    },

    async flush() {
      const userId = get().userId
      if (!userId || !(await sessionIs(userId))) return
      if (get().userId !== userId) return
      const gen = generation
      const tried = new Map<string, CheckinOp>()
      const sent: CheckinOp[] = []
      const r = await flushCheckins(userId, async op => {
        tried.set(op.id, op)
        await send(userId, op)
        sent.push(op)
      })
      if (gen !== generation) return
      for (const op of sent) settle(op)
      if (r.refused.length) {
        const known = new Set(get().dropped.map(d => d.id))
        const add: Dropped[] = []
        for (const { id, reason } of r.refused) {
          const op = tried.get(id)
          // Only a post that never went up is news; a refused edit leaves the server's copy as it was.
          if (!op?.photo || known.has(id)) continue
          add.push({ id, reason: reason === 'day_closed' ? 'day_closed' : 'refused', title: op.row?.title ?? '' })
        }
        if (add.length) set(s => ({ dropped: [...s.dropped, ...add] }))
      }
      await compose()
      if (sent.length) persist()
    },

    loadFeed(more = false) {
      const userId = get().userId
      if (!userId) return Promise.resolve()
      if (more && !get().feedNext) return Promise.resolve()
      if (feedLoading) return feedLoading
      const gen = generation
      const cursor = more ? get().feedNext : null
      if (!more && !base.feed.length) set({ feedStatus: 'loading' })
      const job = (async () => {
        const mark = settleSeq
        try {
          const page = await api.fetchFeed(cursor ?? undefined)
          if (gen !== generation) return
          const items = page.items ?? []
          const seen = new Set(items.map(i => i.key))
          base = { ...base, feed: more ? [...base.feed.filter(i => !seen.has(i.key)), ...items] : items }
          if (!more) replay(mark)
          set({ feedNext: page.next ?? null, feedStatus: 'ready', feedStale: false })
          await compose()
          persist()
        } catch {
          if (gen !== generation) return
          set(s => ({ feedStatus: base.feed.length ? 'ready' : 'error', feedStale: s.feedStatus === 'ready' || !!base.feed.length }))
        }
      })().finally(() => { if (gen === generation) feedLoading = null })
      feedLoading = job
      return job
    },

    async loadNotices() {
      const userId = get().userId
      if (!userId) return
      const gen = generation
      try {
        const [n, invites] = await Promise.all([api.fetchNotices(), api.fetchPendingInvites(userId)])
        if (gen !== generation) return
        setNotices({ items: n?.items ?? [], unread: n?.unread ?? 0 }, invites)
        persist()
      } catch { /* the counter keeps the last numbers it had */ }
    },

    // Opening the notices marks them read, up to the newest one shown. Pending invites still count.
    async readNotices() {
      const items = get().notices
      if (!items.some(n => !n.read)) return
      const gen = generation
      await api.markNoticesRead(Math.max(...items.map(n => n.id)))
      if (gen !== generation) return
      setNotices({ items: items.map(n => ({ ...n, read: true })), unread: 0 }, get().invites)
      persist()
    },

    async hide(id) {
      const gen = generation
      await api.hideCheckin(id)
      if (gen !== generation) return
      base = { ...base, feed: base.feed.filter(i => i.key !== keyOf(id)) }
      await compose()
      persist()
    },

    dismissDropped() { set({ dropped: [] }) },

    // Sign-out: the store and its saved copy go; the queue stays on the device for its owner.
    reset() {
      generation++
      refreshing = null
      feedLoading = null
      settled = []
      base = emptyBase()
      drop()
      set(initial())
    }
  }
})

// The notices for refused posts: one per post of a closed day, and one for all the others.
export function droppedMessages(dropped: Dropped[]): string[] {
  const out = dropped.filter(d => d.reason === 'day_closed').map(d => t('Check-in “{0}” was not posted because its day has closed.', d.title))
  if (dropped.some(d => d.reason !== 'day_closed')) out.push(t('The server refused a check-in, so it was not posted.'))
  return out
}

// Pull again when the app comes back to the screen or the network returns (the refresh sends the
// queue first); a visible tab with something waiting tries the queue every minute. Returns the cleanup.
export function startCheckinSync(): () => void {
  const run = () => { void useCheckins.getState().refresh() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(() => {
    const { userId, flush } = useCheckins.getState()
    if (document.visibilityState !== 'visible' || !userId) return
    void pendingCheckins(userId).then(ops => { if (ops.length) return flush() }).catch(() => {})
  }, 60_000)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
