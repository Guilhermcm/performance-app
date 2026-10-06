// Target formulas (spec 3.2): Mifflin-St Jeor, activity factor, goal adjustment, macros, and a
// clamp to the ranges the database accepts. Pure; the client computes and the server only validates.
import type { Profile } from '@/features/profile/types'
import type { ActivityLevel, Macros, Pace } from './types'

export type TargetInput = {
  birth_date: string
  sex: 'male' | 'female' | 'other'
  height_cm: number
  weight_kg: number
  goal: 'hypertrophy' | 'strength' | 'fat_loss' | 'conditioning'
  activity_level: ActivityLevel
  pace: Pace
}

export const PAL: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const LIMITS = {
  kcal: [1000, 6000],
  protein_g: [20, 400],
  carbs_g: [0, 900],
  fat_g: [20, 300],
} as const

export const ADJUST: Record<TargetInput['goal'], Record<Pace, number>> = {
  fat_loss: { gentle: -0.1, standard: -0.2 },
  hypertrophy: { gentle: 0.05, standard: 0.1 },
  strength: { gentle: 0.05, standard: 0.05 },
  conditioning: { gentle: 0, standard: 0 },
}

const PROTEIN_PER_KG: Record<TargetInput['goal'], number> = {
  hypertrophy: 2.0,
  strength: 1.8,
  fat_loss: 2.2,
  conditioning: 1.6,
}

const FLOOR_KCAL = 1200
const FAT_SHARE = 0.25
const FAT_MIN_PER_KG = 0.6

const REQUIRED = ['birth_date', 'sex', 'height_cm', 'weight_kg', 'goal', 'activity_level'] as const

// Which inputs the profile still lacks. Pace always has a value (it defaults to standard).
export function missingTargetInput(p: Partial<Profile>): (keyof TargetInput)[] {
  return REQUIRED.filter(k => p[k] == null)
}

// Whole years on `today` (both YYYY-MM-DD): a birthday tomorrow still counts one year less.
function ageOn(birth: string, today: string): number {
  const [by, bm, bd] = birth.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = today.slice(0, 10).split('-').map(Number)
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}

export function bmr(i: TargetInput, today: string): number {
  const base = 10 * i.weight_kg + 6.25 * i.height_cm - 5 * ageOn(i.birth_date, today)
  if (i.sex === 'male') return base + 5
  if (i.sex === 'female') return base - 161
  return base - 78
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

// `adjust` is the final kcal (after the floor, the rounding and the clamp) minus the rounded tdee,
// so tdee + adjust is exactly the kcal returned.
export function computeTarget(i: TargetInput, today: string): Macros & { bmr: number; tdee: number; adjust: number } {
  const b = bmr(i, today)
  const tdee = b * PAL[i.activity_level]
  const wanted = Math.max(tdee * (1 + ADJUST[i.goal][i.pace]), b, FLOOR_KCAL)
  const rawKcal = Math.round(wanted / 10) * 10
  const rawProtein = Math.round(PROTEIN_PER_KG[i.goal] * i.weight_kg)
  const rawFat = Math.round(Math.max((rawKcal * FAT_SHARE) / 9, FAT_MIN_PER_KG * i.weight_kg))

  const kcal = clamp(rawKcal, LIMITS.kcal)
  const protein_g = clamp(rawProtein, LIMITS.protein_g)
  const fat_g = clamp(rawFat, LIMITS.fat_g)
  // The carbohydrate takes what is left, so a clamp on any other value flows into it.
  const carbs_g = clamp(Math.round((kcal - 4 * protein_g - 9 * fat_g) / 4), LIMITS.carbs_g)

  return { kcal, protein_g, carbs_g, fat_g, bmr: b, tdee: Math.round(tdee), adjust: kcal - Math.round(tdee) }
}

// How far 4P + 4C + 9G is from the kcal, as a fraction of the kcal.
export function macroGap(m: Macros): number {
  return Math.abs(4 * m.protein_g + 4 * m.carbs_g + 9 * m.fat_g - m.kcal) / m.kcal
}

// "Ajustar carboidrato": carbohydrate takes what the kcal leave after protein and fat.
export function fitCarbs(m: Macros): Macros {
  const carbs_g = clamp(Math.round((m.kcal - 4 * m.protein_g - 9 * m.fat_g) / 4), LIMITS.carbs_g)
  return { ...m, carbs_g }
}
