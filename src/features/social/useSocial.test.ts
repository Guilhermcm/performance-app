// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const api = vi.hoisted(() => ({
  getFriends: vi.fn(), listMyInvites: vi.fn(), getWeeklyLeaderboard: vi.fn(), getAlltimeLeaderboard: vi.fn(),
  getChallenges: vi.fn(), getFeed: vi.fn()
}))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), ...api }))
const progress = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => progress } }))

import { useSocial } from './useSocial'
import { SocialError } from './social-api'
import { BIA, challengeOf, feedItemOf, friendOf } from './test-social'

const cache = () => JSON.parse(localStorage.getItem('perf_social_v1') || 'null')
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  Object.values(api).forEach(f => f.mockReset())
  progress.refresh.mockReset()
  api.getChallenges.mockResolvedValue([])
})

describe('useSocial', () => {
  it('loads a list and keeps a copy per person', async () => {
    const list = [friendOf(BIA, 'Bia')]
    api.getFriends.mockResolvedValue(list)
    useSocial.getState().bind('u1')
    const loading = useSocial.getState().load('friends')
    expect(useSocial.getState().friends.status).toBe('loading')
    await expect(loading).resolves.toEqual(list)
    expect(useSocial.getState().friends).toEqual({ status: 'ready', data: list, stale: false, error: null })
    expect(cache()).toMatchObject({ userId: 'u1', friends: list })
  })

  it('opens with the saved copy, stale until the server answers', async () => {
    const old = [friendOf(BIA, 'Bia')]
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', friends: old }))
    let answer!: (v: unknown) => void
    api.getFriends.mockReturnValue(new Promise(r => { answer = r }))
    useSocial.getState().bind('u1')
    const loading = useSocial.getState().load('friends')
    expect(useSocial.getState().friends).toMatchObject({ status: 'ready', data: old, stale: true })
    answer([])
    await loading
    expect(useSocial.getState().friends).toMatchObject({ data: [], stale: false })
  })

  it('keeps the saved copy offline and says why; errors without one', async () => {
    api.getFriends.mockRejectedValue(new SocialError('network'))
    useSocial.getState().bind('u1')
    await useSocial.getState().load('friends')
    expect(useSocial.getState().friends).toEqual({ status: 'error', data: null, stale: false, error: 'network' })
    useSocial.getState().reset()
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', friends: [friendOf(BIA, 'Bia')] }))
    useSocial.getState().bind('u1')
    await useSocial.getState().load('friends')
    expect(useSocial.getState().friends).toMatchObject({ status: 'ready', stale: true, error: 'network' })
  })

  it('ignores a saved copy that belongs to someone else', () => {
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u2', friends: [friendOf(BIA, 'Bia')] }))
    useSocial.getState().bind('u1')
    expect(useSocial.getState().friends.data).toBeNull()
  })

  it('shares one request between callers', async () => {
    api.getWeeklyLeaderboard.mockResolvedValue({ week_start: '2026-10-05', rows: [] })
    useSocial.getState().bind('u1')
    await Promise.all([useSocial.getState().load('weekly'), useSocial.getState().load('weekly')])
    expect(api.getWeeklyLeaderboard).toHaveBeenCalledTimes(1)
  })

  it('never saves open invites', async () => {
    api.listMyInvites.mockResolvedValue([{ code: 'AbCdEfGh12', created_at: 'x', expires_at: 'y' }])
    useSocial.getState().bind('u1')
    await useSocial.getState().load('invites')
    expect(useSocial.getState().invites.data).toHaveLength(1)
    expect(cache()?.invites).toBeUndefined()
  })

  it('drops an answer that arrives after a sign-out', async () => {
    let answer!: (v: unknown) => void
    api.getFriends.mockReturnValue(new Promise(r => { answer = r }))
    useSocial.getState().bind('u1')
    const loading = useSocial.getState().load('friends')
    useSocial.getState().reset()
    answer([friendOf(BIA, 'Bia')])
    await loading
    expect(useSocial.getState()).toMatchObject({ userId: null, friends: { status: 'idle', data: null } })
    expect(localStorage.getItem('perf_social_v1')).toBeNull()
  })

  it('pages the feed', async () => {
    api.getFeed
      .mockResolvedValueOnce({ items: [feedItemOf(3), feedItemOf(2)], next: { before: 't2', before_id: 2 } })
      .mockResolvedValueOnce({ items: [feedItemOf(1)], next: null })
    useSocial.getState().bind('u1')
    await useSocial.getState().loadFeed()
    await useSocial.getState().loadFeed(true)
    expect(api.getFeed).toHaveBeenNthCalledWith(1, null)
    expect(api.getFeed).toHaveBeenNthCalledWith(2, { before: 't2', before_id: 2 })
    expect(useSocial.getState().feed).toMatchObject({ status: 'ready', next: null, busy: false })
    expect(useSocial.getState().feed.items.map(i => i.id)).toEqual([3, 2, 1])
    await useSocial.getState().loadFeed(true)
    expect(api.getFeed).toHaveBeenCalledTimes(2)
  })

  it('loads challenges on bind and refreshes progress after a win closed since last time', async () => {
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', challenges: [challengeOf()] }))
    api.getChallenges.mockResolvedValue([challengeOf({ status: 'won', me: { joined: true, won: true } })])
    useSocial.getState().bind('u1')
    await flush()
    expect(api.getChallenges).toHaveBeenCalledTimes(1)
    expect(progress.refresh).toHaveBeenCalledTimes(1)
    useSocial.getState().reset()
    localStorage.setItem('perf_social_v1', JSON.stringify({ userId: 'u1', challenges: [challengeOf({ status: 'won', me: { joined: true, won: true } })] }))
    useSocial.getState().bind('u1')
    await flush()
    expect(progress.refresh).toHaveBeenCalledTimes(1)
  })
})
