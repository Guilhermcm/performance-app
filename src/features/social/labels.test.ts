import { describe, it, expect } from 'vitest'
import { amountText, autoTitle, socialErrorText, MODE_TEXT, TEMPLATE_TEXT } from './labels'
import type { SocialErrorCode } from './types'

const CODES: SocialErrorCode[] = [
  'not_signed_in', 'no_profile', 'invite_not_found', 'invite_expired', 'invite_used', 'self_invite',
  'already_friends', 'invite_limit', 'not_friends', 'invalid_challenge', 'challenge_limit',
  'challenge_not_found', 'challenge_closed', 'volume_opt_in_required', 'nutrition_opt_in_required',
  'nutrition_off', 'sleep_opt_in_required', 'sleep_off', 'network'
]

describe('social labels', () => {
  it('has a human message for every error code', () => {
    for (const code of CODES) expect(socialErrorText(code).trim(), code).not.toBe('')
    expect(socialErrorText('invite_expired')).toBe('This invite has expired. Ask for a new link.')
    expect(socialErrorText('network')).toBe('Could not reach the server. Check your connection and try again.')
    expect(socialErrorText('nutrition_opt_in_required')).toBe('To take part, agree to show how many days you were on target.')
    expect(socialErrorText('nutrition_off')).toBe('Turn on the Nutrition pillar to take part in this challenge.')
    expect(socialErrorText('sleep_opt_in_required')).toBe('To take part, agree to show how many nights you were on target.')
    expect(socialErrorText('sleep_off')).toBe('Turn on the Sleep pillar to take part in this challenge.')
  })

  it('names templates and modes', () => {
    expect(TEMPLATE_TEXT.volume_total.name()).toBe('Total volume')
    expect(MODE_TEXT.solo.name()).toBe('Solo')
    expect(TEMPLATE_TEXT.nutrition_days_on_target.name()).toBe('Days on nutrition target')
    expect(TEMPLATE_TEXT.checkin_days.name()).toBe('Training days')
    expect(TEMPLATE_TEXT.sleep_nights_on_target.name()).toBe('Nights on sleep target')
    expect(TEMPLATE_TEXT.sleep_nights_on_target.rule()).toBe(
      'Nights in the period that each person hits their sleep target. Others only see how many, never your times or how long you slept.')
    // A challenge made before the check-ins counts training days now, so it reads the same.
    expect(TEMPLATE_TEXT.workouts_count.name()).toBe('Training days')
    expect(TEMPLATE_TEXT.workouts_count.rule()).toBe(TEMPLATE_TEXT.checkin_days.rule())
  })

  it('writes amounts in the unit of each template', () => {
    expect(amountText('checkin_days', 1)).toBe('1 training day')
    expect(amountText('checkin_days', 12)).toBe('12 training days')
    expect(amountText('workouts_count', 1)).toBe('1 training day')
    expect(amountText('workouts_count', 12)).toBe('12 training days')
    expect(amountText('weeks_on_target', 1)).toBe('1 week')
    expect(amountText('weeks_on_target', 3)).toBe('3 weeks')
    expect(amountText('volume_total', 12.5)).toBe('12.5 t')
    expect(amountText('nutrition_days_on_target', 1)).toBe('1 day on target')
    expect(amountText('nutrition_days_on_target', 21)).toBe('21 days on target')
    expect(amountText('sleep_nights_on_target', 1)).toBe('1 night on target')
    expect(amountText('sleep_nights_on_target', 21)).toBe('21 nights on target')
  })

  it('names a challenge from its shape', () => {
    expect(autoTitle('checkin_days', 12, 30)).toBe('12 training days in 30 days')
    expect(autoTitle('workouts_count', 12, 30)).toBe('12 training days in 30 days')
    expect(autoTitle('weeks_on_target', 4, 30)).toBe('4 weeks on target')
    expect(autoTitle('volume_total', 40, 30)).toBe('40 t in 30 days')
    expect(autoTitle('nutrition_days_on_target', 21, 30)).toBe('21 days on target in 30 days')
    expect(autoTitle('sleep_nights_on_target', 21, 30)).toBe('21 nights on target in 30 days')
    expect(autoTitle('sleep_nights_on_target', 1, 7)).toBe('1 night on target in 7 days')
  })
})
