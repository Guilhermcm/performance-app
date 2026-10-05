import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; user_metadata: Record<string, string> } },
  sessionError: null as unknown,
  select: { data: null as unknown, error: null as unknown, status: 200 },
  rpc: { data: null as unknown, error: null as unknown, status: 200 },
  signOut: vi.fn(async (_opts?: unknown): Promise<{ error: unknown }> => ({ error: null }))
}))

vi.mock('./supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: h.sessionError }),
      signOut: h.signOut
    },
    from: () => ({ select: () => ({ maybeSingle: async () => h.select }) }),
    rpc: async () => h.rpc
  }
}))

import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { backend, BackendError } from './backend'

const user = { id: 'u1', email: 'ana@x.dev', user_metadata: { full_name: 'Ana Souza' } }

beforeEach(() => {
  h.session = { user }
  h.sessionError = null
  h.select = { data: null, error: null, status: 200 }
  h.rpc = { data: null, error: null, status: 200 }
  h.signOut.mockClear()
})

describe('backend adapter', () => {
  it('answers /api/config without a session', async () => {
    h.session = null
    await expect(backend('/api/config')).resolves.toEqual({ invite_only: false, allow_guest: false, default_lang: 'pt-BR' })
  })

  it('maps the session to /api/me', async () => {
    await expect(backend('/api/me')).resolves.toEqual({ user: { id: 'u1', name: 'Ana Souza', admin: false } })
  })

  it('falls back to the e-mail for the name', async () => {
    h.session = { user: { ...user, user_metadata: {} } }
    await expect(backend('/api/me')).resolves.toMatchObject({ user: { name: 'ana' } })
  })

  it('answers 401 without a session', async () => {
    h.session = null
    await expect(backend('/api/me')).rejects.toMatchObject({ status: 401 })
    await expect(backend('/api/data')).rejects.toMatchObject({ status: 401 })
  })

  it('reports a token refresh that could not reach the server as offline, not signed out', async () => {
    // auth-js: an expired access token whose refresh failed on the network gives session null
    // plus an AuthRetryableFetchError (status 0).
    h.session = null
    h.sessionError = new AuthRetryableFetchError('Failed to fetch', 0)
    const e = await backend('/api/me').catch(x => x)
    expect(e).toBeInstanceOf(BackendError)
    expect(e.status).toBeUndefined()
  })

  it('reads the document and its revision', async () => {
    h.select = { data: { data: { routines: [], _rev: 4 }, rev: 4 }, error: null, status: 200 }
    await expect(backend('/api/data')).resolves.toEqual({ state: { routines: [], _rev: 4 }, rev: 4 })
  })

  it('reads an empty account as state null, rev 0', async () => {
    await expect(backend('/api/data')).resolves.toEqual({ state: null, rev: 0 })
    await expect(backend('/api/data/rev')).resolves.toEqual({ rev: 0 })
  })

  it('pushes and returns the new revision', async () => {
    h.rpc = { data: { ok: true, rev: 5, ts: 9 }, error: null, status: 200 }
    const r = await backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [] }, baseRev: 4 }) })
    expect(r).toEqual({ ok: true, ts: 9, rev: 5 })
  })

  it('turns a conflict into a 409 carrying the server copy', async () => {
    h.rpc = { data: { ok: false, error: 'conflict', rev: 6, state: { _rev: 6 } }, error: null, status: 200 }
    const e = await backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [] }, baseRev: 4 }) }).catch(x => x)
    expect(e).toBeInstanceOf(BackendError)
    expect(e.status).toBe(409)
    expect(e.data).toEqual({ state: { _rev: 6 }, rev: 6 })
  })

  it.each([
    [{ message: 'state_too_large', code: '54000' }, 413],
    [{ message: 'invalid_state', code: '22023' }, 400],
    [{ message: 'JWT expired', code: 'PGRST301' }, 401],
    [{ message: 'boom', code: 'XX000' }, 500]
  ])('maps %j to %i', async (error, status) => {
    h.rpc = { data: null, error, status: 400 }
    await expect(backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: { routines: [] } }) })).rejects.toMatchObject({ status })
  })

  it('reports a network failure with no status', async () => {
    // postgrest-js 2.117: a fetch that throws resolves to this shape (status 0, empty code).
    h.select = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0 }
    const e = await backend('/api/data').catch(x => x)
    expect(e.status).toBeUndefined()
    h.rpc = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0 }
    const p = await backend('/api/data', { method: 'PUT', body: JSON.stringify({ state: {} }) }).catch(x => x)
    expect(p.status).toBeUndefined()
  })

  it('signs out locally or everywhere', async () => {
    await backend('/api/logout', { method: 'POST', body: '{}' })
    await backend('/api/logout/all', { method: 'POST', body: '{}' })
    expect(h.signOut.mock.calls).toEqual([[{ scope: 'local' }], [{ scope: 'global' }]])
  })

  it('fails a sign-out everywhere the server did not confirm', async () => {
    h.signOut.mockResolvedValueOnce({ error: new AuthRetryableFetchError('Failed to fetch', 0) })
    await expect(backend('/api/logout/all', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: undefined })
  })

  it('swallows the routes that only fed the old server', async () => {
    await expect(backend('/api/activity', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    await expect(backend('/api/push/rest-timer', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
    await expect(backend('/api/push/rest-timer/cancel', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true })
  })

  it('answers 404 for anything else', async () => {
    await expect(backend('/api/admin/users')).rejects.toMatchObject({ status: 404 })
  })
})
