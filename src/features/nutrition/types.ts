import type { Goal, Sex } from '@/features/profile/types'

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type Source = 'taco' | 'off' | 'custom' | 'quick' | 'import'
export type Macros = { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export type DayTotals = Macros & { meals: number }
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
export type Pace = 'gentle' | 'standard'
export type TargetGoal = Goal
export type TargetSex = Sex

export type FoodLog = Macros & {
  id: string
  day: string
  meal: Meal
  name: string
  brand: string | null
  source: Source
  source_id: string | null
  grams: number | null
  fiber_g: number | null
  updated_at: string
}

export type Per100 = { kcal: number; protein: number; carbs: number; fat: number; fiber?: number | null }

export type FoodItem = {
  source: 'taco' | 'off' | 'custom'
  source_id: string | null
  name: string
  brand: string | null
  per100: Per100
  serving_g: number | null
  serving_label: string | null
  barcode: string | null
  // From recents(): serving_g is the amount logged last time, not the label serving.
  recent?: boolean
}

export type UserFood = FoodItem & { id: string; favorite: boolean; updated_at: string }

// A personal household measure ("concha" = 120 g) of one food; `food_key` is built by foodKey().
export type Measure = { id: string; food_key: string; label: string; grams: number; updated_at: string }

// One chip of the portion row. 'serving' is the label serving of the food, 'last' the amount logged
// last time; for those the label is the serving's own text or the amount in grams.
export type MeasureOption = { label: string; grams: number; kind: 'personal' | 'suggested' | 'serving' | 'last'; id?: string }

export type NutritionTarget = Macros & { valid_from: string; mode: 'auto' | 'manual' }

export type DayClass = { logged: boolean; on_target: boolean; balanced: boolean }

export type NutritionDay = DayTotals & {
  day: string
  target: Macros | null
  logged: boolean
  on_target: boolean
  balanced: boolean
  imported: boolean
  // XP the day's events paid, the weekly goal bonus included (absent from an older server).
  xp?: number
}

export type NutritionWeek = { start: string; target: number; on_target: number; target_hit: boolean }

export type NutritionHistory = { target: NutritionTarget | null; days: NutritionDay[]; weeks: NutritionWeek[] }
