import type { Goal } from '@/features/profile/types'
import type { SourceId } from './references'

// The three recommendation profiles of the plan analysis and the program catalog (spec §3).
export type AnalysisProfile = 'hypertrophy' | 'strength' | 'health'

// profiles.goal → profile. No goal reads as hypertrophy; the screens invite the person to set one.
export function profileOf(goal: Goal | null): AnalysisProfile {
  if (goal === 'strength') return 'strength'
  if (goal === 'fat_loss' || goal === 'conditioning') return 'health'
  return 'hypertrophy'
}

// Weekly fractional sets per muscle group, with the sources behind each range.
export const RANGES: Record<AnalysisProfile, { min: number; max: number; refs: SourceId[] }> = {
  hypertrophy: { min: 10, max: 20, refs: ['schoenfeld2017', 'pelland2025'] },
  strength: { min: 6, max: 12, refs: ['ralston2017', 'pelland2025'] },
  health: { min: 4, max: 10, refs: ['who2020', 'acsm2009'] },
}
