import { Apple, Dumbbell, Moon, Target, Weight, type LucideIcon } from 'lucide-react'
import { t, tn } from '../../lib/i18n.js'
import { fmtDecimal } from './format'
import { isTrainingDays } from './templates'
import type { ChallengeMode, ChallengeTemplate, SocialErrorCode } from './types'

// Every typed error of the social RPCs (Decision 4) as a sentence a person can act on.
export function socialErrorText(code: SocialErrorCode): string {
  switch (code) {
    case 'invite_not_found': return t('This invite link does not work. Check that it was copied in full.')
    case 'invite_expired': return t('This invite has expired. Ask for a new link.')
    case 'invite_used': return t('Someone already used this invite. Ask for a new link.')
    case 'self_invite': return t('This is your own invite. Send it to a friend.')
    case 'already_friends': return t('You are already friends.')
    case 'invite_limit': return t('You have 5 open invites. Cancel one or wait for one to expire.')
    case 'not_friends': return t('You can only invite friends to a challenge.')
    case 'invalid_challenge': return t('Check the challenge settings and try again.')
    case 'challenge_limit': return t('You already have 10 challenges in progress.')
    case 'challenge_not_found': return t('This challenge is no longer available.')
    case 'challenge_closed': return t('This challenge has already ended.')
    case 'volume_opt_in_required': return t('To join, agree to share your volume.')
    case 'nutrition_opt_in_required': return t('To take part, agree to show how many days you were on target.')
    case 'nutrition_off': return t('Turn on the Nutrition pillar to take part in this challenge.')
    case 'sleep_opt_in_required': return t('To take part, agree to show how many nights you were on target.')
    case 'sleep_off': return t('Turn on the Sleep pillar to take part in this challenge.')
    case 'not_found': return t('This post is no longer available.')
    case 'invalid_emoji': return t('This emoji doesn’t work here. Try another one.')
    case 'invalid_comment': return t('A comment goes from 1 to 500 characters.')
    case 'too_many_reactions': return t('You already left 10 reactions here. Remove one to add another.')
    case 'not_signed_in':
    case 'no_profile': return t('Sign in again to continue.')
    default: return t('Could not reach the server. Check your connection and try again.')
  }
}

// Functions, so each t() stays a literal scripts/check-source-strings.mjs can see and the text
// follows the language picked at render time.
const TRAINING_DAYS = { name: () => t('Training days'), rule: () => t('Days with a check-in in the period. Several on the same day count as one.'), icon: Dumbbell }
export const TEMPLATE_TEXT: Record<ChallengeTemplate, { name: () => string; rule: () => string; icon: LucideIcon }> = {
  checkin_days: TRAINING_DAYS,
  // Made before the check-ins and counting the same days now, so it reads the same.
  workouts_count: TRAINING_DAYS,
  weeks_on_target: { name: () => t('Weeks on target'), rule: () => t('Weeks in the period in which each person meets their own weekly goal.'), icon: Target },
  volume_total: { name: () => t('Total volume'), rule: () => t('Weight lifted in the period, in tonnes. Only people who agree share their volume.'), icon: Weight },
  nutrition_days_on_target: {
    name: () => t('Days on nutrition target'),
    rule: () => t('Days in the period that each person hits their nutrition target. Others only see how many, never what you ate.'),
    icon: Apple
  },
  sleep_nights_on_target: {
    name: () => t('Nights on sleep target'),
    rule: () => t('Nights in the period that each person hits their sleep target. Others only see how many, never your times, how long you slept, its quality or your notes.'),
    icon: Moon
  }
}

export const MODE_TEXT: Record<ChallengeMode, { name: () => string; detail: () => string }> = {
  team: { name: () => t('Team'), detail: () => t('Everyone adds up toward one goal.') },
  solo: { name: () => t('Solo'), detail: () => t('Each person has to reach the goal.') }
}

// "1 training day", "12 training days", "3 weeks", "12.5 t", "21 days on target", "21 nights on target".
export function amountText(template: ChallengeTemplate, n: number): string {
  if (isTrainingDays(template)) return n === 1 ? t('1 training day') : tn(n, '{0} training days', n)
  if (template === 'weeks_on_target') return n === 1 ? t('1 week') : tn(n, '{0} weeks', n)
  if (template === 'nutrition_days_on_target') return n === 1 ? t('1 day on target') : tn(n, '{0} days on target', n)
  if (template === 'sleep_nights_on_target') return n === 1 ? t('1 night on target') : tn(n, '{0} nights on target', n)
  return t('{0} t', fmtDecimal(n))
}

// The name a new challenge gets until the person writes their own.
export function autoTitle(template: ChallengeTemplate, target: number, days: number): string {
  if (isTrainingDays(template)) return t('{0} training days in {1} days', target, days)
  if (template === 'weeks_on_target') return t('{0} weeks on target', target)
  if (template === 'nutrition_days_on_target') {
    return target === 1 ? t('1 day on target in {0} days', days) : t('{0} days on target in {1} days', target, days)
  }
  if (template === 'sleep_nights_on_target') {
    return target === 1 ? t('1 night on target in {0} days', days) : tn(target, '{0} nights on target in {1} days', target, days)
  }
  return t('{0} t in {1} days', fmtDecimal(target), days)
}

// The nutrition opt-in, the same words when creating and when joining (spec 5).
export const nutritionOptInText = () => ({
  label: t('Show participants how many days I was on target'),
  detail: t('They see only that number, never your meals, calories or targets.')
})

// The sleep opt-in, the same words when creating and when joining (sleep spec 6.6): only the count of
// nights on target leaves the account.
export const sleepOptInText = () => ({
  label: t('Show participants how many nights I was on target'),
  detail: t('They see only that number, never your times, how long you slept, its quality or your notes.')
})
