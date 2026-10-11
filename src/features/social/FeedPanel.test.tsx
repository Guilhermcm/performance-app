// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('./test-drawer'))
const api = vi.hoisted(() => ({ signedUrls: vi.fn(async () => ({})), react: vi.fn() }))
vi.mock('../checkin/checkin-api', async orig => ({ ...(await orig<typeof import('../checkin/checkin-api')>()), ...api }))
vi.mock('./Comments', () => ({
  CommentsSheet: ({ id }: { id: string | null }) => (id ? <p>comments of {id}</p> : null)
}))

import FeedPanel from './FeedPanel'
import { useCheckins, type CheckinStore } from '../checkin/useCheckins'
import { useCheckinFlow } from '../checkin/open-checkin'
import { ME, checkinItemOf, workoutItemOf } from './test-social'
import { setLang } from '../../lib/i18n.js'

const real = { loadFeed: useCheckins.getState().loadFeed }
const loadFeed = vi.fn(async (_more?: boolean) => {})
const feed = (over: Partial<CheckinStore>) => useCheckins.setState({ feed: [], feedNext: null, feedStatus: 'ready', feedStale: false, ...over })
const settle = () => act(async () => { for (let i = 0; i < 3; i++) await Promise.resolve() })

beforeEach(() => {
  useCheckins.setState({ userId: ME, loadFeed })
  loadFeed.mockReset().mockResolvedValue(undefined)
  useCheckinFlow.setState({ open: false, opts: {} })
})
afterEach(() => { cleanup(); useCheckins.setState({ ...real, userId: null, feed: [], feedNext: null, feedStatus: 'idle', feedStale: false }) })

describe('FeedPanel', () => {
  it('asks for the first page of the check-in feed', () => {
    feed({})
    render(<FeedPanel />)
    expect(loadFeed).toHaveBeenCalledWith()
  })

  it('shows check-ins as posts and old workouts as they were', async () => {
    feed({ feed: [checkinItemOf('c1', { comments_count: 2 }), workoutItemOf(5, { prs: ['zz-custom'] })] })
    render(<FeedPanel />)
    expect(screen.getByRole('heading', { name: 'Musculação · Push' })).toBeTruthy()
    expect(screen.getByText('Bia finished a workout')).toBeTruthy()
    expect(screen.getByText(/18 sets/)).toBeTruthy()
    expect(screen.getByText('New personal record')).toBeTruthy()
    await settle()
  })

  it('opens the comments of a post', async () => {
    feed({ feed: [checkinItemOf('c1', { comments_count: 2 })] })
    render(<FeedPanel />)
    fireEvent.click(screen.getByRole('button', { name: '2 comments' }))
    expect(screen.getByText('comments of c1')).toBeTruthy()
    await settle()
  })

  it('loads more and says when everything was seen', async () => {
    feed({ feed: [checkinItemOf('c1')], feedNext: { before: '2026-10-10T12:00:00Z', before_key: 'checkin:c1' } })
    const { unmount } = render(<FeedPanel />)
    loadFeed.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(loadFeed).toHaveBeenCalledWith(true)
    await settle()
    unmount()
    feed({ feed: [checkinItemOf('c1')] })
    render(<FeedPanel />)
    expect(screen.getByText('You are all caught up.')).toBeTruthy()
    await settle()
  })

  it('does not claim the end of the feed from the saved copy', async () => {
    feed({ feed: [checkinItemOf('c1')], feedStale: true })
    render(<FeedPanel />)
    expect(screen.queryByText('You are all caught up.')).toBeNull()
    await settle()
  })

  it('shows skeletons in the shape of a post while the first page loads', () => {
    feed({ feedStatus: 'loading' })
    const { container } = render(<FeedPanel />)
    expect(container.querySelectorAll('[data-slot="post-skeleton"]').length).toBeGreaterThan(0)
  })

  it('invites to the first check-in and to bring friends when the feed is empty', () => {
    feed({})
    render(<FeedPanel />)
    expect(screen.getByText('Nothing here yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Make your first check-in' }))
    expect(useCheckinFlow.getState().open).toBe(true)
  })

  it('speaks Brazilian Portuguese when empty', async () => {
    await setLang('pt-BR')
    try {
      feed({})
      render(<FeedPanel />)
      expect(screen.getByText('Seus check-ins e os dos seus amigos aparecem aqui.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Faça seu primeiro check-in' })).toBeTruthy()
    } finally { await setLang('en') }
  })

  it('offers a retry when the feed could not load', () => {
    feed({ feedStatus: 'error' })
    render(<FeedPanel />)
    loadFeed.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(loadFeed).toHaveBeenCalledWith()
  })
})
