import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const calls: string[] = []
  const log = (name: string) => vi.fn(async () => { calls.push(name) })
  return {
    calls,
    rpc: vi.fn(),
    forgetAccount: log('forgetAccount'),
    clearEventQueue: log('clearEventQueue'),
    clearPendingInvite: log('clearPendingInvite'),
    profileReset: log('profile.reset'),
    progressReset: log('progress.reset'),
    socialReset: log('social.reset'),
    removeAllPhotos: vi.fn(async (_u: string) => { calls.push('removeAllPhotos') }),
    clearCheckinOutbox: vi.fn(async (_u: string) => { calls.push('clearCheckinOutbox') }),
    checkinsReset: log('checkins.reset'),
    clearSignedUrls: log('clearSignedUrls'),
    session: { user: { id: 'u1' } } as { user: { id: string } } | null
  }
})
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, auth: { getSession: async () => ({ data: { session: h.session } }) } } }))
vi.mock('../checkin/checkin-api', () => ({ removeAllPhotos: h.removeAllPhotos, clearSignedUrls: h.clearSignedUrls }))
vi.mock('../checkin/outbox', () => ({ clearCheckinOutbox: h.clearCheckinOutbox }))
vi.mock('../checkin/useCheckins', () => ({ useCheckins: { getState: () => ({ reset: h.checkinsReset }) } }))
vi.mock('../../store/useStore.js', () => ({ useStore: { getState: () => ({ forgetAccount: h.forgetAccount }) } }))
vi.mock('../gamification/events', () => ({ clearEventQueue: h.clearEventQueue }))
vi.mock('../social/pending-invite', () => ({ clearPendingInvite: h.clearPendingInvite }))
vi.mock('./useProfile', () => ({ useProfile: { getState: () => ({ reset: h.profileReset }) } }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ reset: h.progressReset }) } }))
vi.mock('../social/useSocial', () => ({ useSocial: { getState: () => ({ reset: h.socialReset }) } }))

import { deleteMyAccount, DeleteAccountFailed } from './account'

beforeEach(() => {
  h.calls.length = 0
  h.session = { user: { id: 'u1' } }
  Object.values(h).forEach(f => typeof f === 'function' && (f as any).mockClear())
  h.removeAllPhotos.mockImplementation(async () => { h.calls.push('removeAllPhotos') })
  h.rpc.mockImplementation(async () => { h.calls.push('rpc'); return { data: null, error: null, status: 204 } })
})
const rpcAnswers = (answer: { data: null; error: unknown; status: number }) =>
  h.rpc.mockImplementation(async () => { h.calls.push('rpc'); return answer })

describe('deleteMyAccount', () => {
  it('removes the photo folder, deletes on the server, then forgets the account on this device', async () => {
    await deleteMyAccount()
    expect(h.removeAllPhotos).toHaveBeenCalledWith('u1')
    expect(h.rpc).toHaveBeenCalledWith('delete_my_account')
    expect(h.calls).toEqual([
      'removeAllPhotos', 'rpc',
      'forgetAccount', 'clearEventQueue', 'clearPendingInvite', 'profile.reset', 'progress.reset', 'social.reset',
      'clearCheckinOutbox', 'checkins.reset', 'clearSignedUrls'
    ])
    expect(h.clearCheckinOutbox).toHaveBeenCalledWith('u1')
  })

  it('still deletes the account when the photos cannot be removed', async () => {
    h.removeAllPhotos.mockImplementation(async () => { h.calls.push('removeAllPhotos'); throw new Error('Failed to fetch') })
    await deleteMyAccount()
    expect(h.calls.slice(0, 3)).toEqual(['removeAllPhotos', 'rpc', 'forgetAccount'])
  })

  it('touches nothing local when the server refuses', async () => {
    rpcAnswers({ data: null, error: { message: 'boom', code: 'XX000' }, status: 500 })
    await expect(deleteMyAccount()).rejects.toMatchObject({ name: 'DeleteAccountFailed', code: 'failed' })
    expect(h.calls).toEqual(['removeAllPhotos', 'rpc'])
  })

  it('says when the request never reached the server', async () => {
    rpcAnswers({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 })
    const e = await deleteMyAccount().catch(x => x)
    expect(e).toBeInstanceOf(DeleteAccountFailed)
    expect(e.code).toBe('network')
    expect(h.calls).toEqual(['removeAllPhotos', 'rpc'])
  })
})
