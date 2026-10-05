import type { Goal, Level } from './types'

export type StarterPlanId = 'full-body' | 'upper-lower' | 'ppl' | '5x5'

// The spec's table (§3.4): days per week picks the split; a strength goal on three days or fewer
// at beginner/intermediate level gets 5×5. Ids match lib/starter.js PLANS.
export function suggestStarterPlan({ days, level, goal }: { days: number; level: Level | null; goal: Goal | null }): StarterPlanId {
  const lvl = level ?? 'beginner'
  const g = goal ?? 'hypertrophy'
  if (days <= 3) return g === 'strength' && lvl !== 'advanced' ? '5x5' : 'full-body'
  if (days === 4) return 'upper-lower'
  return lvl === 'beginner' ? 'upper-lower' : 'ppl'
}
