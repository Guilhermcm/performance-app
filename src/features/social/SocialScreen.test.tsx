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
vi.mock('./NoticesList', () => ({ NoticesButton: () => <button type="button">notices button</button> }))

import SocialScreen from './SocialScreen'
import { useSocial } from './useSocial'
import { useCheckins } from '../checkin/useCheckins'
import { challengeOf } from './test-social'

const loadNotices = vi.fn(async () => {})
const real = { loadNotices: useCheckins.getState().loadNotices }
beforeEach(() => {
  useSocial.getState().reset(); h.nav.mockClear(); h.section = 'ranking'
  loadNotices.mockClear(); useCheckins.setState({ loadNotices })
})
afterEach(() => { cleanup(); vi.useRealTimers(); useCheckins.setState(real) })

describe('SocialScreen', () => {
  it('shows the section from the route and switches without piling up history', () => {
    render(<SocialScreen />)
    expect(screen.getByText('ranking panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ranking' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }))
    expect(h.nav).toHaveBeenCalledWith('/social/amigos', { replace: true })
  })

  it('puts the feed first and sends an unknown section to it', () => {
    h.section = 'feed'
    const { unmount } = render(<SocialScreen />)
    const tabs = screen.getByRole('navigation', { name: 'Social' })
    expect([...tabs.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Feed', 'Ranking', 'Challenges', 'Friends'])
    expect(screen.getByText('feed panel')).toBeTruthy()
    unmount()
    h.section = 'nope'
    render(<SocialScreen />)
    expect(screen.getByText('redirect /social/feed')).toBeTruthy()
  })

  it('has the notices at the top and refreshes them on arrival', () => {
    render(<SocialScreen />)
    expect(screen.getByRole('button', { name: 'notices button' })).toBeTruthy()
    expect(loadNotices).toHaveBeenCalledTimes(1)
  })

  it('marks challenge invitations waiting for an answer', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
    useSocial.setState({ challenges: { status: 'ready', data: [challengeOf({ me: { joined: false, won: null } })], stale: false, error: null } })
    const { container } = render(<SocialScreen />)
    expect(container.querySelector('[data-slot="invite-dot"]')).toBeTruthy()
  })

  it('drops the mark once the invitation can no longer be joined', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
    const invite = challengeOf({ template: 'nutrition_days_on_target', ends_on: '2026-10-18', me: { joined: false, won: null } })
    useSocial.setState({ challenges: { status: 'ready', data: [invite], stale: false, error: null } })
    const { container } = render(<SocialScreen />)
    expect(container.querySelector('[data-slot="invite-dot"]')).toBeNull()
  })
})
