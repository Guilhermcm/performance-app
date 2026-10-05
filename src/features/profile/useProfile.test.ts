// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({ fetchProfile: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn() }))
vi.mock('./profile-api', () => api)

import { useProfile } from './useProfile'

const P = { id: 'u1', display_name: 'Ana' }

beforeEach(() => {
  localStorage.clear()
  useProfile.getState().reset()
  Object.values(api).forEach(f => f.mockReset())
})

describe('useProfile', () => {
  it('goes to missing when there is no profile', async () => {
    api.fetchProfile.mockResolvedValue(null)
    await useProfile.getState().load('u1')
    expect(useProfile.getState().status).toBe('missing')
  })

  it('goes to ready and caches the profile', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    expect(useProfile.getState()).toMatchObject({ status: 'ready', profile: P, userId: 'u1' })
    expect(JSON.parse(localStorage.getItem('perf_profile_v1')!)).toEqual({ userId: 'u1', profile: P })
  })

  it('uses the cached profile when offline', async () => {
    localStorage.setItem('perf_profile_v1', JSON.stringify({ userId: 'u1', profile: P }))
    api.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await useProfile.getState().load('u1')
    expect(useProfile.getState()).toMatchObject({ status: 'ready', profile: P })
  })

  it('ignores another user’s cache and reports the error', async () => {
    localStorage.setItem('perf_profile_v1', JSON.stringify({ userId: 'u2', profile: P }))
    api.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await useProfile.getState().load('u1')
    expect(useProfile.getState().status).toBe('error')
  })

  it('drops a stale answer when another user loaded meanwhile', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    api.fetchProfile.mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
    api.fetchProfile.mockResolvedValueOnce({ id: 'u2', display_name: 'Bia' })
    const first = useProfile.getState().load('u1')
    await useProfile.getState().load('u2')
    resolveFirst(P)
    await first
    expect(useProfile.getState()).toMatchObject({ userId: 'u2', profile: { id: 'u2' } })
  })

  it('creates and becomes ready', async () => {
    api.fetchProfile.mockResolvedValue(null)
    api.createProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    await useProfile.getState().create({ display_name: 'Ana' } as never)
    expect(api.createProfile).toHaveBeenCalledWith('u1', { display_name: 'Ana' })
    expect(useProfile.getState().status).toBe('ready')
  })

  it('refuses to create or save without a user', async () => {
    await expect(useProfile.getState().create({ display_name: 'Ana' })).rejects.toThrow()
    await expect(useProfile.getState().save({ display_name: 'Ana' })).rejects.toThrow()
  })

  it('saves optimistically and rolls back on failure', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    api.updateProfile.mockRejectedValue(new Error('nope'))
    const pending = useProfile.getState().save({ display_name: 'Bia' })
    expect(useProfile.getState().profile?.display_name).toBe('Bia')
    await expect(pending).rejects.toThrow('nope')
    expect(useProfile.getState().profile?.display_name).toBe('Ana')
  })

  it('keeps the server’s row after a successful save', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    api.updateProfile.mockResolvedValue({ ...P, display_name: 'Bia' })
    await useProfile.getState().save({ display_name: 'Bia' })
    expect(api.updateProfile).toHaveBeenCalledWith('u1', { display_name: 'Bia' })
    expect(JSON.parse(localStorage.getItem('perf_profile_v1')!).profile.display_name).toBe('Bia')
  })

  it('stays in onboarding after create until finishOnboarding', async () => {
    api.fetchProfile.mockResolvedValue(null)
    api.createProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    await useProfile.getState().create({ display_name: 'Ana' } as never)
    useProfile.getState().setSuggestion('5x5')
    expect(useProfile.getState()).toMatchObject({ onboarding: true, suggestion: '5x5' })
    useProfile.getState().finishOnboarding()
    expect(useProfile.getState()).toMatchObject({ onboarding: false, suggestion: null })
  })

  it('reset clears state and cache', async () => {
    api.fetchProfile.mockResolvedValue(P)
    await useProfile.getState().load('u1')
    useProfile.getState().reset()
    expect(useProfile.getState()).toMatchObject({ status: 'idle', profile: null, userId: null, onboarding: false, suggestion: null })
    expect(localStorage.getItem('perf_profile_v1')).toBeNull()
  })
})
