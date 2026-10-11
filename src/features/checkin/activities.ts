import { t } from '../../lib/i18n.js'
import { CHECKIN_ACTIVITIES, type CheckinActivity } from './types'

// The activities of a check-in, in the order the chips show them (spec 2). Any of them counts the
// same for the week, the streak and the challenges.
export const ACTIVITIES: readonly CheckinActivity[] = CHECKIN_ACTIVITIES

export const ACTIVITY_LABEL: Record<CheckinActivity, () => string> = {
  strength: () => t('Strength training'),
  run: () => t('Running'),
  bike: () => t('Cycling'),
  swim: () => t('Swimming'),
  walk: () => t('Walking'),
  sport: () => t('Sport'),
  class: () => t('Class'),
  other: () => t('Other activity'),
}

export const activityLabel = (a: CheckinActivity): string => ACTIVITY_LABEL[a]()
