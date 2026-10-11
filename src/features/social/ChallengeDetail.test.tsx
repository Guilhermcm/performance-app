// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(), id: 'c1', join: vi.fn(), leave: vi.fn(), refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useParams: () => ({ id: h.id }) }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), joinChallenge: h.join, leaveChallenge: h.leave }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ refresh: h.refresh }) } }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./ChallengeFeed', () => ({ default: ({ id }: { id: string }) => <p>challenge feed of {id}</p> }))
vi.mock('../nutrition/NutritionSetup', async () => {
  const { createElement } = await import('react')
  return { default: ({ open }: { open: boolean }) => (open ? createElement('div', { role: 'dialog', 'aria-label': 'Nutrition setup' }) : null) }
})

import ChallengeDetail from './ChallengeDetail'
import { useSocial } from './useSocial'
import { useProfile } from '../profile/useProfile'
import { SocialError } from './social-api'
import { addDays } from './templates'
import { fmtShortDay } from './format'
import { todayISO } from '../../lib/format.js'
import { BIA, CAIO, ME, challengeOf } from './test-social'
import { setLang } from '../../lib/i18n.js'
import type { Challenge } from './types'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const show = (c: Challenge[]) => useSocial.setState({ challenges: { status: 'ready', data: c, stale: false, error: null } })
const invited = (over: Partial<Challenge> = {}) => challengeOf({
  invited_by: 'Bia', me: { joined: false, won: null },
  members: [
    { id: BIA, name: 'Bia', avatar_url: null, me: false, joined: true, progress: 1, won: null },
    { id: ME, name: 'Ana', avatar_url: null, me: true, joined: false, progress: null, won: null }
  ],
  ...over
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load })
  ;[load, h.nav, h.join, h.leave, h.refresh, h.toast.success, h.toast.error].forEach(f => f.mockReset())
  h.join.mockResolvedValue(undefined)
  h.leave.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers(); void setLang('en'); useSocial.setState({ load: realLoad }); useProfile.setState({ profile: null }) })
const pillar = (on: boolean) => useProfile.setState({ profile: { nutrition_enabled: on, timezone: 'America/Sao_Paulo' } as never })
const NUT = 'nutrition_days_on_target' as const

describe('ChallengeDetail', () => {
  it('shows the team total against the goal and every member', () => {
    show([challengeOf({
      members: [
        ...challengeOf().members,
        { id: CAIO, name: 'Caio', avatar_url: null, me: false, joined: false, progress: null, won: null }
      ]
    })])
    render(<ChallengeDetail />)
    expect(screen.getByRole('heading', { level: 1, name: 'Outubro forte' })).toBeTruthy()
    expect(screen.getByText('Team total')).toBeTruthy()
    expect(screen.getByText('3 training days')).toBeTruthy()
    expect(screen.getByText('Goal: 6 training days')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
    const members = within(screen.getByRole('region', { name: 'Scoreboard' })).getAllByRole('listitem')
    expect(members.map(m => m.textContent)).toEqual([expect.stringContaining('Ana'), expect.stringContaining('Bia'), expect.stringContaining('Invited')])
  })

  describe('a training days challenge', () => {
    const DAYS = 'checkin_days' as const
    const ranked = (over: Partial<Challenge> = {}) => challengeOf({
      template: DAYS, mode: 'solo', target: 10, total: 0,
      members: [
        { id: ME, name: 'Ana', avatar_url: null, me: true, joined: true, progress: 4, won: null },
        { id: BIA, name: 'Bia', avatar_url: null, me: false, joined: true, progress: 7, won: null },
        { id: CAIO, name: 'Caio', avatar_url: null, me: false, joined: true, progress: 7, won: null },
        { id: 'd', name: 'Duda', avatar_url: null, me: false, joined: false, progress: null, won: null }
      ],
      ...over
    })

    it('shows the scoreboard: training days and the position of each person, mine first said', () => {
      show([ranked()])
      render(<ChallengeDetail />)
      expect(screen.getByText(/^Training days · Solo$/)).toBeTruthy()
      expect(screen.getByText('Your progress')).toBeTruthy()
      // In the progress card and in my row.
      expect(screen.getAllByText('4 training days')).toHaveLength(2)
      expect(screen.getByText('Goal: 10 training days')).toBeTruthy()
      // Bia and Caio tie on 7: both first. Ana is third of three; the invited Duda has no position.
      expect(screen.getByText('Position 3 of 3')).toBeTruthy()
      const rows = within(screen.getByRole('region', { name: 'Scoreboard' })).getAllByRole('listitem')
      expect(rows.map(r => r.textContent)).toEqual([
        expect.stringMatching(/Bia.*7 training days/), expect.stringMatching(/Caio.*7 training days/),
        expect.stringMatching(/Ana.*You.*4 training days/), expect.stringMatching(/Duda.*Invited/)
      ])
      expect(within(rows[0]).getByLabelText('Position 1')).toBeTruthy()
      expect(within(rows[1]).getByLabelText('Position 1')).toBeTruthy()
      expect(within(rows[2]).getByLabelText('Position 3')).toBeTruthy()
      expect(within(rows[3]).queryByLabelText(/Position/)).toBeNull()
    })

    it('says the position of the team too, and reads 1 training day in the singular', () => {
      show([ranked({ mode: 'team', total: 18, members: [
        { id: ME, name: 'Ana', avatar_url: null, me: true, joined: true, progress: 1, won: null },
        { id: BIA, name: 'Bia', avatar_url: null, me: false, joined: true, progress: 0, won: null }
      ] })])
      render(<ChallengeDetail />)
      expect(screen.getByText('Position 1 of 2')).toBeTruthy()
      expect(screen.getByText('1 training day')).toBeTruthy()
      expect(screen.getByText('Team total')).toBeTruthy()
    })

    it('shows the feed of the challenge below the scoreboard', () => {
      show([ranked()])
      render(<ChallengeDetail />)
      expect(screen.getByRole('heading', { name: 'Check-ins' })).toBeTruthy()
      expect(screen.getByText('challenge feed of c1')).toBeTruthy()
    })

    it('keeps the feed and the position away from an invitation not yet accepted', () => {
      show([invited({ template: DAYS })])
      render(<ChallengeDetail />)
      expect(screen.queryByText('challenge feed of c1')).toBeNull()
      expect(screen.queryByText(/^Position \d+ of/)).toBeNull()
    })

    it('counts closed days only and says when the result comes, two days after the last day', () => {
      show([ranked()])
      render(<ChallengeDetail />)
      expect(screen.getByText('Counting up to the day before yesterday')).toBeTruthy()
      expect(screen.getByText('Result on ' + fmtShortDay('2026-10-21'))).toBeTruthy()
    })

    it('waits for the result after the last day', () => {
      const today = todayISO()
      show([ranked({ starts_on: addDays(today, -10), ends_on: addDays(today, -1) })])
      render(<ChallengeDetail />)
      expect(screen.getAllByText(new RegExp('Result on ' + fmtShortDay(addDays(today, 2))))).toHaveLength(1)
    })

    it('can still be left on the last day and not on the day after', () => {
      vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
      show([ranked({ ends_on: '2026-10-18' })])
      const { unmount } = render(<ChallengeDetail />)
      expect(screen.getByRole('button', { name: 'Leave challenge' })).toBeTruthy()
      unmount()
      vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
      render(<ChallengeDetail />)
      expect(screen.queryByRole('button', { name: 'Leave challenge' })).toBeNull()
      expect(screen.getByText(new RegExp('Result on ' + fmtShortDay('2026-10-21')))).toBeTruthy()
    })
  })

  describe('a challenge made before the check-ins (workouts_count)', () => {
    it('is called Training days, counts training days and shows the same scoreboard and feed', () => {
      show([challengeOf({ template: 'workouts_count' })])
      render(<ChallengeDetail />)
      expect(screen.getByText(/^Training days · Team$/)).toBeTruthy()
      expect(screen.queryByText(/Workouts in the period/)).toBeNull()
      expect(screen.getByText('Position 1 of 2')).toBeTruthy()
      expect(screen.getByText('challenge feed of c1')).toBeTruthy()
      expect(screen.getByText('Result on ' + fmtShortDay('2026-10-21'))).toBeTruthy()
    })

    it('says it in Brazilian Portuguese', async () => {
      await setLang('pt-BR')
      show([challengeOf({ template: 'workouts_count' })])
      render(<ChallengeDetail />)
      expect(screen.getByText(/^Dias de treino · Equipe$/)).toBeTruthy()
      expect(screen.getByText('Posição 1 de 2')).toBeTruthy()
      expect(screen.getByText('Resultado sai em ' + fmtShortDay('2026-10-21'))).toBeTruthy()
    })
  })

  it('has no scoreboard feed for the other templates', () => {
    show([challengeOf({ template: 'weeks_on_target', mode: 'solo', target: 3 })])
    render(<ChallengeDetail />)
    expect(screen.queryByText('challenge feed of c1')).toBeNull()
    expect(screen.queryByText(/^Position \d+ of/)).toBeNull()
    expect(screen.getByRole('region', { name: 'Members' })).toBeTruthy()
  })

  it('lets an invited person join', async () => {
    show([invited()])
    render(<ChallengeDetail />)
    expect(screen.queryByText('Team total')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join challenge' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('You joined the challenge'))
    expect(h.join).toHaveBeenCalledWith('c1', { shareVolume: false, shareNutrition: false })
    expect(load).toHaveBeenCalledWith('challenges')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('lets an invited person decline', async () => {
    show([invited()])
    render(<ChallengeDetail />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios', { replace: true }))
    expect(h.leave).toHaveBeenCalledWith('c1')
  })

  it('asks for the volume opt-in before joining a volume challenge', () => {
    show([invited({ template: 'volume_total', target: 20 })])
    render(<ChallengeDetail />)
    const join = screen.getByRole('button', { name: 'Join challenge' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    expect(join.disabled).toBe(false)
    fireEvent.click(join)
    expect(h.join).toHaveBeenCalledWith('c1', { shareVolume: true, shareNutrition: false })
  })

  it('confirms before leaving', async () => {
    show([challengeOf()])
    render(<ChallengeDetail />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave challenge' }))
    expect(screen.getByText('Leave this challenge? Your progress stops counting for it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(h.leave).toHaveBeenCalledWith('c1'))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios', { replace: true })
  })

  it.each([
    [{ status: 'won', me: { joined: true, won: true } }, 'Challenge completed! +300 XP'],
    [{ status: 'won', mode: 'solo', me: { joined: true, won: false } }, 'You did not reach the goal this time.'],
    [{ status: 'lost', me: { joined: true, won: false } }, 'The goal was not reached this time.'],
    [{ status: 'cancelled', me: { joined: true, won: null } }, 'Cancelled: fewer than 2 people joined.']
  ] as [Partial<Challenge>, string][])('tells how %j ended', (over, text) => {
    show([challengeOf(over)])
    render(<ChallengeDetail />)
    expect(screen.getByRole('status').textContent).toBe(text)
    expect(screen.queryByRole('button', { name: 'Leave challenge' })).toBeNull()
  })

  it('says when the challenge is gone', () => {
    show([])
    render(<ChallengeDetail />)
    expect(screen.getByText('This challenge is no longer available.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith(-1)
  })

  it('asks for the nutrition opt-in before joining', () => {
    pillar(true)
    show([invited({ template: NUT, target: 10 })])
    render(<ChallengeDetail />)
    const join = screen.getByRole('button', { name: 'Join challenge' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: /Show participants how many days I was on target/ }))
    expect(join.disabled).toBe(false)
    fireEvent.click(join)
    expect(h.join).toHaveBeenCalledWith('c1', { shareVolume: false, shareNutrition: true })
  })

  it('opens the pillar activation instead of joining while Nutrition is off', () => {
    pillar(false)
    show([invited({ template: NUT, target: 10 })])
    render(<ChallengeDetail />)
    expect(screen.queryByRole('button', { name: 'Join challenge' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on the Nutrition pillar to join' }))
    expect(screen.getByRole('dialog', { name: 'Nutrition setup' })).toBeTruthy()
    expect(h.join).not.toHaveBeenCalled()
    // Back from the setup with the pillar on, the opt-in and the join button are there.
    act(() => pillar(true))
    expect(screen.getByRole('button', { name: 'Join challenge' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: /Show participants/ })).toBeTruthy()
  })

  it.each([
    ['nutrition_off', 'Turn on the Nutrition pillar to take part in this challenge.'],
    ['nutrition_opt_in_required', 'To take part, agree to show how many days you were on target.']
  ] as const)('explains %s from the server', async (code, text) => {
    pillar(true)
    h.join.mockRejectedValue(new SocialError(code))
    show([invited({ template: NUT, target: 10 })])
    render(<ChallengeDetail />)
    fireEvent.click(screen.getByRole('switch', { name: /Show participants/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Join challenge' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith(text))
  })

  it('counts days on target up to the day before yesterday and says when the result comes', () => {
    pillar(true)
    show([challengeOf({ template: NUT, target: 10 })])
    render(<ChallengeDetail />)
    expect(screen.getByText('3 days on target')).toBeTruthy()
    expect(screen.getByText('Goal: 10 days on target')).toBeTruthy()
    expect(screen.getByText('Counting up to the day before yesterday')).toBeTruthy()
    expect(screen.getByText('Result on ' + fmtShortDay('2026-10-21'))).toBeTruthy()
    const members = within(screen.getByRole('region', { name: 'Members' })).getAllByRole('listitem')
    expect(members.map(m => m.textContent)).toEqual([expect.stringContaining('2 days on target'), expect.stringContaining('1 day on target')])
  })

  it('waits for the result after the last day instead of saying it ends today', () => {
    const today = todayISO()
    show([challengeOf({ template: NUT, target: 10, starts_on: addDays(today, -10), ends_on: addDays(today, -1) })])
    render(<ChallengeDetail />)
    expect(screen.queryByText(/Ends today/)).toBeNull()
    // Once, in the header: the result line under the rule does not repeat it.
    expect(screen.getAllByText(new RegExp('Result on ' + fmtShortDay(addDays(today, 2))))).toHaveLength(1)
    expect(screen.getByText('Counting up to the day before yesterday')).toBeTruthy()
  })

  describe('an invitation to a nutrition challenge after its last day', () => {
    // Still active on the server for two more days, but join_challenge refuses with challenge_closed.
    const lastDay = '2026-10-18'
    const late = (on: boolean) => {
      pillar(on)
      show([invited({ template: NUT, target: 10, ends_on: lastDay })])
    }

    it('is still joinable on the last day', () => {
      vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
      late(true)
      render(<ChallengeDetail />)
      expect(screen.getByRole('button', { name: 'Join challenge' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
    })

    it('offers no action once the day after the last day arrives: the server would refuse them all', () => {
      vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
      late(true)
      render(<ChallengeDetail />)
      expect(screen.queryByRole('button', { name: 'Join challenge' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
      expect(screen.queryByRole('switch')).toBeNull()
      expect(screen.getByText(new RegExp('Result on ' + fmtShortDay('2026-10-21')))).toBeTruthy()
    })

    it('does not send the person to turn on the pillar for it', () => {
      vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
      late(false)
      render(<ChallengeDetail />)
      expect(screen.queryByRole('button', { name: 'Turn on the Nutrition pillar to join' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Join challenge' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
    })

    it('still declines on the last day', async () => {
      vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
      late(true)
      render(<ChallengeDetail />)
      fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
      await waitFor(() => expect(h.leave).toHaveBeenCalledWith('c1'))
    })
  })

  describe('a member of a nutrition challenge in its grace days', () => {
    const lastDay = '2026-10-18'
    const mine = () => show([challengeOf({ template: NUT, target: 10, ends_on: lastDay })])

    it('can still leave on the last day', () => {
      vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
      pillar(true)
      mine()
      render(<ChallengeDetail />)
      expect(screen.getByRole('button', { name: 'Leave challenge' })).toBeTruthy()
    })

    it('has no Leave button once the day after the last day arrives', () => {
      vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
      pillar(true)
      mine()
      render(<ChallengeDetail />)
      expect(screen.queryByRole('button', { name: 'Leave challenge' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
      expect(screen.getByText(new RegExp('Result on ' + fmtShortDay('2026-10-21')))).toBeTruthy()
    })
  })

  it('does not say it counts up to the day before yesterday before the challenge starts', () => {
    pillar(true)
    show([challengeOf({ template: NUT, target: 10, starts_on: '2026-10-08', ends_on: '2026-10-20' })])
    render(<ChallengeDetail />)
    expect(screen.queryByText('Counting up to the day before yesterday')).toBeNull()
  })
})
