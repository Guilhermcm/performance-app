import { create } from 'zustand'
import * as api from './social-api'
import { toSocialError } from './social-api'
import { useProgress } from '../gamification/useProgress'
import type { Challenge, FeedCursor, FeedItem, Friend, Leaderboard, MyInvite, SocialErrorCode } from './types'

export type ListKey = 'friends' | 'invites' | 'weekly' | 'alltime' | 'challenges'
type Lists = { friends: Friend[]; invites: MyInvite[]; weekly: Leaderboard; alltime: Leaderboard; challenges: Challenge[] }

export type Resource<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null; stale: boolean; error: SocialErrorCode | null }
export type FeedState = {
  status: Resource<unknown>['status']
  items: FeedItem[]
  next: FeedCursor | null
  stale: boolean
  error: SocialErrorCode | null
  busy: boolean
}

const CACHE = 'perf_social_v1'
// Open invites are not kept: they are only useful fresh, and the list is short.
const CACHED: readonly ListKey[] = ['friends', 'weekly', 'alltime', 'challenges']
const FETCH: { [K in ListKey]: () => Promise<Lists[K]> } = {
  friends: api.getFriends,
  invites: () => api.listMyInvites(),
  weekly: api.getWeeklyLeaderboard,
  alltime: api.getAlltimeLeaderboard,
  challenges: api.getChallenges
}

type Saved = { userId: string; feed?: FeedItem[] } & Partial<Omit<Lists, 'invites'>>
const readSaved = (userId: string): Saved | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null')
    return c && c.userId === userId ? (c as Saved) : null
  } catch { return null }
}
const save = (userId: string, patch: Omit<Partial<Saved>, 'userId'>) => {
  try { localStorage.setItem(CACHE, JSON.stringify({ ...(readSaved(userId) ?? {}), ...patch, userId })) } catch { /* full or blocked */ }
}
const drop = () => { try { localStorage.removeItem(CACHE) } catch { /* ignore */ } }

const idle = <T>(): Resource<T> => ({ status: 'idle', data: null, stale: false, error: null })
const fromSaved = <T>(v: T | undefined): Resource<T> => (v ? { status: 'ready', data: v, stale: true, error: null } : idle<T>())
const idleFeed = (): FeedState => ({ status: 'idle', items: [], next: null, stale: false, error: null, busy: false })

interface SocialStore {
  userId: string | null
  friends: Resource<Friend[]>
  invites: Resource<MyInvite[]>
  weekly: Resource<Leaderboard>
  alltime: Resource<Leaderboard>
  challenges: Resource<Challenge[]>
  feed: FeedState
  bind(userId: string): void
  load<K extends ListKey>(key: K): Promise<Lists[K] | null>
  loadFeed(more?: boolean): Promise<void>
  reset(): void
}

const running = new Map<ListKey, Promise<unknown>>()
// Bumped by reset(): a request from before a sign-out must not unregister one started after it.
let generation = 0

export const useSocial = create<SocialStore>((set, get) => {
  const put = (key: ListKey, value: Resource<unknown>) => set({ [key]: value } as unknown as Partial<SocialStore>)

  return {
    userId: null,
    friends: idle(),
    invites: idle(),
    weekly: idle(),
    alltime: idle(),
    challenges: idle(),
    feed: idleFeed(),

    // Called once a signed-in account has a ready profile (App.jsx): the saved copy at once, then
    // the challenges from the server. get_challenges closes due ones (Decision 12), so a win that
    // closed since the last visit is followed by a progress refresh, which celebrates it.
    bind(userId) {
      if (get().userId === userId) return
      const saved = readSaved(userId)
      set({
        userId,
        friends: fromSaved(saved?.friends),
        invites: idle(),
        weekly: fromSaved(saved?.weekly),
        alltime: fromSaved(saved?.alltime),
        challenges: fromSaved(saved?.challenges),
        feed: saved?.feed?.length ? { ...idleFeed(), status: 'ready', items: saved.feed, stale: true } : idleFeed()
      })
      const closedBefore = new Set((saved?.challenges ?? []).filter(c => c.status !== 'active').map(c => c.id))
      void get().load('challenges').then(list => {
        if (list?.some(c => c.status !== 'active' && c.me.won && !closedBefore.has(c.id))) void useProgress.getState().refresh()
      })
    },

    // One request per list at a time; callers that arrive meanwhile share it.
    load<K extends ListKey>(key: K): Promise<Lists[K] | null> {
      const inFlight = running.get(key)
      if (inFlight) return inFlight as Promise<Lists[K] | null>
      const userId = get().userId
      if (!userId) return Promise.resolve(null)
      const gen = generation
      const job = (async (): Promise<Lists[K] | null> => {
        const cur = get()[key] as Resource<Lists[K]>
        if (!cur.data) put(key, { ...cur, status: 'loading', error: null })
        try {
          const data = await FETCH[key]()
          if (get().userId !== userId) return null
          put(key, { status: 'ready', data, stale: false, error: null })
          if (CACHED.includes(key)) save(userId, { [key]: data } as Omit<Partial<Saved>, 'userId'>)
          return data
        } catch (e) {
          if (get().userId !== userId) return null
          const error = toSocialError(e).code
          const now = get()[key] as Resource<Lists[K]>
          put(key, now.data ? { ...now, status: 'ready', stale: true, error } : { status: 'error', data: null, stale: false, error })
          return null
        } finally {
          if (gen === generation) running.delete(key)
        }
      })()
      running.set(key, job)
      return job
    },

    // First page, or the next one after what is on screen.
    async loadFeed(more = false) {
      const { userId, feed } = get()
      if (!userId || feed.busy || (more && !feed.next)) return
      set({ feed: { ...feed, status: feed.items.length ? feed.status : 'loading', busy: true, error: null } })
      try {
        const page = await api.getFeed(more ? feed.next : null)
        if (get().userId !== userId) return
        const items = more ? [...get().feed.items, ...page.items] : page.items
        set({ feed: { status: 'ready', items, next: page.next, stale: false, error: null, busy: false } })
        if (!more) save(userId, { feed: page.items })
      } catch (e) {
        if (get().userId !== userId) return
        const error = toSocialError(e).code
        set(s => ({
          feed: s.feed.items.length
            ? { ...s.feed, status: 'ready', stale: s.feed.stale || !more, error, busy: false }
            : { ...idleFeed(), status: 'error', error }
        }))
      }
    },

    reset() {
      running.clear()
      generation++
      drop()
      set({ userId: null, friends: idle(), invites: idle(), weekly: idle(), alltime: idle(), challenges: idle(), feed: idleFeed() })
    }
  }
})
