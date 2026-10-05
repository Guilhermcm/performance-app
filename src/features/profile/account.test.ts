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
    socialReset: log('social.reset')
  }
})
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }))
vi.mock('../../store/useStore.js', () => ({ useStore: { getState: () => ({ forgetAccount: h.forgetAccount }) } }))
vi.mock('../gamification/events', () => ({ clearEventQueue: h.clearEventQueue }))
vi.mock('../social/pending-invite', () => ({ clearPendingInvite: h.clearPendingInvite }))
vi.mock('./useProfile', () => ({ useProfile: { getState: () => ({ reset: h.profileReset }) } }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ reset: h.progressReset }) } }))
vi.mock('../social/useSocial', () => ({ useSocial: { getState: () => ({ reset: h.socialReset }) } }))

import { deleteMyAccount, DeleteAccountFailed } from './account'

beforeEach(() => {
  h.calls.length = 0
  Object.values(h).forEach(f => typeof f === 'function' && (f as any).mockClear())
})

describe('deleteMyAccount', () => {
  it('deletes on the server, then forgets the account on this device', async () => {
    h.rpc.mockResolvedValue({ data: null, error: null, status: 204 })
    await deleteMyAccount()
    expect(h.rpc).toHaveBeenCalledWith('delete_my_account')
    expect(h.calls).toEqual(['forgetAccount', 'clearEventQueue', 'clearPendingInvite', 'profile.reset', 'progress.reset', 'social.reset'])
  })

  it('touches nothing local when the server refuses', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' }, status: 500 })
    await expect(deleteMyAccount()).rejects.toMatchObject({ name: 'DeleteAccountFailed', code: 'failed' })
    expect(h.calls).toEqual([])
  })

  it('says when the request never reached the server', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 })
    const e = await deleteMyAccount().catch(x => x)
    expect(e).toBeInstanceOf(DeleteAccountFailed)
    expect(e.code).toBe('network')
    expect(h.calls).toEqual([])
  })
})
