// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(), id: 'c1', join: vi.fn(), leave: vi.fn(), refresh: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useParams: () => ({ id: h.id }) }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), joinChallenge: h.join, leaveChallenge: h.leave }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ refresh: h.refresh }) } }))
vi.mock('sonner', () => ({ toast: h.toast }))

import ChallengeDetail from './ChallengeDetail'
import { useSocial } from './useSocial'
import { BIA, CAIO, ME, challengeOf } from './test-social'
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
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load })
  ;[load, h.nav, h.join, h.leave, h.refresh, h.toast.success, h.toast.error].forEach(f => f.mockReset())
  h.join.mockResolvedValue(undefined)
  h.leave.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

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
    expect(screen.getByText('3 workouts')).toBeTruthy()
    expect(screen.getByText('Goal: 6 workouts')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3')
    const members = within(screen.getByRole('region', { name: 'Members' })).getAllByRole('listitem')
    expect(members.map(m => m.textContent)).toEqual([expect.stringContaining('Ana'), expect.stringContaining('Bia'), expect.stringContaining('Invited')])
  })

  it('lets an invited person join', async () => {
    show([invited()])
    render(<ChallengeDetail />)
    expect(screen.queryByText('Team total')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Join challenge' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('You joined the challenge'))
    expect(h.join).toHaveBeenCalledWith('c1', false)
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
    expect(h.join).toHaveBeenCalledWith('c1', true)
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
})
