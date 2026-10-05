import { supabase } from '@/lib/supabase'
import type { Profile, ProfileInput } from './types'

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Profile | null) ?? null
}

export async function createProfile(userId: string, input: Partial<ProfileInput>): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').insert({ id: userId, ...input } as never).select('*').single()
  if (error) throw new Error(error.message)
  return data as Profile
}

export async function updateProfile(userId: string, patch: Partial<ProfileInput>): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').update(patch as never).eq('id', userId).select('*').single()
  if (error) throw new Error(error.message)
  return data as Profile
}

// The messages are returned untranslated and shown through t(errors[field]); these calls register
// them with scripts/check-source-strings.mjs, which only collects literal calls:
// t('Enter a name up to 60 characters.') t('Height must be between 50 and 260 cm.')
// t('Weight must be between 20 and 400 kg.') t('Choose between 1 and 7 days.') t('Enter a valid birth date.')

// Field → English message (shown through t()). Mirrors the table's check constraints so the
// form says what is wrong before the server refuses it.
export function validateProfileInput(input: Partial<ProfileInput>): Record<string, string> {
  const errors: Record<string, string> = {}
  if ('display_name' in input) {
    const n = (input.display_name ?? '').trim()
    if (n.length < 1 || n.length > 60) errors.display_name = 'Enter a name up to 60 characters.'
  }
  if (input.height_cm != null && (input.height_cm < 50 || input.height_cm > 260)) errors.height_cm = 'Height must be between 50 and 260 cm.'
  if (input.weight_kg != null && (input.weight_kg < 20 || input.weight_kg > 400)) errors.weight_kg = 'Weight must be between 20 and 400 kg.'
  if (input.days_per_week != null && (input.days_per_week < 1 || input.days_per_week > 7)) errors.days_per_week = 'Choose between 1 and 7 days.'
  if (input.birth_date) {
    const d = new Date(input.birth_date + 'T00:00:00')
    if (Number.isNaN(d.getTime()) || d > new Date()) errors.birth_date = 'Enter a valid birth date.'
  }
  return errors
}
