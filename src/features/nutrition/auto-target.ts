import type { Profile } from '../profile/types'
import { computeTarget, missingTargetInput } from './targets'
import { shiftDay, todayIn } from './days'
import { useNutrition } from './useNutrition'

// After a change to what the target is based on (a weigh-in, or the goal, height, birth date, sex,
// weight, activity or pace in the profile): with the pillar on and an automatic target in force,
// writes the recalculated target from tomorrow in the profile's time zone (spec 3.3). A manual
// target is the person's choice and stays. Returns whether a target was written; never throws,
// since the profile is already saved and the next change recalculates.
export async function refreshAutoTarget(profile: Profile): Promise<boolean> {
  try {
    if (!profile.nutrition_enabled) return false
    const today = todayIn(profile.timezone)
    const tomorrow = shiftDay(today, 1)
    const nutrition = useNutrition.getState()
    // What will apply tomorrow: a manual target set ahead of time counts as in force.
    const ahead = nutrition.targetOn(tomorrow)
    if (ahead?.mode !== 'auto') return false
    if (missingTargetInput(profile).length) return false
    const t = computeTarget({
      birth_date: profile.birth_date!, sex: profile.sex!, height_cm: profile.height_cm!, weight_kg: profile.weight_kg!,
      goal: profile.goal!, activity_level: profile.activity_level!, pace: profile.nutrition_pace
    }, today)
    const next = { kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, mode: 'auto' as const }
    if (next.kcal === ahead.kcal && next.protein_g === ahead.protein_g && next.carbs_g === ahead.carbs_g && next.fat_g === ahead.fat_g) return false
    await nutrition.setTarget(next, tomorrow)
    return true
  } catch {
    return false
  }
}
