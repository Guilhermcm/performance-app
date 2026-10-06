import { create } from 'zustand'
import { fetchProgress } from './progress-api'
import { celebrationsSince, completeMarker, markerOf, type SeenMarker } from './celebrations'
import type { Celebration, Progress } from './types'

const CACHE = 'perf_progress_v1'
const SEEN = 'perf_celebrated_v1'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface ProgressStore {
  status: Status
  progress: Progress | null
  userId: string | null
  // Showing the cached copy: the server has not answered since this screen opened.
  stale: boolean
  // Level-ups and badges not shown yet (CelebrationHost shows them).
  pending: Celebration[]
  // The post-workout summary holds the celebrations until its XP has finished counting.
  held: boolean
  load(userId: string): Promise<void>
  refresh(): Promise<Progress | null>
  takePending(): Celebration[]
  hold(on: boolean): void
  reset(): void
}

const read = <T>(key: string, userId: string): T | null => {
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null')
    return c && c.userId === userId ? (c.value as T) : null
  } catch { return null }
}
const write = (key: string, userId: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify({ userId, value })) } catch { /* storage full or blocked */ }
}
const drop = (key: string) => { try { localStorage.removeItem(key) } catch { /* ignore */ } }

let running: Promise<Progress | null> | null = null
let again: Promise<Progress | null> | null = null

export const useProgress = create<ProgressStore>((set, get) => {
  const fetchOnce = async (): Promise<Progress | null> => {
    const userId = get().userId
    if (!userId) return null
    try {
      const progress = await fetchProgress()
      if (get().userId !== userId) return null
      write(CACHE, userId, progress)
      // The first answer for this person on this device sets what counts as already seen.
      let seen = read<SeenMarker>(SEEN, userId)
      if (!seen) { seen = markerOf(progress); write(SEEN, userId, seen) }
      else {
        // A marker from before phase 2a: what it lacks counts as already seen.
        const done = completeMarker(seen, progress)
        if (done !== seen) { seen = done; write(SEEN, userId, seen) }
      }
      set({ progress, status: 'ready', stale: false, pending: celebrationsSince(seen, progress) })
      return progress
    } catch {
      if (get().userId !== userId) return null
      set(s => ({ status: s.progress ? 'ready' : 'error', stale: !!s.progress }))
      return null
    }
  }

  return {
    status: 'idle',
    progress: null,
    userId: null,
    stale: false,
    pending: [],
    held: false,

    async load(userId) {
      const cached = read<Progress>(CACHE, userId)
      set({ userId, progress: cached, status: cached ? 'ready' : 'loading', stale: !!cached, pending: [] })
      await get().refresh()
    },

    // One request at a time. A call made while one runs (an event sent mid-request) gets a single
    // follow-up, so the answer it waits for includes what it just sent.
    refresh() {
      if (!running) {
        running = fetchOnce().finally(() => { running = null })
        return running
      }
      if (!again) again = running.then(() => { again = null; return get().refresh() })
      return again
    },

    takePending() {
      const { pending, progress, userId } = get()
      if (userId && progress) write(SEEN, userId, markerOf(progress))
      set({ pending: [] })
      return pending
    },

    hold(on) {
      set({ held: on })
    },

    reset() {
      drop(CACHE)
      drop(SEEN)
      set({ status: 'idle', progress: null, userId: null, stale: false, pending: [], held: false })
    }
  }
})

// Fresh numbers whenever the app comes back to the foreground or online.
export function startProgressSync(): () => void {
  const run = () => { if (document.visibilityState === 'visible') void useProgress.getState().refresh() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', run)
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', run)
  }
}
