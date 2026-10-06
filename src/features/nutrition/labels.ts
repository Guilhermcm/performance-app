import { dateLocale, t } from '../../lib/i18n.js'
import type { ActivityLevel, Meal } from './types'

// Meals in the order of the day, as the screen lists them.
export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_LABEL: Record<Meal, () => string> = {
  breakfast: () => t('Breakfast'),
  lunch: () => t('Lunch'),
  dinner: () => t('Dinner'),
  snack: () => t('Snacks'),
}

// Spec 3.2: the day outside the gym; workouts are already in the factor.
export const ACTIVITY_LABEL: Record<ActivityLevel, { name: () => string; detail: () => string }> = {
  sedentary: { name: () => t('Sedentary'), detail: () => t('Desk job, little movement outside training') },
  light: { name: () => t('Lightly active'), detail: () => t('You walk a little during the day') },
  moderate: { name: () => t('Moderately active'), detail: () => t('On your feet most of the day or walking a lot') },
  active: { name: () => t('Active'), detail: () => t('Physical work or lots of movement') },
  very_active: { name: () => t('Very active'), detail: () => t('Heavy physical work or two workouts a day') },
}

const num = (n: number, digits: number) => n.toLocaleString(dateLocale(), { maximumFractionDigits: digits })

// Whole kcal; the unit is the same in every language.
export const fmtKcal = (n: number): string => `${num(Math.round(n), 0)} kcal`
export const fmtNumber = (n: number): string => num(Math.round(n), 0)
// Grams with at most one decimal, as the diary stores them.
export const fmtGrams = (n: number): string => `${num(Math.round(n * 10) / 10, 1)} g`
export const fmtDecimal = (n: number): string => num(Math.round(n * 10) / 10, 1)

const WEEKDAYS = [
  () => t('Sunday'), () => t('Monday'), () => t('Tuesday'), () => t('Wednesday'),
  () => t('Thursday'), () => t('Friday'), () => t('Saturday'),
]

// The weekday of a calendar day (YYYY-MM-DD), read at noon so no time zone moves it.
export const weekdayName = (iso: string): string => WEEKDAYS[new Date(iso + 'T12:00:00').getDay()]()
