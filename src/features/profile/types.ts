import type { Database } from '@/lib/database.types'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Goal = NonNullable<Profile['goal']>
export type Level = NonNullable<Profile['level']>
export type Sex = NonNullable<Profile['sex']>
export type Unit = Profile['unit']
export type Locale = Profile['locale']

export type ProfileInput = Omit<Profile, 'id' | 'created_at' | 'updated_at'>

export const GOALS = ['hypertrophy', 'strength', 'fat_loss', 'conditioning'] as const satisfies readonly Goal[]
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const satisfies readonly Level[]
export const SEXES = ['male', 'female', 'other'] as const satisfies readonly Sex[]
