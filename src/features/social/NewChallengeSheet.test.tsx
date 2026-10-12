// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), createChallenge: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), createChallenge: h.createChallenge }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))
// The pillar's activation sheet, as a stand-in that only says whether it is open.
vi.mock('../nutrition/NutritionSetup', async () => {
  const { createElement } = await import('react')
  return { default: ({ open }: { open: boolean }) => (open ? createElement('div', { role: 'dialog', 'aria-label': 'Nutrition setup' }) : null) }
})
vi.mock('../sleep/SleepSetup', async () => {
  const { createElement } = await import('react')
  return { default: ({ open }: { open: boolean }) => (open ? createElement('div', { role: 'dialog', 'aria-label': 'Sleep setup' }) : null) }
})

import NewChallengeSheet from './NewChallengeSheet'
import { useSocial } from './useSocial'
import { useProgress } from '../gamification/useProgress'
import { useProfile } from '../profile/useProfile'
import { SocialError } from './social-api'
import { addDays } from './templates'
import { todayISO } from '../../lib/format.js'
import { BIA, CAIO, ME, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const onClose = vi.fn()
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })
const create = () => screen.getByRole('button', { name: 'Create challenge' }) as HTMLButtonElement
const pillar = (on: boolean) => useProfile.setState({ profile: { nutrition_enabled: on, nutrition_days_per_week: 5, timezone: 'America/Sao_Paulo' } as never })
const nutritionRadio = () => screen.getByRole('radio', { name: /Days on nutrition target/ }) as HTMLButtonElement
// Sleep on or off, with 4 nights on target a week (the sleep T); Nutrition off.
const sleepPillar = (on: boolean) => useProfile.setState({ profile: {
  nutrition_enabled: false, nutrition_days_per_week: 5, sleep_enabled: on, sleep_nights_per_week: 4, timezone: 'America/Sao_Paulo'
} as never })
const sleepRadio = () => screen.getByRole('radio', { name: /Nights on sleep target/ }) as HTMLButtonElement
const SLEEP_OFF_WHY = 'Only for people with the Sleep pillar on.'
const SLEEP_HINT = 'Agree to show your nights on target to create this challenge.'

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, friends: ready([friendOf(BIA, 'Bia'), friendOf(CAIO, 'Caio')]) })
  ;[load, onClose, h.nav, h.createChallenge, h.toast.success, h.toast.error].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }); useProfile.setState({ profile: null }) })

describe('NewChallengeSheet', () => {
  it('opens on Training days and offers neither workouts nor total volume', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    const options = within(screen.getByRole('radiogroup', { name: 'What counts' })).getAllByRole('radio')
    expect(options.map(o => o.textContent)).toEqual([
      expect.stringContaining('Training days'), expect.stringContaining('Weeks on target'), expect.stringContaining('Days on nutrition target'),
      expect.stringContaining('Nights on sleep target')
    ])
    expect(screen.getByRole('radio', { name: /Training days/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Days with a check-in in the period. Several on the same day count as one.')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Workouts in the period/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /Total volume/ })).toBeNull()
    expect(screen.queryByRole('switch', { name: /volume/ })).toBeNull()
  })

  it('suggests a goal and a name from what is picked', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    // 3 training days a week (no progress yet) × 4 weeks, only me so far.
    expect(screen.getByText('12 training days')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('12 training days in 30 days')
    expect(screen.getByText('Pick at least one friend.')).toBeTruthy()
    expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('24 training days')).toBeTruthy()
    expect(create().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByText('25 training days')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('25 training days in 30 days')
  })

  it('keeps weeks on target solo', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /Weeks on target/ }))
    expect((screen.getByRole('radio', { name: 'Team' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only solo for this goal: each person has their own weekly goal.')).toBeTruthy()
  })

  it('asks for a name when it is cleared', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.change(screen.getByLabelText('Challenge name'), { target: { value: '   ' } })
    expect(screen.getByText('Give the challenge a name.')).toBeTruthy()
    expect(create().disabled).toBe(true)
  })

  it('offers an invite when there is nobody to pick', () => {
    useSocial.setState({ friends: ready([]) })
    render(<NewChallengeSheet open onClose={onClose} />)
    expect(screen.getByText('Add a friend to create challenges.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy()
    expect(create().disabled).toBe(true)
  })

  it('creates the challenge, closes and opens it', async () => {
    h.createChallenge.mockResolvedValue('c9')
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios/c9'))
    const today = todayISO()
    expect(h.createChallenge).toHaveBeenCalledWith({
      template: 'checkin_days', title: '24 training days in 30 days', mode: 'team', target: 24,
      starts_on: today, ends_on: addDays(today, 29), invitees: [BIA], share_volume: false, share_nutrition: false, share_sleep: false
    })
    expect(onClose).toHaveBeenCalled()
    expect(load).toHaveBeenCalledWith('challenges')
    expect(h.toast.success).toHaveBeenCalledWith('Challenge created. Your friends got the invite.')
  })

  it('says why the server refused', async () => {
    h.createChallenge.mockRejectedValue(new SocialError('challenge_limit'))
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('You already have 10 challenges in progress.'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lists the nutrition challenge turned off, with the way to turn the pillar on', () => {
    pillar(false)
    render(<NewChallengeSheet open onClose={onClose} />)
    expect(nutritionRadio().disabled).toBe(true)
    expect(screen.getByText('Only for people with the Nutrition pillar on.')).toBeTruthy()
    fireEvent.click(nutritionRadio())
    expect(nutritionRadio().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Nutrition' }))
    expect(screen.getByRole('dialog', { name: 'Nutrition setup' })).toBeTruthy()
    // The setup turns the pillar on: the template opens up and is picked for the person.
    act(() => pillar(true))
    expect(nutritionRadio().disabled).toBe(false)
    expect(nutritionRadio().getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('Only for people with the Nutrition pillar on.')).toBeNull()
  })

  it('suggests days on target and keeps the goal inside the period', () => {
    pillar(true)
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(nutritionRadio())
    // 5 days on target a week (the profile) over 30 days, only me so far.
    expect(screen.getByText('21 days on target')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('42 days on target')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('42 days on target in 30 days')
    fireEvent.click(screen.getByRole('radio', { name: 'Solo' }))
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(screen.getByText('5 days on target')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByText('7 days on target')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'More' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for the opt-in before creating a nutrition challenge and sends it', async () => {
    pillar(true)
    h.createChallenge.mockResolvedValue('c9')
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(nutritionRadio())
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('Agree to show your days on target to create this challenge.')).toBeTruthy()
    expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: /Show participants how many days I was on target/ }))
    expect(screen.queryByText('Agree to show your days on target to create this challenge.')).toBeNull()
    fireEvent.click(create())
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios/c9'))
    expect(h.createChallenge).toHaveBeenCalledWith(expect.objectContaining({
      template: 'nutrition_days_on_target', mode: 'team', target: 42, invitees: [BIA], share_nutrition: true
    }))
  })

  it('does not send the nutrition opt-in with another template', async () => {
    pillar(true)
    h.createChallenge.mockResolvedValue('c9')
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(nutritionRadio())
    fireEvent.click(screen.getByRole('switch', { name: /how many days/ }))
    fireEvent.click(screen.getByRole('radio', { name: /Training days/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.createChallenge).toHaveBeenCalled())
    expect(h.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ template: 'checkin_days', share_nutrition: false }))
  })

  it('says when the pillar went off under an open form', () => {
    pillar(true)
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(nutritionRadio())
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Show participants/ }))
    act(() => pillar(false))
    expect(screen.getByText('Turn on the Nutrition pillar to create this challenge.')).toBeTruthy()
    expect(create().disabled).toBe(true)
  })

  it('explains the nutrition refusals of the server', async () => {
    pillar(true)
    h.createChallenge.mockRejectedValue(new SocialError('nutrition_off'))
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(nutritionRadio())
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(screen.getByRole('switch', { name: /Show participants/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Turn on the Nutrition pillar to take part in this challenge.'))
  })

  describe('the sleep challenge', () => {
    it('is listed off while Sleep is off, says why and opens the Sleep setup', () => {
      sleepPillar(false)
      render(<NewChallengeSheet open onClose={onClose} />)
      expect(sleepRadio().disabled).toBe(true)
      expect(screen.getByText(SLEEP_OFF_WHY)).toBeTruthy()
      expect(sleepRadio().getAttribute('aria-describedby')).toBe(screen.getByText(SLEEP_OFF_WHY).id)
      fireEvent.click(sleepRadio())
      expect(sleepRadio().getAttribute('aria-checked')).toBe('false')
      fireEvent.click(screen.getByRole('button', { name: 'Turn on Sleep' }))
      expect(screen.getByRole('dialog', { name: 'Sleep setup' })).toBeTruthy()
      expect(screen.queryByRole('dialog', { name: 'Nutrition setup' })).toBeNull()
      // The setup turns the pillar on: the template opens up and is picked for the person.
      act(() => sleepPillar(true))
      expect(sleepRadio().disabled).toBe(false)
      expect(sleepRadio().getAttribute('aria-checked')).toBe('true')
      expect(screen.queryByText(SLEEP_OFF_WHY)).toBeNull()
    })

    it('keeps each pillar shortcut on its own template when both are off', () => {
      sleepPillar(false)
      render(<NewChallengeSheet open onClose={onClose} />)
      expect(nutritionRadio().getAttribute('aria-describedby')).not.toBe(sleepRadio().getAttribute('aria-describedby'))
      fireEvent.click(screen.getByRole('button', { name: 'Turn on Nutrition' }))
      expect(screen.getByRole('dialog', { name: 'Nutrition setup' })).toBeTruthy()
      expect(screen.queryByRole('dialog', { name: 'Sleep setup' })).toBeNull()
    })

    it('suggests nights on target from the sleep goal of the week', () => {
      sleepPillar(true)
      render(<NewChallengeSheet open onClose={onClose} />)
      fireEvent.click(sleepRadio())
      // 4 nights on target a week (the profile) over 30 days, only me so far.
      expect(screen.getByText('17 nights on target')).toBeTruthy()
      fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
      expect(screen.getByText('34 nights on target')).toBeTruthy()
      expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('34 nights on target in 30 days')
      fireEvent.click(screen.getByRole('radio', { name: 'Solo' }))
      fireEvent.click(screen.getByRole('button', { name: '7 days' }))
      expect(screen.getByText('4 nights on target')).toBeTruthy()
      for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'More' }))
      expect(screen.getByText('7 nights on target')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'More' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('asks for the opt-in, saying only the count is shown, and sends it', async () => {
      sleepPillar(true)
      h.createChallenge.mockResolvedValue('c9')
      render(<NewChallengeSheet open onClose={onClose} />)
      fireEvent.click(sleepRadio())
      fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
      expect(screen.getByText(SLEEP_HINT)).toBeTruthy()
      expect(create().disabled).toBe(true)
      expect(screen.getByText('They see only that number, never your times, how long you slept, its quality or your notes.')).toBeTruthy()
      // The nutrition opt-in is not offered for it.
      expect(screen.queryByRole('switch', { name: /how many days/ })).toBeNull()
      fireEvent.click(screen.getByRole('switch', { name: /^Show participants how many nights I was on target/ }))
      expect(screen.queryByText(SLEEP_HINT)).toBeNull()
      fireEvent.click(create())
      await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios/c9'))
      expect(h.createChallenge).toHaveBeenCalledWith(expect.objectContaining({
        template: 'sleep_nights_on_target', mode: 'team', target: 34, invitees: [BIA], share_nutrition: false, share_sleep: true
      }))
    })

    it('does not send the sleep opt-in with another template', async () => {
      sleepPillar(true)
      h.createChallenge.mockResolvedValue('c9')
      render(<NewChallengeSheet open onClose={onClose} />)
      fireEvent.click(sleepRadio())
      fireEvent.click(screen.getByRole('switch', { name: /how many nights/ }))
      fireEvent.click(screen.getByRole('radio', { name: /Training days/ }))
      fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
      fireEvent.click(create())
      await waitFor(() => expect(h.createChallenge).toHaveBeenCalled())
      expect(h.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ template: 'checkin_days', share_sleep: false }))
    })

    it('says when the pillar went off under an open form', () => {
      sleepPillar(true)
      render(<NewChallengeSheet open onClose={onClose} />)
      fireEvent.click(sleepRadio())
      fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
      fireEvent.click(screen.getByRole('switch', { name: /how many nights/ }))
      act(() => sleepPillar(false))
      expect(screen.getByText('Turn on the Sleep pillar to create this challenge.')).toBeTruthy()
      expect(create().disabled).toBe(true)
    })

    it.each([
      ['sleep_off', 'Turn on the Sleep pillar to take part in this challenge.'],
      ['sleep_opt_in_required', 'To take part, agree to show how many nights you were on target.']
    ] as const)('explains %s from the server', async (code, text) => {
      sleepPillar(true)
      h.createChallenge.mockRejectedValue(new SocialError(code))
      render(<NewChallengeSheet open onClose={onClose} />)
      fireEvent.click(sleepRadio())
      fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
      fireEvent.click(screen.getByRole('switch', { name: /how many nights/ }))
      fireEvent.click(create())
      await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(text))
    })
  })
})
