import { supabase } from '@/lib/supabase'
import type { Progress } from './types'

export async function fetchProgress(): Promise<Progress> {
  const { data, error } = await supabase.rpc('get_my_progress')
  if (error) throw new Error(error.message)
  const p = data as unknown as Progress | null
  if (!p || typeof p.total_xp !== 'number' || !p.level || !p.week) throw new Error('bad_progress')
  return p
}
