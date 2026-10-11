import { supabase } from '@/lib/supabase'
import type { Progress } from './types'

// The check-in cutover (spec 5.1): the day from which live workouts, PRs and weigh-ins pay no XP.
// A server from before check-ins has no such table (null: the old rules); the table without the
// setting means every day, as training_checkin_since() reads it on the server.
async function trainingSince(): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'training_checkin_since').maybeSingle()
    if (error) return null
    if (!data) return '0001-01-01'
    const v = (data as { value: unknown }).value
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  } catch { return null }
}

export async function fetchProgress(): Promise<Progress> {
  const [{ data, error }, since] = await Promise.all([supabase.rpc('get_my_progress'), trainingSince()])
  if (error) throw new Error(error.message)
  const p = data as unknown as Progress | null
  if (!p || typeof p.total_xp !== 'number' || !p.level || !p.week) throw new Error('bad_progress')
  return { ...p, training_since: since }
}
