// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), section: 'ranking' as string | undefined }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => h.nav,
  useParams: () => ({ section: h.section }),
  Navigate: ({ to }: { to: string }) => <p>redirect {to}</p>
}))
vi.mock('./RankingPanel', () => ({ default: () => <p>ranking panel</p> }))
vi.mock('./ChallengesPanel', () => ({ default: () => <p>challenges panel</p> }))
vi.mock('./FeedPanel', () => ({ default: () => <p>feed panel</p> }))
vi.mock('./FriendsPanel', () => ({ default: () => <p>friends panel</p> }))

import SocialScreen from './SocialScreen'
import { useSocial } from './useSocial'
import { challengeOf } from './test-social'

beforeEach(() => { useSocial.getState().reset(); h.nav.mockClear(); h.section = 'ranking' })
afterEach(cleanup)

describe('SocialScreen', () => {
  it('shows the section from the route and switches without piling up history', () => {
    render(<SocialScreen />)
    expect(screen.getByText('ranking panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ranking' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    expect(h.nav).toHaveBeenCalledWith('/social/amigos', { replace: true })
  })

  it('sends an unknown section to the ranking', () => {
    h.section = 'nope'
    render(<SocialScreen />)
    expect(screen.getByText('redirect /social/ranking')).toBeTruthy()
  })

  it('marks challenge invitations waiting for an answer', () => {
    useSocial.setState({ challenges: { status: 'ready', data: [challengeOf({ me: { joined: false, won: null } })], stale: false, error: null } })
    const { container } = render(<SocialScreen />)
    expect(container.querySelector('[data-slot="invite-dot"]')).toBeTruthy()
  })
})
