import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), setting: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import { fetchProgress } from './progress-api'
import { progressOf } from './test-progress'

// supabase.from('app_settings').select('value').eq('key', ...).maybeSingle()
const chain = () => ({ select: () => ({ eq: (_k: string, v: string) => ({ maybeSingle: () => h.setting(v) }) }) })

beforeEach(() => {
  h.rpc.mockReset()
  h.setting.mockReset().mockResolvedValue({ data: { value: '2026-10-06' }, error: null })
  h.from.mockReset().mockImplementation(chain)
})

describe('fetchProgress', () => {
  it('returns the RPC answer', async () => {
    const p = progressOf(400)
    h.rpc.mockResolvedValue({ data: p, error: null })
    await expect(fetchProgress()).resolves.toEqual({ ...p, training_since: '2026-10-06' })
    expect(h.rpc).toHaveBeenCalledWith('get_my_progress')
    expect(h.from).toHaveBeenCalledWith('app_settings')
    expect(h.setting).toHaveBeenCalledWith('training_checkin_since')
  })

  it('reads the check-in cutover, null when the server has none to give', async () => {
    h.rpc.mockResolvedValue({ data: progressOf(400), error: null })
    // A server from before check-ins has no app_settings table: the old rules.
    h.setting.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } })
    expect((await fetchProgress()).training_since).toBeNull()
    h.setting.mockRejectedValue(new Error('offline'))
    expect((await fetchProgress()).training_since).toBeNull()
    // The table without the setting: every day is a check-in day, as training_checkin_since() says.
    h.setting.mockResolvedValue({ data: null, error: null })
    expect((await fetchProgress()).training_since).toBe('0001-01-01')
  })

  it('throws the RPC error', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'no_profile' } })
    await expect(fetchProgress()).rejects.toThrow('no_profile')
  })

  it('refuses an answer without the expected shape', async () => {
    h.rpc.mockResolvedValue({ data: { hello: 1 }, error: null })
    await expect(fetchProgress()).rejects.toThrow('bad_progress')
  })
})
