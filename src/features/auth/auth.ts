import { supabase } from '@/lib/supabase'

const OAUTH_PARAMS = ['code', 'error', 'error_description', 'error_code']

export async function signInWithGoogle(loc: Location = window.location): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: loc.origin + loc.pathname }
  })
  if (error) throw new Error(error.message)
}

// After the redirect back, supabase-js has already exchanged ?code= for a session; the query is
// left in the address bar, where a reload or a shared link would carry it. The hash is the route.
export function cleanAuthParams(loc: Location = window.location, hist: History = window.history): void {
  const params = new URLSearchParams(loc.search)
  if (!OAUTH_PARAMS.some(p => params.has(p))) return
  OAUTH_PARAMS.forEach(p => params.delete(p))
  const q = params.toString()
  hist.replaceState(null, '', loc.pathname + (q ? '?' + q : '') + loc.hash)
}
