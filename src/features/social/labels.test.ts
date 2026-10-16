// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import { amountText, autoTitle, habitsOptInText, sleepOptInText, socialErrorText, MODE_TEXT, TEMPLATE_TEXT } from './labels'
import type { SocialErrorCode } from './types'

const CODES: SocialErrorCode[] = [
  'not_signed_in', 'no_profile', 'invite_not_found', 'invite_expired', 'invite_used', 'self_invite',
  'already_friends', 'invite_limit', 'not_friends', 'invalid_challenge', 'challenge_limit',
  'challenge_not_found', 'challenge_closed', 'volume_opt_in_required', 'nutrition_opt_in_required',
  'nutrition_off', 'sleep_opt_in_required', 'sleep_off', 'habits_opt_in_required', 'habits_off', 'network'
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
    expect(socialErrorText('habits_opt_in_required')).toBe('To take part, agree to show how many checks you made.')
    expect(socialErrorText('habits_off')).toBe('Turn on the Habits pillar to take part in this challenge.')
  })

  it('names templates and modes', () => {
    expect(TEMPLATE_TEXT.volume_total.name()).toBe('Total volume')
    expect(MODE_TEXT.solo.name()).toBe('Solo')
    expect(TEMPLATE_TEXT.nutrition_days_on_target.name()).toBe('Days on nutrition target')
    expect(TEMPLATE_TEXT.checkin_days.name()).toBe('Training days')
    expect(TEMPLATE_TEXT.sleep_nights_on_target.name()).toBe('Nights on sleep target')
    expect(TEMPLATE_TEXT.sleep_nights_on_target.rule()).toBe(
      'Nights in the period that each person hits their sleep target. Others only see how many, never your times, how long you slept, its quality or your notes.')
    expect(TEMPLATE_TEXT.habit_checks.name()).toBe('Habit checks')
    expect(TEMPLATE_TEXT.habit_checks.rule()).toBe(
      'Habit checks in the period, each habit up to its own weekly goal. Others only see how many, never your habits or the days.')
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
    expect(amountText('habit_checks', 1)).toBe('1 check')
    expect(amountText('habit_checks', 21)).toBe('21 checks')
  })

  it('names a challenge from its shape', () => {
    expect(autoTitle('checkin_days', 12, 30)).toBe('12 training days in 30 days')
    expect(autoTitle('workouts_count', 12, 30)).toBe('12 training days in 30 days')
    expect(autoTitle('weeks_on_target', 4, 30)).toBe('4 weeks on target')
    expect(autoTitle('volume_total', 40, 30)).toBe('40 t in 30 days')
    expect(autoTitle('nutrition_days_on_target', 21, 30)).toBe('21 days on target in 30 days')
    expect(autoTitle('nutrition_days_on_target', 1, 7)).toBe('1 day on target in 7 days')
    expect(autoTitle('sleep_nights_on_target', 21, 30)).toBe('21 nights on target in 30 days')
    expect(autoTitle('sleep_nights_on_target', 1, 7)).toBe('1 night on target in 7 days')
    expect(autoTitle('habit_checks', 40, 30)).toBe('40 checks in 30 days')
    expect(autoTitle('habit_checks', 1, 7)).toBe('1 check in 7 days')
  })
})

describe('sleep opt-in copy in pt-BR', () => {
  afterEach(async () => { await setLang('en') })

  it('names quality and calls the notes observações, as the privacy page does', async () => {
    await setLang('pt-BR')
    expect(sleepOptInText().detail).toBe(
      'Eles veem só esse número, nunca seus horários, quanto você dormiu, a qualidade do sono ou suas observações.')
    expect(TEMPLATE_TEXT.sleep_nights_on_target.rule()).toContain('a qualidade do sono ou suas observações.')
    expect(autoTitle('nutrition_days_on_target', 1, 7)).toBe('1 dia no alvo em 7 dias')
  })
})

describe('habits challenge copy', () => {
  afterEach(async () => { await setLang('en') })

  it('says only the count of checks is shown, never the habits, their icons or the days', () => {
    expect(habitsOptInText()).toEqual({
      label: 'Show participants how many checks I made',
      detail: 'They see only that number, never your habits, their icons or which days.'
    })
  })

  it('reads in Brazilian Portuguese, with 1 check in the singular', async () => {
    await setLang('pt-BR')
    expect(TEMPLATE_TEXT.habit_checks.name()).toBe('Checks de hábitos')
    expect(amountText('habit_checks', 1)).toBe('1 check')
    expect(amountText('habit_checks', 12)).toBe('12 checks')
    expect(autoTitle('habit_checks', 1, 7)).toBe('1 check em 7 dias')
    expect(autoTitle('habit_checks', 40, 30)).toBe('40 checks em 30 dias')
    expect(habitsOptInText().detail).toBe('Eles veem só esse número, nunca seus hábitos, os ícones ou os dias.')
    expect(socialErrorText('habits_off')).toBe('Ative o pilar Hábitos para participar deste desafio.')
  })

  it('takes the plural forms of Russian', async () => {
    await setLang('ru')
    expect(amountText('habit_checks', 1)).toBe('1 отметка')
    expect(amountText('habit_checks', 3)).toBe('3 отметки')
    expect(amountText('habit_checks', 5)).toBe('5 отметок')
    expect(amountText('habit_checks', 21)).toBe('21 отметка')
  })
})
