import { create } from 'zustand'
import { fetchProfile, createProfile, updateProfile } from './profile-api'
import type { StarterPlanId } from './starter-suggest'
import type { Profile, ProfileInput } from './types'

const CACHE = 'perf_profile_v1'
type Status = 'idle' | 'loading' | 'missing' | 'ready' | 'error'

interface ProfileStore {
  status: Status
  profile: Profile | null
  userId: string | null
  // True from the moment the profile is created until the user leaves the plan suggestion:
  // status is already 'ready' then, and ProfileGate must keep the onboarding on screen.
  onboarding: boolean
  suggestion: StarterPlanId | null
  load(userId: string): Promise<void>
  create(input: Partial<ProfileInput>): Promise<Profile>
  save(patch: Partial<ProfileInput>): Promise<Profile>
  setSuggestion(id: StarterPlanId): void
  finishOnboarding(): void
  reset(): void
}

const readCache = (userId: string): Profile | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null')
    return c && c.userId === userId ? (c.profile as Profile) : null
  } catch { return null }
}
const writeCache = (userId: string, profile: Profile) => {
  try { localStorage.setItem(CACHE, JSON.stringify({ userId, profile })) } catch { /* storage full or blocked */ }
}

export const useProfile = create<ProfileStore>((set, get) => ({
  status: 'idle',
  profile: null,
  userId: null,
  onboarding: false,
  suggestion: null,

  async load(userId) {
    set({ status: 'loading', userId })
    try {
      const profile = await fetchProfile(userId)
      if (get().userId !== userId) return
      if (!profile) { set({ status: 'missing', profile: null }); return }
      writeCache(userId, profile)
      set({ status: 'ready', profile })
    } catch {
      if (get().userId !== userId) return
      const cached = readCache(userId)
      set(cached ? { status: 'ready', profile: cached } : { status: 'error', profile: null })
    }
  },

  async create(input) {
    const userId = get().userId
    if (!userId) throw new Error('not signed in')
    const profile = await createProfile(userId, input)
    writeCache(userId, profile)
    set({ status: 'ready', profile, onboarding: true })
    return profile
  },

  setSuggestion(id) {
    set({ suggestion: id })
  },

  finishOnboarding() {
    set({ onboarding: false, suggestion: null })
  },

  async save(patch) {
    const { userId, profile: before } = get()
    if (!userId || !before) throw new Error('no profile')
    set({ profile: { ...before, ...patch } as Profile })
    try {
      const profile = await updateProfile(userId, patch)
      writeCache(userId, profile)
      set({ profile })
      return profile
    } catch (e) {
      set({ profile: before })
      throw e
    }
  },

  reset() {
    try { localStorage.removeItem(CACHE) } catch { /* ignore */ }
    set({ status: 'idle', profile: null, userId: null, onboarding: false, suggestion: null })
  }
}))
