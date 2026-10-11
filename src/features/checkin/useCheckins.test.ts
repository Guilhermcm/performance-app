// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The session the client holds: whose it is decides whether the queue may go out.
const auth = vi.hoisted(() => ({ user: null as string | null }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: auth.user ? { access_token: 't', user: { id: auth.user } } : null } }) } }
}))
const api = vi.hoisted(() => ({
  uploadPhoto: vi.fn(), removePhoto: vi.fn(), upsertCheckin: vi.fn(), updateCheckin: vi.fn(), deleteCheckin: vi.fn(),
  hasCheckin: vi.fn(), fetchMyCheckins: vi.fn(), fetchFeed: vi.fn(), fetchNotices: vi.fn(), fetchPendingInvites: vi.fn(),
  markNoticesRead: vi.fn(), hideCheckin: vi.fn()
}))
vi.mock('./checkin-api', async orig => ({ ...(await orig<typeof import('./checkin-api')>()), ...api }))
const photo = vi.hoisted(() => ({ preparePhoto: vi.fn() }))
vi.mock('./photo', async orig => ({ ...(await orig<typeof import('./photo')>()), ...photo }))
// The real queue, wrapped so a test can make a run throw.
vi.mock('./outbox', async orig => { const m = await orig<typeof import('./outbox')>(); return { ...m, flushCheckins: vi.fn(m.flushCheckins) } })

// The history session a check-in wrote (ingest.ts has its own tests): only whether it is asked to go.
const ingest = vi.hoisted(() => ({ dropCheckinWorkout: vi.fn() }))
vi.mock('./ingest', () => ingest)

import { useCheckins, droppedMessages, startCheckinSync, type CheckinInput } from './useCheckins'
import { flushCheckins, memoryOutboxBackend, pendingCheckins, setCheckinOutboxBackend } from './outbox'
import { useProfile } from '../profile/useProfile'
import type { Profile } from '../profile/types'
import type { CheckinRow } from './types'
import type { CheckinFeedItem, SocialNotice } from '../social/types'

const ME = '00000000-0000-4000-8000-00000000000a'
const OTHER = '00000000-0000-4000-8000-00000000000b'
const TODAY = '2026-10-10', YESTERDAY = '2026-10-09'
const settle = () => new Promise(r => setTimeout(r, 0))
const S = () => useCheckins.getState()
const network = () => new TypeError('Failed to fetch')
const refusal = (m: string) => Object.assign(new Error(m), { code: 'P0001' })

const inputOf = (over: Partial<CheckinInput> = {}): CheckinInput => ({
  day: TODAY, activity: 'strength', routineId: 'r1', routineName: 'Push', title: '  Musculação · Push  ', caption: 'Peito e ombro',
  note: 'joelho ok', durationMin: 55, visibility: 'friends', photo: new Blob([new Uint8Array(10)], { type: 'image/heic' }), ...over
})
const serverRow = (id: string, over: Partial<CheckinRow> = {}): CheckinRow => ({
  id, user_id: ME, day: TODAY, activity: 'run', routine_id: null, routine_name: null, title: 'Corrida', caption: null, note: 'privado',
  duration_min: 30, visibility: 'friends', photo_path: `${ME}/${id}.webp`, detail: null,
  created_at: '2026-10-10T10:00:00.000Z', updated_at: '2026-10-10T10:00:00.000Z', ...over
})
const feedItemOf = (id: string, over: Partial<CheckinFeedItem> = {}): CheckinFeedItem => ({
  type: 'checkin', key: `checkin:${id}`, at: '2026-10-10T09:00:00.000Z', day: TODAY, user: { id: OTHER, name: 'Ana', avatar_url: null },
  activity: 'run', title: 'Corrida', caption: null, duration_min: 30, visibility: 'friends', photo_path: `${OTHER}/${id}.jpg`,
  context: { week_count: 2, streak: 3 }, reactions: [], comments_count: 0, ...over
})
const noticeOf = (id: number, over: Partial<SocialNotice> = {}): SocialNotice => ({
  id, kind: 'reaction', actor: { id: OTHER, name: 'Ana', avatar_url: null }, checkin_id: 'c', checkin_title: 'Corrida',
  challenge_id: null, challenge_title: null, created_at: '2026-10-10T10:00:00.000Z', read: false, ...over
})

// Every network call in the order it went out, to check the photo goes before its row; and the
// rows the server holds, so a pull after a send sees what was sent.
const calls: string[] = []
const server = new Map<string, CheckinRow>()
function online() {
  api.uploadPhoto.mockImplementation(async (u: string, id: string, _b: Blob, ext: string) => { calls.push(`upload ${id}`); return `${u}/${id}.${ext}` })
  api.upsertCheckin.mockImplementation(async (r: CheckinRow) => { calls.push(`upsert ${r.id}`); server.set(r.id, { ...r, user_id: ME }) })
  api.updateCheckin.mockImplementation(async (r: CheckinRow) => { calls.push(`update ${r.id}`); if (server.has(r.id)) server.set(r.id, { ...r, user_id: ME }) })
  api.removePhoto.mockImplementation(async (p: string) => { calls.push(`remove ${p}`) })
  api.deleteCheckin.mockImplementation(async (id: string) => { calls.push(`delete ${id}`); server.delete(id) })
  api.fetchMyCheckins.mockImplementation(async () => [...server.values()])
}
function offline() {
  for (const f of [api.uploadPhoto, api.upsertCheckin, api.updateCheckin, api.removePhoto, api.deleteCheckin]) f.mockRejectedValue(network())
}
const profile = (id: string) => ({ id, display_name: id === ME ? 'Gui' : 'Bia', avatar_url: null, timezone: 'America/Sao_Paulo' }) as unknown as Profile

async function bound(userId = ME) {
  auth.user = userId
  useProfile.setState({ profile: profile(userId), userId, status: 'ready' })
  await S().bind(userId)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T15:00:00Z'))
  localStorage.clear()
  setCheckinOutboxBackend(memoryOutboxBackend())
  S().reset()
  calls.length = 0
  server.clear()
  Object.values(api).forEach(f => f.mockReset())
  ingest.dropCheckinWorkout.mockReset()
  vi.mocked(flushCheckins).mockClear()
  online()
  api.hasCheckin.mockResolvedValue(false)
  api.fetchFeed.mockResolvedValue({ items: [], next: null })
  api.fetchNotices.mockResolvedValue({ items: [], unread: 0 })
  api.fetchPendingInvites.mockResolvedValue([])
  photo.preparePhoto.mockReset().mockImplementation(async () => ({ blob: new Blob([new Uint8Array(5)], { type: 'image/jpeg' }), ext: 'jpg', width: 1280, height: 960 }))
})
afterEach(() => { vi.useRealTimers() })

describe('post', () => {
  it('shows the post at once as pending, then sends the photo before the row', async () => {
    await bound()
    offline()
    const id = await S().post(inputOf())
    expect(photo.preparePhoto).toHaveBeenCalledTimes(1)
    const mine = S().mine.find(r => r.id === id)!
    expect(mine).toMatchObject({
      pending: true, day: TODAY, activity: 'strength', routine_id: 'r1', routine_name: 'Push', title: 'Musculação · Push',
      caption: 'Peito e ombro', note: 'joelho ok', duration_min: 55, visibility: 'friends', photo_path: `${ME}/${id}.jpg`, detail: null
    })
    expect(mine.photo).toBeInstanceOf(Blob)
    expect(S().today.map(r => r.id)).toEqual([id])
    // The own post sits on top of the feed as "sending", with no context yet and no note.
    const top = S().feed[0] as CheckinFeedItem
    expect(top).toMatchObject({ type: 'checkin', key: `checkin:${id}`, pending: true, title: 'Musculação · Push', user: { id: ME, name: 'Gui' }, context: null, reactions: [], comments_count: 0 })
    expect(top).not.toHaveProperty('note')

    online()
    await S().flush(); await settle()
    expect(calls).toEqual([`upload ${id}`, `upsert ${id}`])
    expect(api.uploadPhoto.mock.calls[0].slice(0, 2)).toEqual([ME, id])
    expect(S().mine.find(r => r.id === id)!.pending).toBeFalsy()
    expect(S().mine.find(r => r.id === id)!.photo).toBeUndefined()
    expect((S().feed[0] as CheckinFeedItem).pending).toBeFalsy()
    expect(await pendingCheckins(ME)).toEqual([])
  })

  it('stays pending offline and goes up when the network comes back', async () => {
    await bound()
    offline()
    const stop = startCheckinSync()
    try {
      const id = await S().post(inputOf())
      await S().flush(); await settle()
      expect(S().mine[0]).toMatchObject({ id, pending: true })
      expect((await pendingCheckins(ME)).map(o => o.id)).toEqual([id])

      online()
      window.dispatchEvent(new Event('online'))
      await vi.waitFor(() => expect(S().mine[0].pending).toBeFalsy())
      expect(calls).toEqual([`upload ${id}`, `upsert ${id}`])
    } finally { stop() }
  })

  it('a closed day drops the post, removes its uploaded photo and tells once', async () => {
    await bound()
    offline()
    const id = await S().post(inputOf({ day: YESTERDAY, title: 'Treino de ontem' }))
    online()
    api.upsertCheckin.mockRejectedValue(refusal('day_closed'))
    await S().flush(); await settle()
    expect(api.removePhoto).toHaveBeenCalledWith(`${ME}/${id}.jpg`)
    expect(S().mine).toEqual([])
    expect(S().feed).toEqual([])
    expect(S().dropped).toEqual([{ id, reason: 'day_closed', title: 'Treino de ontem' }])
    expect(droppedMessages(S().dropped)).toHaveLength(1)
    expect(droppedMessages(S().dropped)[0]).toContain('Treino de ontem')

    // Nothing is left to refuse: another run adds no second notice, and a dismissed one stays gone.
    await S().flush(); await settle()
    expect(S().dropped).toHaveLength(1)
    S().dismissDropped()
    await S().flush(); await settle()
    expect(S().dropped).toEqual([])
  })

  it('other refusals add up to one generic notice', async () => {
    await bound()
    offline()
    await S().post(inputOf({ title: 'Um' }))
    await S().post(inputOf({ title: 'Dois' }))
    online()
    api.upsertCheckin.mockRejectedValue(Object.assign(new Error('new row violates check constraint'), { code: '23514' }))
    await S().flush(); await settle()
    expect(S().dropped.map(d => d.reason)).toEqual(['refused', 'refused'])
    expect(droppedMessages(S().dropped)).toHaveLength(1)
    // A closed day beside them keeps its own line.
    expect(droppedMessages([...S().dropped, { id: 'x', reason: 'day_closed', title: 'Três' }])).toHaveLength(2)
  })

  it('keeps the photo when the refused row turns out to exist (sent before, answer lost)', async () => {
    await bound()
    offline()
    const id = await S().post(inputOf())
    online()
    api.upsertCheckin.mockRejectedValue(refusal('day_closed'))
    api.hasCheckin.mockResolvedValue(true)
    await S().flush(); await settle()
    expect(api.removePhoto).not.toHaveBeenCalled()
    expect(S().dropped).toEqual([])
    expect(S().mine.map(r => r.id)).toEqual([id])
  })

  it('keeps the op when the photo cannot go up, and never sends its row first', async () => {
    await bound()
    api.uploadPhoto.mockRejectedValue(network())
    const id = await S().post(inputOf())
    await S().flush(); await settle()
    expect(api.upsertCheckin).not.toHaveBeenCalled()
    expect((await pendingCheckins(ME)).map(o => o.id)).toEqual([id])
  })

  it('passes a photo error to the caller and queues nothing', async () => {
    await bound()
    photo.preparePhoto.mockRejectedValue(Object.assign(new Error('photo_unreadable'), { code: 'photo_unreadable' }))
    await expect(S().post(inputOf())).rejects.toMatchObject({ code: 'photo_unreadable' })
    expect(S().mine).toEqual([])
    expect(await pendingCheckins(ME)).toEqual([])
  })
})

describe('edit and remove', () => {
  it('editing never touches the photo, the day or the activity', async () => {
    server.set('s1', serverRow('s1'))
    await bound()
    await S().edit('s1', { title: 'Corrida leve', note: 'calor', photo_path: `${ME}/other.jpg`, day: YESTERDAY, activity: 'swim' } as never)
    expect(S().mine[0]).toMatchObject({ id: 's1', title: 'Corrida leve', note: 'calor', pending: true, photo_path: `${ME}/s1.webp`, day: TODAY, activity: 'run' })
    await S().flush(); await settle()
    expect(calls).toEqual(['update s1'])
    expect(api.uploadPhoto).not.toHaveBeenCalled()
    expect(api.updateCheckin.mock.calls[0][0]).toMatchObject({ id: 's1', title: 'Corrida leve', photo_path: `${ME}/s1.webp`, day: TODAY, activity: 'run' })
    expect(S().mine[0]).toMatchObject({ title: 'Corrida leve' })
    expect(S().mine[0].pending).toBeFalsy()
  })

  it('a post dropped by the server takes its history session with it; a refused edit does not', async () => {
    server.set('s1', serverRow('s1'))
    await bound()
    offline()
    const id = await S().post(inputOf({ day: YESTERDAY, title: 'Treino de ontem' }))
    online()
    api.upsertCheckin.mockRejectedValue(refusal('day_closed'))
    api.updateCheckin.mockRejectedValue(refusal('item_immutable'))
    await S().edit('s1', { title: 'Outro' })
    await S().flush(); await settle()
    expect(S().dropped.map(d => d.reason).sort()).toEqual(['day_closed', 'edit_refused'])
    expect(ingest.dropCheckinWorkout.mock.calls).toEqual([[id]])
  })

  it('a refused edit of a post that is up says so once, with one short generic notice', async () => {
    server.set('s1', serverRow('s1'))
    server.set('s2', serverRow('s2'))
    await bound()
    api.updateCheckin.mockRejectedValue(Object.assign(new Error('new row violates check constraint'), { code: '23514' }))
    await S().edit('s1', { title: 'Um' })
    await S().edit('s2', { title: 'Dois' })
    await S().flush(); await settle()
    expect(S().dropped.map(d => [d.id, d.reason])).toEqual([['s1', 'edit_refused'], ['s2', 'edit_refused']])
    expect(droppedMessages(S().dropped)).toEqual(['Couldn’t save a change to a check-in.'])
    // The server's copy shows again.
    expect(S().mine.find(r => r.id === 's1')).toMatchObject({ title: 'Corrida' })
    // Beside a refused post, each keeps its own line.
    expect(droppedMessages([...S().dropped, { id: 'x', reason: 'refused', title: 'Três' }])).toHaveLength(2)
  })

  it('editing a post still waiting to go up keeps its photo in the queue', async () => {
    await bound()
    offline()
    const id = await S().post(inputOf({ title: 'Antes' }))
    await S().edit(id, { title: 'Depois' })
    const [op] = await pendingCheckins(ME)
    expect(op.photo).toBeInstanceOf(Blob)
    expect(op.row!.title).toBe('Depois')
    online()
    await S().flush(); await settle()
    expect(calls).toEqual([`upload ${id}`, `upsert ${id}`])
    expect(api.upsertCheckin.mock.calls[0][0].title).toBe('Depois')
  })

  it('removing a check-in takes its history session at once', async () => {
    server.set('s1', serverRow('s1'))
    await bound()
    offline()
    await S().remove('s1')
    expect(ingest.dropCheckinWorkout).toHaveBeenCalledWith('s1')
  })

  it('removing takes the photo, then the row, and the post leaves mine and the feed at once', async () => {
    server.set('s1', serverRow('s1'))
    api.fetchFeed.mockResolvedValue({ items: [feedItemOf('s1', { user: { id: ME, name: 'Gui', avatar_url: null }, photo_path: `${ME}/s1.webp` }), feedItemOf('f1')], next: null })
    await bound()
    await S().loadFeed()
    offline()
    await S().remove('s1')
    expect(S().mine).toEqual([])
    expect(S().feed.map(i => i.key)).toEqual(['checkin:f1'])
    online()
    await S().flush(); await settle()
    expect(calls).toEqual([`remove ${ME}/s1.webp`, 'delete s1'])
    expect(S().mine).toEqual([])
    expect(S().feed.map(i => i.key)).toEqual(['checkin:f1'])
  })
})

describe('accounts', () => {
  it('a switch of account mixes neither the queues nor the feed', async () => {
    api.fetchFeed.mockResolvedValue({ items: [feedItemOf('a-friend')], next: null })
    await bound(ME)
    await S().loadFeed()
    offline()
    const mineId = await S().post(inputOf())
    await S().flush(); await settle()

    online()
    api.uploadPhoto.mockClear()
    api.fetchFeed.mockResolvedValue({ items: [], next: null })
    await bound(OTHER)
    expect(S().userId).toBe(OTHER)
    expect(S().mine).toEqual([])
    expect(S().feed).toEqual([])
    await S().flush(); await settle()
    expect(api.uploadPhoto).not.toHaveBeenCalled()
    expect((await pendingCheckins(ME)).map(o => o.id)).toEqual([mineId])

    await bound(ME)
    await S().flush(); await settle()
    expect(calls).toEqual([`upload ${mineId}`, `upsert ${mineId}`])
    expect(api.uploadPhoto.mock.calls[0][0]).toBe(ME)
  })

  it('an answer for the previous account never lands in the next one', async () => {
    await bound(ME)
    let release!: (v: unknown) => void
    api.fetchFeed.mockReturnValue(new Promise(r => { release = r }))
    const p = S().loadFeed()
    await bound(OTHER)
    release({ items: [feedItemOf('for-me')], next: null })
    await p
    expect(S().feed).toEqual([])
  })

  it('sends nothing while the session belongs to someone else, or there is none', async () => {
    await bound(ME)
    offline()
    const id = await S().post(inputOf())
    await S().flush(); await settle()
    online()
    auth.user = OTHER
    await S().flush(); await settle()
    auth.user = null
    await S().flush(); await settle()
    expect(calls).toEqual([])
    expect((await pendingCheckins(ME)).map(o => o.id)).toEqual([id])
    auth.user = ME
    await S().flush(); await settle()
    expect(calls).toEqual([`upload ${id}`, `upsert ${id}`])
  })

  it('reset empties the store and keeps the queue for its owner', async () => {
    await bound(ME)
    offline()
    const id = await S().post(inputOf())
    S().reset()
    expect(S()).toMatchObject({ userId: null, mine: [], today: [], feed: [], notices: [], unread: 0, dropped: [] })
    expect((await pendingCheckins(ME)).map(o => o.id)).toEqual([id])
  })

  it('still loads my check-ins when sending the queue throws', async () => {
    vi.mocked(flushCheckins).mockRejectedValueOnce(new Error('QuotaExceededError'))
    api.fetchMyCheckins.mockResolvedValue([serverRow('s1')])
    await bound(ME)
    expect(S().status).toBe('ready')
    expect(S().mine.map(r => r.id)).toEqual(['s1'])
  })
})

describe('mine and today', () => {
  it('loads the last two weeks of my check-ins and keeps the ones of today apart', async () => {
    api.fetchMyCheckins.mockResolvedValue([serverRow('t', { created_at: '2026-10-10T11:00:00.000Z' }), serverRow('y', { day: YESTERDAY, created_at: '2026-10-09T11:00:00.000Z' })])
    await bound()
    expect(api.fetchMyCheckins).toHaveBeenCalledWith('2026-09-26', TODAY)
    expect(S().mine.map(r => r.id)).toEqual(['t', 'y'])
    expect(S().today.map(r => r.id)).toEqual(['t'])
  })

  it('a pull that started before a post went up does not hide that post', async () => {
    await bound()
    let release!: (v: CheckinRow[]) => void
    api.fetchMyCheckins.mockImplementationOnce(() => new Promise<CheckinRow[]>(r => { release = r }))
    const pull = S().refresh()
    await settle()
    const id = await S().post(inputOf())
    await S().flush(); await settle()
    expect(calls).toEqual([`upload ${id}`, `upsert ${id}`])
    release([])
    await pull
    expect(S().mine.map(r => r.id)).toEqual([id])
    expect(S().mine[0].pending).toBeFalsy()
  })

  it('shows the saved copy of the same account at once, never another account\'s', async () => {
    api.fetchMyCheckins.mockResolvedValue([serverRow('s1')])
    await bound(ME)
    api.fetchMyCheckins.mockReturnValue(new Promise(() => {}))
    auth.user = OTHER
    void S().bind(OTHER)
    expect(S().mine).toEqual([])
    auth.user = ME
    void S().bind(ME)
    expect(S().mine.map(r => r.id)).toEqual(['s1'])
    expect(S().stale).toBe(true)
    // reset is a sign-out: the saved copy goes with it.
    S().reset()
    void S().bind(ME)
    expect(S().mine).toEqual([])
  })
})

describe('feed', () => {
  it('pages with the cursor and stops at the end', async () => {
    await bound()
    api.fetchFeed.mockResolvedValueOnce({ items: [feedItemOf('a')], next: { before: 't1', before_key: 'checkin:a' } })
    await S().loadFeed()
    expect(api.fetchFeed).toHaveBeenLastCalledWith(undefined)
    api.fetchFeed.mockResolvedValueOnce({ items: [feedItemOf('b', { at: '2026-10-09T09:00:00.000Z' })], next: null })
    await S().loadFeed(true)
    expect(api.fetchFeed).toHaveBeenLastCalledWith({ before: 't1', before_key: 'checkin:a' })
    expect(S().feed.map(i => i.key)).toEqual(['checkin:a', 'checkin:b'])
    expect(S().feedNext).toBeNull()
    api.fetchFeed.mockClear()
    await S().loadFeed(true)
    expect(api.fetchFeed).not.toHaveBeenCalled()
  })

  it('hides a post for me', async () => {
    api.fetchFeed.mockResolvedValue({ items: [feedItemOf('a'), feedItemOf('b')], next: null })
    await bound()
    await S().loadFeed()
    api.hideCheckin.mockResolvedValue(undefined)
    await S().hide('a')
    expect(api.hideCheckin).toHaveBeenCalledWith('a')
    expect(S().feed.map(i => i.key)).toEqual(['checkin:b'])
  })
})

describe('notices', () => {
  it('unread adds unread notices and pending invites, counting an invite once', async () => {
    api.fetchNotices.mockResolvedValue({
      items: [
        noticeOf(5, { kind: 'challenge_invite', challenge_id: 'c1', checkin_id: null, checkin_title: null, challenge_title: 'Outubro' }),
        noticeOf(4), noticeOf(3, { kind: 'comment' }), noticeOf(2, { read: true })
      ],
      unread: 3
    })
    // c1 has its unread notice; c2's notice was read (or is older than the list) and still waits.
    api.fetchPendingInvites.mockResolvedValue(['c1', 'c2'])
    await bound()
    expect(api.fetchPendingInvites).toHaveBeenCalledWith(ME, TODAY)
    expect(S().notices).toHaveLength(4)
    expect(S().unread).toBe(4)
  })

  it('reading the notices marks them up to the newest and leaves the pending invites', async () => {
    api.fetchNotices.mockResolvedValue({ items: [noticeOf(9), noticeOf(7)], unread: 2 })
    api.fetchPendingInvites.mockResolvedValue(['c2'])
    await bound()
    expect(S().unread).toBe(3)
    api.markNoticesRead.mockResolvedValue(undefined)
    await S().readNotices()
    expect(api.markNoticesRead).toHaveBeenCalledWith(9)
    expect(S().notices.every(n => n.read)).toBe(true)
    expect(S().unread).toBe(1)
  })
})
