import { t } from '../../lib/i18n.js'
import type { NightClass, SleepTarget } from './types'

// Plan decision 14: the five quality levels a person can give a night, as words.
export const QUALITY_LABEL: Record<1 | 2 | 3 | 4 | 5, () => string> = {
  1: () => t('Terrible'),
  2: () => t('Poor'),
  3: () => t('Okay'),
  4: () => t('Good'),
  5: () => t('Great'),
}

// What a night reached, in words (never by colour alone). A night with no goal in force is only
// recorded: it is not judged. `on` is for the one state that earned something.
export function nightStatus(cls: NightClass | null, target: SleepTarget | null): { text: string; on: boolean } {
  if (!cls || !cls.logged) return { text: t('Not logged'), on: false }
  if (!target) return { text: t('Logged'), on: false }
  return cls.on_target ? { text: t('On target'), on: true } : { text: t('Off target'), on: false }
}
