// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), params: new URLSearchParams(), setParams: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useSearchParams: () => [h.params, h.setParams] }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import ChallengesPanel from './ChallengesPanel'
import { useSocial } from './useSocial'
import { BIA, ME, challengeOf, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, friends: ready([friendOf(BIA, 'Bia')]) })
  load.mockClear()
  h.nav.mockClear()
  h.setParams.mockClear()
  h.params = new URLSearchParams()
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('ChallengesPanel', () => {
  it('groups invitations, ongoing and finished challenges', () => {
    useSocial.setState({ challenges: ready([
      challengeOf({ id: 'i1', title: 'Convite da Bia', invited_by: 'Bia', me: { joined: false, won: null } }),
      challengeOf({ id: 'a1', title: 'Outubro forte' }),
      challengeOf({ id: 'f1', title: 'Setembro', status: 'won', me: { joined: true, won: true } })
    ]) })
    render(<ChallengesPanel />)
    expect(load).toHaveBeenCalledWith('challenges')
    expect(within(screen.getByRole('region', { name: 'Invitations' })).getByText('Bia invited you')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'In progress' })).getByText('Outubro forte')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Finished' })).getByText(/Completed/)).toBeTruthy()
  })

  it('opens a challenge', () => {
    useSocial.setState({ challenges: ready([challengeOf({ id: 'a1' })]) })
    render(<ChallengesPanel />)
    fireEvent.click(screen.getByRole('button', { name: /Outubro forte/ }))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios/a1')
  })

  it('needs a friend before creating one', () => {
    useSocial.setState({ friends: ready([]), challenges: ready([]) })
    render(<ChallengesPanel />)
    expect(screen.getByRole('button', { name: 'New challenge' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Add a friend to create challenges.')).toBeTruthy()
    expect(screen.getByText('No challenges yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy()
  })

  it('opens the form at once when asked by the link', () => {
    h.params = new URLSearchParams('novo=1')
    useSocial.setState({ challenges: ready([]) })
    render(<ChallengesPanel />)
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'New challenge' })).toBeTruthy()
    expect(h.setParams).toHaveBeenCalledWith({}, { replace: true })
  })
})
