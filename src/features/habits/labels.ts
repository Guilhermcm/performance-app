import { t, tn } from '../../lib/i18n.js'

// A habit's N in words: "Every day" for 7, "3 times a week" otherwise.
export const perWeekLabel = (n: number): string =>
  n >= 7 ? t('Every day') : n === 1 ? t('Once a week') : tn(n, '{0} times a week', n)

// A habit's checks this week against its target: "2 of 3 this week".
export const weekCountLabel = (done: number, target: number): string => t('{0} of {1} this week', done, target)

// The accessible name of each icon key (plan decision 16). Functions, so each t() stays a literal
// the source-string check can see.
const ICON_LABEL: Record<string, () => string> = {
  check: () => t('Check mark'),
  book: () => t('Book'),
  dumbbell: () => t('Dumbbell'),
  footprints: () => t('Footsteps'),
  bike: () => t('Bicycle'),
  droplet: () => t('Water drop'),
  pill: () => t('Pill'),
  apple: () => t('Apple'),
  salad: () => t('Salad'),
  coffee: () => t('Coffee'),
  bed: () => t('Bed'),
  sun: () => t('Sunlight'),
  moon: () => t('Moon'),
  brain: () => t('Brain'),
  heart: () => t('Heart'),
  smile: () => t('Smile'),
  music: () => t('Music'),
  pen: () => t('Pen'),
  languages: () => t('Languages'),
  code: () => t('Programming'),
  'piggy-bank': () => t('Piggy bank'),
  leaf: () => t('Leaf'),
  dog: () => t('Dog'),
  'phone-off': () => t('Phone off'),
}

// A key from another app version is named like the icon it shows (iconFor falls back to check).
export const iconLabel = (key: string): string => (Object.hasOwn(ICON_LABEL, key) ? ICON_LABEL[key] : ICON_LABEL.check)()
