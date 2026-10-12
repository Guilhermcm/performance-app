import { t } from '../../lib/i18n.js'
import { BED_SLACK_MIN, classifyNight } from './classify'
import { fmtGap, signedDeviation } from './time'
import type { NightClass, SleepLog, SleepTarget } from './types'

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

// Plan decision 10: the night in a few words, after its length on the morning card. "on target";
// "logged" with no goal in force (not judged); otherwise "off target" with the reason, the bedtime
// first when it was more than 45 minutes off, else how far the night fell short of the goal.
export function nightSummary(
  log: Pick<SleepLog, 'bed_time' | 'duration_min' | 'quality'>,
  target: { goal_min: number; bed_target: string } | null,
): string {
  const cls = classifyNight(log, target)
  if (!target) return t('logged')
  if (cls.on_target) return t('on target')
  const why = (cls.bed_diff_min ?? 0) > BED_SLACK_MIN
    ? signedDeviation(log.bed_time, target.bed_target) > 0
      ? t('went to bed {0} after the target', fmtGap(cls.bed_diff_min!))
      : t('went to bed {0} before the target', fmtGap(cls.bed_diff_min!))
    : t('slept {0} under the goal', fmtGap(target.goal_min - log.duration_min))
  return t('off target: {0}', why)
}

// "Confirms on Friday": a whole sentence per weekday, since languages place the day differently
// ("confirma na sexta", "confirma no sábado"). The date is a local YYYY-MM-DD, read at noon so no
// zone can move it to another day.
const CONFIRMS_ON = [
  () => t('Confirms on Sunday'),
  () => t('Confirms on Monday'),
  () => t('Confirms on Tuesday'),
  () => t('Confirms on Wednesday'),
  () => t('Confirms on Thursday'),
  () => t('Confirms on Friday'),
  () => t('Confirms on Saturday'),
]
export const confirmsOn = (iso: string): string => CONFIRMS_ON[new Date(iso + 'T12:00:00').getDay()]()
