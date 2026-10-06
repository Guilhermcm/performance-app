import { useProfile } from '@/features/profile/useProfile'
import { refreshAutoTarget } from './auto-target'

export const LB_TO_KG = 0.45359237

// A weigh-in updates the profile weight and, with the pillar on and an automatic target in
// force, writes a recalculated target that starts tomorrow (spec 3.3, see refreshAutoTarget).
// Never throws: the weight sheet has already saved the weigh-in.
export async function onWeighIn(weight: number, unit: 'kg' | 'lb'): Promise<void> {
  const kg = Math.round((unit === 'lb' ? weight * LB_TO_KG : weight) * 10) / 10
  try {
    const profile = await useProfile.getState().save({ weight_kg: kg })
    await refreshAutoTarget(profile)
  } catch { /* offline or refused: the next weigh-in recalculates */ }
}
