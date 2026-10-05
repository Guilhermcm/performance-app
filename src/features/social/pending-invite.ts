// An invite opened before signing in has to survive the Google round trip, which comes back to
// origin + pathname and drops the hash route (features/auth/auth.ts). The code waits here for a
// day; PendingInviteHost picks it up once the profile is ready (Decision 2).

export const PENDING_KEY = 'perf_pending_invite_v1'
export const INVITE_CODE = /^[0-9A-Za-z]{10}$/
const TTL = 24 * 3600_000

export function inviteCodeFromPath(pathname: string): string | null {
  const m = /^\/convite\/([0-9A-Za-z]{10})\/?$/.exec(pathname)
  return m ? m[1] : null
}

export function inviteUrl(code: string, loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}#/convite/${code}`
}

export function savePendingInvite(code: string, now = Date.now()): void {
  if (!INVITE_CODE.test(code)) return
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ code, at: now })) } catch { /* storage blocked */ }
}

export function readPendingInvite(now = Date.now()): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null')
    if (v && typeof v.code === 'string' && INVITE_CODE.test(v.code) && typeof v.at === 'number' && now - v.at < TTL) return v.code
  } catch { /* garbage */ }
  return null
}

export function clearPendingInvite(): void {
  try { localStorage.removeItem(PENDING_KEY) } catch { /* ignore */ }
}
