// The plan analysis as the Plan card and the analysis screen read it: the person's profile, the
// analysis of the current week, and what to offer when there is nothing to analyse yet.
import { useMemo } from 'react'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { analyzePlan, type PlanAnalysis, type PlanInput } from './analysis'
import { profileOf, type AnalysisProfile } from './goal'

// The analysis profile of the person: profiles.goal, read the way the Programs screen reads it.
export function useAnalysisProfile() {
  const goal = useProfile(s => s.profile?.goal ?? null)
  return { goal, profile: profileOf(goal) }
}

export function usePlanAnalysis(profile: AnalysisProfile) {
  const S = useStore((s: { S: PlanInput }) => s.S)
  return useMemo(() => analyzePlan(S, profile), [S, profile])
}

// 'ready' when the week has something to analyse. Otherwise 'unscheduled' when there are routines
// but no day of the week holds one (they go on the week schedule), or 'empty' (a program to start).
export type PlanStart = 'ready' | 'unscheduled' | 'empty'

export function planStart(S: PlanInput, analysis: Pick<PlanAnalysis, 'empty'>): PlanStart {
  if (!analysis.empty) return 'ready'
  const ids = new Set((S.routines ?? []).map(r => r.id))
  if (!ids.size) return 'empty'
  const scheduled = Object.values(S.week ?? {}).some(day => ([] as string[]).concat(day ?? []).some(id => ids.has(id)))
  return scheduled ? 'empty' : 'unscheduled'
}

export function usePlanStart(analysis: Pick<PlanAnalysis, 'empty'>): PlanStart {
  const S = useStore((s: { S: PlanInput }) => s.S)
  return planStart(S, analysis)
}
