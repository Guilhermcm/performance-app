import { Apple, Dumbbell, Target, Weight, type LucideIcon } from 'lucide-react'
import { t, tn } from '../../lib/i18n.js'
import { fmtDecimal } from './format'
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
    case 'not_signed_in':
    case 'no_profile': return t('Sign in again to continue.')
    default: return t('Could not reach the server. Check your connection and try again.')
  }
}

// Functions, so each t() stays a literal scripts/check-source-strings.mjs can see and the text
// follows the language picked at render time.
export const TEMPLATE_TEXT: Record<ChallengeTemplate, { name: () => string; rule: () => string; icon: LucideIcon }> = {
  workouts_count: { name: () => t('Workouts in the period'), rule: () => t('Every workout finished in the period counts.'), icon: Dumbbell },
  weeks_on_target: { name: () => t('Weeks on target'), rule: () => t('Weeks in the period in which each person meets their own weekly goal.'), icon: Target },
  volume_total: { name: () => t('Total volume'), rule: () => t('Weight lifted in the period, in tonnes. Only people who agree share their volume.'), icon: Weight },
  nutrition_days_on_target: {
    name: () => t('Days on nutrition target'),
    rule: () => t('Days in the period that each person hits their nutrition target. Others only see how many, never what you ate.'),
    icon: Apple
  }
}

export const MODE_TEXT: Record<ChallengeMode, { name: () => string; detail: () => string }> = {
  team: { name: () => t('Team'), detail: () => t('Everyone adds up toward one goal.') },
  solo: { name: () => t('Solo'), detail: () => t('Each person has to reach the goal.') }
}

// "1 workout", "12 workouts", "3 weeks", "12.5 t", "21 days on target".
export function amountText(template: ChallengeTemplate, n: number): string {
  if (template === 'workouts_count') return n === 1 ? t('1 workout') : tn(n, '{0} workouts', n)
  if (template === 'weeks_on_target') return n === 1 ? t('1 week') : tn(n, '{0} weeks', n)
  if (template === 'nutrition_days_on_target') return n === 1 ? t('1 day on target') : tn(n, '{0} days on target', n)
  return t('{0} t', fmtDecimal(n))
}

// The name a new challenge gets until the person writes their own.
export function autoTitle(template: ChallengeTemplate, target: number, days: number): string {
  if (template === 'workouts_count') return t('{0} workouts in {1} days', target, days)
  if (template === 'weeks_on_target') return t('{0} weeks on target', target)
  if (template === 'nutrition_days_on_target') return t('{0} days on target in {1} days', target, days)
  return t('{0} t in {1} days', fmtDecimal(target), days)
}

// The nutrition opt-in, the same words when creating and when joining (spec 5).
export const nutritionOptInText = () => ({
  label: t('Show participants how many days I was on target'),
  detail: t('They see only that number, never your meals, calories or targets.')
})
