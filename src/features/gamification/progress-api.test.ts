import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }))

import { fetchProgress } from './progress-api'
import { progressOf } from './test-progress'

beforeEach(() => h.rpc.mockReset())

describe('fetchProgress', () => {
  it('returns the RPC answer', async () => {
    const p = progressOf(400)
    h.rpc.mockResolvedValue({ data: p, error: null })
    await expect(fetchProgress()).resolves.toEqual(p)
    expect(h.rpc).toHaveBeenCalledWith('get_my_progress')
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
