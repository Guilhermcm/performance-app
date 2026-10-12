import type { Goal, Level } from '@/features/profile/types'
import { profileOf } from './goal'
import type { ProgramId } from './programs'

// Spec §4.3: the profile from the goal, the days per week from the profile, and the level
// (none reads as beginner) pick a program and, for PPL, its 3-day or 6-day variant.
export function suggestProgram({ goal, level, days }: { goal: Goal | null; level: Level | null; days: number }): { id: ProgramId; variant: number } {
  const beginner = (level ?? 'beginner') === 'beginner'
  const pick = (id: ProgramId, variant = 0) => ({ id, variant })
  switch (profileOf(goal)) {
    case 'health':
      if (days <= 2) return pick('short-2x')
      return pick(beginner ? 'health-3x' : 'full-body-beginner')
    case 'strength':
      return pick(days <= 3 || beginner ? 'strength-5x5' : 'power-hypertrophy')
    case 'hypertrophy':
      if (days <= 3) return beginner ? pick('full-body-beginner') : pick('ppl', 0)
      if (days <= 5 || beginner) return pick('upper-lower')
      return pick('ppl', 1)
  }
}
