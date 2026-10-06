import { useProfile } from '@/features/profile/useProfile'
import { computeTarget, missingTargetInput } from './targets'
import { shiftDay, todayIn } from './days'
import { useNutrition } from './useNutrition'

const LB_TO_KG = 0.45359237

// A weigh-in updates the profile weight and, with the pillar on and an automatic target in
// force, writes a recalculated target that starts tomorrow (spec 3.3). A manual target is the
// person's choice and stays. Never throws: the weight sheet has already saved the weigh-in.
export async function onWeighIn(weight: number, unit: 'kg' | 'lb'): Promise<void> {
  const kg = Math.round((unit === 'lb' ? weight * LB_TO_KG : weight) * 10) / 10
  try {
    const profile = await useProfile.getState().save({ weight_kg: kg })
    if (!profile.nutrition_enabled) return
    const today = todayIn(profile.timezone)
    const tomorrow = shiftDay(today, 1)
    const nutrition = useNutrition.getState()
    // What will apply tomorrow: a manual target set ahead of time counts as in force.
    if (nutrition.targetOn(tomorrow)?.mode !== 'auto') return
    if (missingTargetInput(profile).length) return
    const t = computeTarget({
      birth_date: profile.birth_date!, sex: profile.sex!, height_cm: profile.height_cm!, weight_kg: kg,
      goal: profile.goal!, activity_level: profile.activity_level!, pace: profile.nutrition_pace
    }, today)
    await nutrition.setTarget({ kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, mode: 'auto' }, tomorrow)
  } catch { /* offline or refused: the next weigh-in recalculates */ }
}
