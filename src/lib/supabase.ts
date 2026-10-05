import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// PKCE, not the implicit flow: the app routes with HashRouter, and the implicit flow returns the
// tokens in the hash, where they would collide with the routes.
export const supabase = createClient<Database>(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
})
