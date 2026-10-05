import { describe, it, expect, vi, beforeEach } from 'vitest'

const { signInWithOAuth } = vi.hoisted(() => ({ signInWithOAuth: vi.fn(async () => ({ error: null })) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth } }, supabaseConfigured: true }))

import { signInWithGoogle, cleanAuthParams } from './auth'

beforeEach(() => signInWithOAuth.mockClear())

describe('signInWithGoogle', () => {
  it('starts the Google flow back to this page', async () => {
    await signInWithGoogle({ origin: 'https://perf.app', pathname: '/' } as Location)
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://perf.app/' } })
  })

  it('throws what Supabase reports', async () => {
    signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider disabled' } } as never)
    await expect(signInWithGoogle({ origin: 'https://perf.app', pathname: '/' } as Location)).rejects.toThrow('provider disabled')
  })
})

describe('cleanAuthParams', () => {
  it('drops the OAuth query and keeps the route', () => {
    const replaceState = vi.fn()
    cleanAuthParams({ search: '?code=abc&x=1', pathname: '/', hash: '#/home' } as Location, { replaceState } as unknown as History)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?x=1#/home')
  })

  it('does nothing without OAuth params', () => {
    const replaceState = vi.fn()
    cleanAuthParams({ search: '', pathname: '/', hash: '#/home' } as Location, { replaceState } as unknown as History)
    expect(replaceState).not.toHaveBeenCalled()
  })
})
