import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  const bucket = { upload: vi.fn(), remove: vi.fn(), list: vi.fn(), createSignedUrls: vi.fn() }
  return { rpc: vi.fn(), from: vi.fn(), bucket, storageFrom: vi.fn(() => bucket) }
})
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from, storage: { from: h.storageFrom } } }))

import * as api from './checkin-api'
import type { CheckinRow } from './types'

const ME = '00000000-0000-4000-8000-00000000000a'
const ID = '11111111-1111-4111-8111-111111111111'

// A PostgREST query: records every call and answers `result` when awaited.
function chain(result: { data?: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy }
    }
  })
  return { proxy, calls }
}
const arg = (c: { calls: [string, unknown[]][] }, name: string) => c.calls.find(x => x[0] === name)?.[1]

const rowOf = (over: Partial<CheckinRow> = {}): CheckinRow => ({
  id: ID, day: '2026-10-10', activity: 'strength', routine_id: 'r1', routine_name: 'Push', title: 'Musculação · Push',
  caption: 'Bom treino', note: 'joelho ok', duration_min: 55, visibility: 'friends', photo_path: `${ME}/${ID}.jpg`,
  detail: null, created_at: '2026-10-10T12:00:00.000Z', updated_at: '2026-10-10T12:00:00.000Z', ...over
})

beforeEach(() => {
  h.rpc.mockReset(); h.from.mockReset(); h.storageFrom.mockClear()
  Object.values(h.bucket).forEach(f => f.mockReset())
  api.clearSignedUrls()
})
afterEach(() => { vi.useRealTimers() })

describe('photos in Storage', () => {
  it('uploads into the own folder, named after the check-in, without overwriting', async () => {
    h.bucket.upload.mockResolvedValue({ data: { path: `${ME}/${ID}.jpg` }, error: null })
    const blob = new Blob([new Uint8Array(3)], { type: 'image/jpeg' })
    await expect(api.uploadPhoto(ME, ID, blob, 'jpg')).resolves.toBe(`${ME}/${ID}.jpg`)
    expect(h.storageFrom).toHaveBeenCalledWith('checkins')
    const [path, body, opts] = h.bucket.upload.mock.calls[0]
    expect(path).toBe(`${ME}/${ID}.jpg`)
    expect(body).toBe(blob)
    expect(opts).toMatchObject({ contentType: 'image/jpeg', upsert: false })

    h.bucket.upload.mockClear()
    await api.uploadPhoto(ME, ID, new Blob([], { type: 'image/webp' }), 'webp')
    expect(h.bucket.upload.mock.calls[0][0]).toBe(`${ME}/${ID}.webp`)
    expect(h.bucket.upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/webp' })
  })

  it('takes a photo already there as uploaded (a retry after a lost answer)', async () => {
    h.bucket.upload.mockResolvedValue({ data: null, error: { name: 'StorageApiError', message: 'The resource already exists', status: 400, statusCode: '409' } })
    await expect(api.uploadPhoto(ME, ID, new Blob([]), 'jpg')).resolves.toBe(`${ME}/${ID}.jpg`)
  })

  it('keeps a failed upload for another try, but refuses for good a file the bucket never takes', async () => {
    h.bucket.upload.mockResolvedValue({ data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } })
    await expect(api.uploadPhoto(ME, ID, new Blob([]), 'jpg')).rejects.toMatchObject({ refused: false })
    h.bucket.upload.mockResolvedValue({ data: null, error: { name: 'StorageApiError', message: 'Payload too large', status: 413, statusCode: '413' } })
    await expect(api.uploadPhoto(ME, ID, new Blob([]), 'jpg')).rejects.toMatchObject({ refused: true, reason: 'refused' })
    h.bucket.upload.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.uploadPhoto(ME, ID, new Blob([]), 'jpg')).rejects.toMatchObject({ refused: false })
  })

  it('removes one photo by its path', async () => {
    h.bucket.remove.mockResolvedValue({ data: [], error: null })
    await api.removePhoto(`${ME}/${ID}.jpg`)
    expect(h.bucket.remove).toHaveBeenCalledWith([`${ME}/${ID}.jpg`])
    h.bucket.remove.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await expect(api.removePhoto(`${ME}/${ID}.jpg`)).rejects.toMatchObject({ refused: false })
  })

  it('removes the whole folder, page after page, until it is empty', async () => {
    const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ name: `${String(from + i).padStart(8, '0')}-1111-4111-8111-111111111111.jpg` }))
    h.bucket.list
      .mockResolvedValueOnce({ data: page(1000), error: null })
      .mockResolvedValueOnce({ data: page(3, 1000), error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    h.bucket.remove.mockImplementation(async (paths: string[]) => ({ data: paths.map(name => ({ name })), error: null }))
    await api.removeAllPhotos(ME)
    expect(h.bucket.list).toHaveBeenCalledWith(ME, expect.objectContaining({ limit: 1000 }))
    expect(h.bucket.remove).toHaveBeenCalledTimes(2)
    expect(h.bucket.remove.mock.calls[0][0]).toHaveLength(1000)
    expect(h.bucket.remove.mock.calls[1][0]).toEqual(page(3, 1000).map(f => `${ME}/${f.name}`))
  })

  it('stops instead of looping when nothing in the folder can be removed', async () => {
    h.bucket.list.mockResolvedValue({ data: [{ name: `${ID}.jpg` }], error: null })
    h.bucket.remove.mockResolvedValue({ data: [], error: null })
    await api.removeAllPhotos(ME)
    expect(h.bucket.remove).toHaveBeenCalledTimes(1)
  })

  it('throws when the folder cannot be read', async () => {
    h.bucket.list.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await expect(api.removeAllPhotos(ME)).rejects.toBeTruthy()
  })
})

describe('signed links', () => {
  const answer = (paths: string[]) => ({ data: paths.map(p => ({ path: p, signedUrl: `https://x/${p}?t=1`, error: null })), error: null })

  it('asks only for the paths without a valid link and keeps them for 55 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
    h.bucket.createSignedUrls.mockImplementation(async (paths: string[]) => answer(paths))
    await expect(api.signedUrls(['a/1.jpg', 'b/2.jpg', 'a/1.jpg'])).resolves.toEqual({ 'a/1.jpg': 'https://x/a/1.jpg?t=1', 'b/2.jpg': 'https://x/b/2.jpg?t=1' })
    expect(h.bucket.createSignedUrls).toHaveBeenCalledWith(['a/1.jpg', 'b/2.jpg'], 3600)

    vi.setSystemTime(new Date('2026-10-10T12:54:00Z'))
    const out = await api.signedUrls(['a/1.jpg', 'c/3.jpg'])
    expect(Object.keys(out).sort()).toEqual(['a/1.jpg', 'c/3.jpg'])
    expect(h.bucket.createSignedUrls).toHaveBeenLastCalledWith(['c/3.jpg'], 3600)

    vi.setSystemTime(new Date('2026-10-10T12:55:01Z'))
    await api.signedUrls(['a/1.jpg', 'c/3.jpg'])
    expect(h.bucket.createSignedUrls).toHaveBeenLastCalledWith(['a/1.jpg'], 3600)
  })

  it('makes no request when every link is cached or the list is empty', async () => {
    h.bucket.createSignedUrls.mockImplementation(async (paths: string[]) => answer(paths))
    await api.signedUrls(['a/1.jpg'])
    await api.signedUrls(['a/1.jpg'])
    await api.signedUrls([])
    expect(h.bucket.createSignedUrls).toHaveBeenCalledTimes(1)
  })

  it('leaves out a path the server would not sign, and caches nothing for it', async () => {
    h.bucket.createSignedUrls.mockResolvedValue({ data: [
      { path: 'a/1.jpg', signedUrl: 'https://x/a', error: null },
      { path: 'b/2.jpg', signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }
    ], error: null })
    await expect(api.signedUrls(['a/1.jpg', 'b/2.jpg'])).resolves.toEqual({ 'a/1.jpg': 'https://x/a' })
    await api.signedUrls(['a/1.jpg', 'b/2.jpg'])
    expect(h.bucket.createSignedUrls).toHaveBeenLastCalledWith(['b/2.jpg'], 3600)
  })

  it('forgets every link on clearSignedUrls (sign-out)', async () => {
    h.bucket.createSignedUrls.mockImplementation(async (paths: string[]) => answer(paths))
    await api.signedUrls(['a/1.jpg'])
    api.clearSignedUrls()
    await api.signedUrls(['a/1.jpg'])
    expect(h.bucket.createSignedUrls).toHaveBeenCalledTimes(2)
  })

  it('throws when the request fails', async () => {
    h.bucket.createSignedUrls.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    await expect(api.signedUrls(['a/1.jpg'])).rejects.toMatchObject({ code: 'network' })
  })
})

describe('check-in rows', () => {
  it('upsert: tries the update first with the editable columns only, and stops there when the row exists', async () => {
    const c = chain({ data: [{ id: ID }], error: null }); h.from.mockReturnValue(c.proxy)
    await api.upsertCheckin(rowOf())
    expect(h.from).toHaveBeenCalledWith('checkins')
    expect(h.from).toHaveBeenCalledTimes(1)
    const [patch] = arg(c, 'update') as [Record<string, unknown>]
    expect(patch).toEqual({
      routine_id: 'r1', routine_name: 'Push', title: 'Musculação · Push', caption: 'Bom treino', note: 'joelho ok',
      duration_min: 55, visibility: 'friends', detail: null, updated_at: '2026-10-10T12:00:00.000Z'
    })
    expect(c.calls).toContainEqual(['eq', ['id', ID]])
  })

  it('upsert: inserts the whole row, without user_id, when the update found nothing', async () => {
    const upd = chain({ data: [], error: null }), ins = chain({ data: null, error: null })
    h.from.mockReturnValueOnce(upd.proxy).mockReturnValueOnce(ins.proxy)
    await api.upsertCheckin(rowOf({ user_id: ME }))
    const [row] = arg(ins, 'insert') as [Record<string, unknown>]
    expect(row).toMatchObject({ id: ID, day: '2026-10-10', activity: 'strength', photo_path: `${ME}/${ID}.jpg`, created_at: '2026-10-10T12:00:00.000Z' })
    expect(row).not.toHaveProperty('user_id')
  })

  it('upsert: a row that appeared meanwhile (23505) counts as done', async () => {
    h.from.mockReturnValueOnce(chain({ data: [], error: null }).proxy)
      .mockReturnValueOnce(chain({ data: null, error: { code: '23505', message: 'duplicate key value' } }).proxy)
    await expect(api.upsertCheckin(rowOf())).resolves.toBeUndefined()
  })

  it('upsert: a closed day is a refusal with its code; no network is not', async () => {
    h.from.mockReturnValueOnce(chain({ data: [], error: null }).proxy)
      .mockReturnValueOnce(chain({ data: null, error: { code: 'P0001', message: 'day_closed' } }).proxy)
    await expect(api.upsertCheckin(rowOf())).rejects.toMatchObject({ code: 'day_closed', refused: true })
    h.from.mockReturnValueOnce(chain({ data: null, error: { message: 'TypeError: Failed to fetch' } }).proxy)
    await expect(api.upsertCheckin(rowOf())).rejects.toMatchObject({ code: 'network', refused: false })
  })

  it('update: only the editable columns, never an insert', async () => {
    const c = chain({ data: [], error: null }); h.from.mockReturnValue(c.proxy)
    await api.updateCheckin(rowOf({ title: 'Novo' }))
    expect(h.from).toHaveBeenCalledTimes(1)
    const [patch] = arg(c, 'update') as [Record<string, unknown>]
    expect(patch.title).toBe('Novo')
    for (const k of ['id', 'day', 'activity', 'photo_path', 'user_id', 'created_at']) expect(patch).not.toHaveProperty(k)
  })

  it('deletes by id and tells whether a row exists', async () => {
    const c = chain({ data: null, error: null }); h.from.mockReturnValue(c.proxy)
    await api.deleteCheckin(ID)
    expect(c.calls.map(x => x[0])).toContain('delete')
    expect(c.calls).toContainEqual(['eq', ['id', ID]])

    h.from.mockReturnValue(chain({ data: [{ id: ID }], error: null }).proxy)
    await expect(api.hasCheckin(ID)).resolves.toBe(true)
    h.from.mockReturnValue(chain({ data: [], error: null }).proxy)
    await expect(api.hasCheckin(ID)).resolves.toBe(false)
  })

  it('reads my check-ins of a range, newest first', async () => {
    const c = chain({ data: [{ ...rowOf(), user_id: ME, duration_min: '55' }], error: null }); h.from.mockReturnValue(c.proxy)
    const out = await api.fetchMyCheckins('2026-10-01', '2026-10-10')
    expect(c.calls).toContainEqual(['gte', ['day', '2026-10-01']])
    expect(c.calls).toContainEqual(['lte', ['day', '2026-10-10']])
    expect(c.calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(out[0]).toMatchObject({ id: ID, note: 'joelho ok', duration_min: 55 })
  })

  it('hides a post for me; hiding it twice is fine', async () => {
    const c = chain({ data: null, error: null }); h.from.mockReturnValue(c.proxy)
    await api.hideCheckin(ID)
    expect(h.from).toHaveBeenCalledWith('hidden_checkins')
    expect(arg(c, 'insert')).toEqual([{ checkin_id: ID }])
    h.from.mockReturnValue(chain({ data: null, error: { code: '23505', message: 'duplicate key value' } }).proxy)
    await expect(api.hideCheckin(ID)).resolves.toBeUndefined()
  })

  it('lists the challenges I am invited to and have not joined, while they can still be joined', async () => {
    const c = chain({ data: [
      { challenge_id: 'c1', challenges: { ends_on: '2026-10-18', status: 'active' } },
      { challenge_id: 'c2', challenges: { ends_on: '2026-10-10', status: 'active' } }
    ], error: null }); h.from.mockReturnValue(c.proxy)
    await expect(api.fetchPendingInvites(ME, '2026-10-10')).resolves.toEqual(['c1', 'c2'])
    expect(h.from).toHaveBeenCalledWith('challenge_members')
    expect(arg(c, 'select')).toEqual(['challenge_id, challenges!inner(ends_on, status)'])
    expect(c.calls).toContainEqual(['eq', ['user_id', ME]])
    expect(c.calls).toContainEqual(['is', ['joined_at', null]])
    expect(c.calls).toContainEqual(['not', ['invited_by', 'is', null]])
    expect(c.calls).toContainEqual(['eq', ['challenges.status', 'active']])
    expect(c.calls).toContainEqual(['gte', ['challenges.ends_on', '2026-10-10']])
  })

  it('leaves out an invite whose challenge ended before today or is no longer active', async () => {
    h.from.mockReturnValue(chain({ data: [
      { challenge_id: 'old', challenges: { ends_on: '2026-10-09', status: 'active' } },
      { challenge_id: 'gone', challenges: { ends_on: '2026-10-20', status: 'cancelled' } },
      { challenge_id: 'ok', challenges: { ends_on: '2026-10-20', status: 'active' } }
    ], error: null }).proxy)
    await expect(api.fetchPendingInvites(ME, '2026-10-10')).resolves.toEqual(['ok'])
  })
})

describe('feed and social RPCs', () => {
  const ok = (data: unknown = null) => h.rpc.mockResolvedValue({ data, error: null })

  it('pages the feed by time and key', async () => {
    ok({ items: [], next: null })
    await expect(api.fetchFeed()).resolves.toEqual({ items: [], next: null })
    expect(h.rpc).toHaveBeenLastCalledWith('get_checkin_feed', { p_before: null, p_before_key: null })
    await api.fetchFeed({ before: '2026-10-10T12:00:00Z', before_key: `checkin:${ID}` })
    expect(h.rpc).toHaveBeenLastCalledWith('get_checkin_feed', { p_before: '2026-10-10T12:00:00Z', p_before_key: `checkin:${ID}` })
  })

  it('pages a challenge feed', async () => {
    ok({ items: [{ type: 'checkin', key: 'checkin:x', at: 'a', day: 'd', user: { id: 'u', name: 'Ana', avatar_url: null }, private: true }], next: null })
    const page = await api.fetchChallengeFeed('c1')
    expect(h.rpc).toHaveBeenLastCalledWith('get_challenge_feed', { p_id: 'c1', p_before: null, p_before_key: null })
    expect(page.items[0]).toMatchObject({ private: true })
    await api.fetchChallengeFeed('c1', { before: 't', before_key: 'k' })
    expect(h.rpc).toHaveBeenLastCalledWith('get_challenge_feed', { p_id: 'c1', p_before: 't', p_before_key: 'k' })
  })

  it('reads one post, reacts, comments and deletes a comment', async () => {
    ok({ id: ID, reactions: [], comments: [] })
    await api.fetchCheckin(ID)
    expect(h.rpc).toHaveBeenLastCalledWith('get_checkin', { p_id: ID })
    ok()
    await api.react(ID, '💪', true)
    expect(h.rpc).toHaveBeenLastCalledWith('react_checkin', { p_id: ID, p_emoji: '💪', p_on: true })
    ok(42)
    await expect(api.comment(ID, 'boa!')).resolves.toBe(42)
    expect(h.rpc).toHaveBeenLastCalledWith('comment_checkin', { p_id: ID, p_body: 'boa!' })
    ok()
    await api.deleteComment(42)
    expect(h.rpc).toHaveBeenLastCalledWith('delete_comment', { p_id: 42 })
  })

  it('reads the notices and marks them read up to an id', async () => {
    ok({ items: [{ id: 3 }], unread: 2 })
    await expect(api.fetchNotices()).resolves.toEqual({ items: [{ id: 3 }], unread: 2 })
    expect(h.rpc).toHaveBeenLastCalledWith('get_notices', {})
    ok()
    await api.markNoticesRead(3)
    expect(h.rpc).toHaveBeenLastCalledWith('mark_notices_read', { p_upto: 3 })
  })

  it('names the errors the screens can explain, and anything else is network', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'not_found' } })
    await expect(api.react(ID, '💪', true)).rejects.toMatchObject({ code: 'not_found' })
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'too_many_reactions' } })
    await expect(api.react(ID, '🔥', true)).rejects.toMatchObject({ code: 'too_many_reactions' })
    h.rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'challenge_not_found' } })
    await expect(api.fetchChallengeFeed('c')).rejects.toMatchObject({ code: 'challenge_not_found' })
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.comment(ID, 'x')).rejects.toMatchObject({ code: 'network' })
  })
})
