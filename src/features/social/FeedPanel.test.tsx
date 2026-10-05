// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import FeedPanel from './FeedPanel'
import { useSocial, type FeedState } from './useSocial'
import { useProfile } from '../profile/useProfile'
import { BIA, ME, feedItemOf, friendOf } from './test-social'

const real = { load: useSocial.getState().load, loadFeed: useSocial.getState().loadFeed }
const load = vi.fn(async () => null)
const loadFeed = vi.fn(async () => {})
const feed = (over: Partial<FeedState>) => useSocial.setState({ feed: { status: 'ready', items: [], next: null, stale: false, error: null, busy: false, ...over } })
const friends = (n: number) => useSocial.setState({ friends: { status: 'ready', data: n ? [friendOf(BIA, 'Bia')] : [], stale: false, error: null } })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, loadFeed })
  useProfile.setState({ profile: { share_activity: true } as never })
  ;[load, loadFeed, h.nav].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState(real); useProfile.setState({ profile: null }) })

describe('FeedPanel', () => {
  it('asks for the first page and the friends', () => {
    render(<FeedPanel />)
    expect(loadFeed).toHaveBeenCalledWith()
    expect(load).toHaveBeenCalledWith('friends')
  })

  it('shows finished workouts by day, with sets and records', () => {
    friends(1)
    feed({ items: [
      feedItemOf(2, { prs: ['zz-custom'] }),
      feedItemOf(1, { day: '2026-10-06', at: '2026-10-06T19:00:00Z', sets: null })
    ] })
    render(<FeedPanel />)
    expect(screen.getAllByText('Bia finished a workout')).toHaveLength(2)
    expect(screen.getByText(/18 sets/)).toBeTruthy()
    expect(screen.getByText('New personal record')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2)
  })

  it('keeps records of exercises this phone does not know in one chip', () => {
    friends(1)
    feed({ items: [feedItemOf(3, { prs: ['zz-a', 'zz-b'] })] })
    render(<FeedPanel />)
    expect(screen.getAllByText('New personal record')).toHaveLength(1)
  })

  it('loads more and says when everything was seen', () => {
    friends(1)
    feed({ items: [feedItemOf(2)], next: { before: '2026-10-07T18:30:00Z', before_id: 2 } })
    const { unmount } = render(<FeedPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(loadFeed).toHaveBeenCalledWith(true)
    unmount()
    feed({ items: [feedItemOf(2)] })
    render(<FeedPanel />)
    expect(screen.getByText('You are all caught up.')).toBeTruthy()
  })

  it('does not claim the end of the feed from the saved copy', () => {
    friends(1)
    feed({ items: [feedItemOf(2)], stale: true })
    render(<FeedPanel />)
    expect(screen.getByText('Bia finished a workout')).toBeTruthy()
    expect(screen.queryByText('You are all caught up.')).toBeNull()
  })

  it('asks to turn sharing on when mine is off', () => {
    useProfile.setState({ profile: { share_activity: false } as never })
    friends(1)
    feed({})
    render(<FeedPanel />)
    expect(screen.getByText('Your workouts are hidden from friends.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on sharing' }))
    expect(h.nav).toHaveBeenCalledWith('/perfil', { state: { focus: 'share_activity' } })
    expect(screen.queryByRole('button', { name: 'Check your sharing' })).toBeNull()
  })

  it('explains an empty feed with and without friends', () => {
    friends(1)
    feed({})
    const { unmount } = render(<FeedPanel />)
    expect(screen.getByText('Nothing here yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check your sharing' }))
    expect(h.nav).toHaveBeenCalledWith('/perfil', { state: { focus: 'share_activity' } })
    unmount()
    friends(0)
    render(<FeedPanel />)
    expect(screen.getByText('Training together pays off')).toBeTruthy()
  })

  it('offers a retry when the feed could not load', () => {
    feed({ status: 'error', error: 'network' })
    render(<FeedPanel />)
    loadFeed.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(loadFeed).toHaveBeenCalledWith()
  })
})
