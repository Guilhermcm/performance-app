import { describe, it, expect } from 'vitest'
import { amountText, autoTitle, socialErrorText, MODE_TEXT, TEMPLATE_TEXT } from './labels'
import type { SocialErrorCode } from './types'

const CODES: SocialErrorCode[] = [
  'not_signed_in', 'no_profile', 'invite_not_found', 'invite_expired', 'invite_used', 'self_invite',
  'already_friends', 'invite_limit', 'not_friends', 'invalid_challenge', 'challenge_limit',
  'challenge_not_found', 'challenge_closed', 'volume_opt_in_required', 'network'
]

describe('social labels', () => {
  it('has a human message for every error code', () => {
    for (const code of CODES) expect(socialErrorText(code).trim(), code).not.toBe('')
    expect(socialErrorText('invite_expired')).toBe('This invite has expired. Ask for a new link.')
    expect(socialErrorText('network')).toBe('Could not reach the server. Check your connection and try again.')
  })

  it('names templates and modes', () => {
    expect(TEMPLATE_TEXT.volume_total.name()).toBe('Total volume')
    expect(MODE_TEXT.solo.name()).toBe('Solo')
  })

  it('writes amounts in the unit of each template', () => {
    expect(amountText('workouts_count', 1)).toBe('1 workout')
    expect(amountText('workouts_count', 12)).toBe('12 workouts')
    expect(amountText('weeks_on_target', 1)).toBe('1 week')
    expect(amountText('weeks_on_target', 3)).toBe('3 weeks')
    expect(amountText('volume_total', 12.5)).toBe('12.5 t')
  })

  it('names a challenge from its shape', () => {
    expect(autoTitle('workouts_count', 12, 30)).toBe('12 workouts in 30 days')
    expect(autoTitle('weeks_on_target', 4, 30)).toBe('4 weeks on target')
    expect(autoTitle('volume_total', 40, 30)).toBe('40 t in 30 days')
  })
})
