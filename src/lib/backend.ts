import { isAuthRetryableFetchError, type User } from '@supabase/supabase-js'
import { supabase } from './supabase'

// The inherited store speaks openGym's REST contract (/api/data, /api/me…). This module answers
// that contract from Supabase, keeping the shapes the store's sync and conflict code rely on:
// a 409 carries { state, rev }, a refused session is a 401, and a request that never got an
// answer has no status at all (useStore's isNetworkError).

export class BackendError extends Error {
  status?: number
  data: Record<string, unknown>
  code?: string
  constructor(message: string, status: number | undefined, data: Record<string, unknown> = {}, code?: string) {
    super(message)
    this.name = 'BackendError'
    this.status = status
    this.data = data
    this.code = code
  }
}

type Init = { method?: string; body?: string }
type PgError = { message?: string; code?: string } | null

const NOOP = new Set(['POST /api/activity', 'POST /api/push/rest-timer', 'POST /api/push/rest-timer/cancel'])

const STATUS_BY_MESSAGE: Record<string, number> = {
  not_signed_in: 401,
  state_too_large: 413,
  state_required: 400,
  invalid_state: 400
}

const networkError = (message: string) => new BackendError(message, undefined, {}, 'network')

// postgrest-js turns a fetch that threw (offline, DNS, CORS) into { error: { message:
// 'TypeError: …', code: '' }, status: 0 } instead of rejecting — no HTTP status and no code.
export function toBackendError(error: PgError, httpStatus: number): BackendError {
  const message = error?.message || 'request failed'
  if (!httpStatus && !error?.code) return networkError(message)
  const known = Object.keys(STATUS_BY_MESSAGE).find(k => message.includes(k))
  if (known) return new BackendError(known, STATUS_BY_MESSAGE[known], { error: known }, known)
  if (error?.code === 'PGRST301' || /jwt/i.test(message)) return new BackendError(message, 401, { error: 'not signed in' })
  return new BackendError(message, 500, { error: message }, error?.code)
}

export function displayName(user: User): string {
  const meta = user.user_metadata || {}
  return (meta.full_name || meta.name || (user.email || '').split('@')[0] || 'Atleta') as string
}

async function currentUser(): Promise<User> {
  const { data, error } = await supabase.auth.getSession()
  const user = data.session?.user
  if (user) return user
  // An expired access token whose refresh never reached the server: the session is not gone,
  // the network is. Reported as a 401 it would sign the user out of an offline boot.
  if (error && isAuthRetryableFetchError(error)) throw networkError(error.message)
  throw new BackendError('not signed in', 401, { error: 'not signed in' })
}

export async function backend(path: string, init: Init = {}): Promise<any> {
  const method = (init.method || 'GET').toUpperCase()
  const route = method + ' ' + path.split('?')[0]
  if (NOOP.has(route)) return { ok: true }

  switch (route) {
    case 'GET /api/config':
      return { invite_only: false, allow_guest: false, default_lang: 'pt-BR' }

    case 'GET /api/me': {
      const user = await currentUser()
      return { user: { id: user.id, name: displayName(user), admin: false } }
    }

    case 'GET /api/data': {
      await currentUser()
      const { data, error, status } = await supabase.from('app_state').select('data, rev').maybeSingle()
      if (error) throw toBackendError(error, status)
      return { state: (data?.data as Record<string, unknown> | undefined) ?? null, rev: data?.rev ?? 0 }
    }

    case 'GET /api/data/rev': {
      await currentUser()
      const { data, error, status } = await supabase.from('app_state').select('rev').maybeSingle()
      if (error) throw toBackendError(error, status)
      return { rev: data?.rev ?? 0 }
    }

    case 'PUT /api/data': {
      await currentUser()
      const body = JSON.parse(init.body || '{}') as { state?: unknown; baseRev?: number }
      const { data, error, status } = await supabase.rpc('push_state', {
        p_data: (body.state ?? null) as never,
        p_base_rev: body.baseRev ?? null
      })
      if (error) throw toBackendError(error, status)
      const r = data as { ok: boolean; rev: number; ts?: unknown; state?: unknown }
      if (!r.ok) throw new BackendError('conflict', 409, { state: r.state ?? null, rev: r.rev })
      return { ok: true, ts: r.ts ?? null, rev: r.rev }
    }

    case 'POST /api/logout':
      await supabase.auth.signOut({ scope: 'local' })
      return { ok: true }

    case 'POST /api/logout/all': {
      // A local sign-out always ends this device's session (auth-js drops it even when the call
      // fails). Signing out everywhere did not happen unless the server said so, and the store's
      // signOutAll must hear that before it wipes this device's copy.
      const { error } = await supabase.auth.signOut({ scope: 'global' })
      if (error) throw isAuthRetryableFetchError(error) ? networkError(error.message) : new BackendError(error.message, error.status || 500, { error: error.message })
      return { ok: true }
    }

    default:
      throw new BackendError('not available', 404, { error: 'not available' })
  }
}
