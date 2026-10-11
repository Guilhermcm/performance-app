// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('./test-drawer'))
const api = vi.hoisted(() => ({ fetchChallengeFeed: vi.fn(), signedUrls: vi.fn(async () => ({})), react: vi.fn(), hideCheckin: vi.fn() }))
vi.mock('../checkin/checkin-api', async orig => ({ ...(await orig<typeof import('../checkin/checkin-api')>()), ...api }))
vi.mock('./Comments', () => ({
  CommentsSheet: ({ id }: { id: string | null }) => (id ? <p>comments of {id}</p> : null)
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import ChallengeFeed from './ChallengeFeed'
import { useCheckins } from '../checkin/useCheckins'
import { SocialError } from './social-api'
import { BIA, CAIO, ME, checkinItemOf } from './test-social'
import { setLang } from '../../lib/i18n.js'
import type { ChallengeFeedEntry, ChallengeFeedPage, PrivateCheckinItem } from './types'

const post = (id: string, over = {}): ChallengeFeedEntry => ({ ...checkinItemOf(id, over), private: false })
const stub = (id: string, over: Partial<PrivateCheckinItem> = {}): PrivateCheckinItem => ({
  type: 'checkin', key: `checkin:${id}`, at: '2026-10-10T09:00:00Z', day: '2026-10-10',
  user: { id: CAIO, name: 'Caio', avatar_url: null }, private: true, ...over
})
const page = (items: ChallengeFeedEntry[], next: ChallengeFeedPage['next'] = null): ChallengeFeedPage => ({ items, next })
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve() })

beforeEach(() => {
  useCheckins.setState({ userId: ME })
  ;[api.fetchChallengeFeed, api.react, api.hideCheckin, toast.success, toast.error].forEach(f => f.mockReset())
  api.hideCheckin.mockResolvedValue(undefined)
  api.signedUrls.mockClear()
})
afterEach(() => { cleanup(); useCheckins.setState({ userId: null }); void setLang('en') })

describe('ChallengeFeed', () => {
  it('asks for the first page of that challenge and shows a skeleton in the shape of a post meanwhile', async () => {
    let done!: (p: ChallengeFeedPage) => void
    api.fetchChallengeFeed.mockReturnValue(new Promise(r => { done = r }))
    const { container } = render(<ChallengeFeed id="c1" />)
    expect(api.fetchChallengeFeed).toHaveBeenCalledWith('c1', null)
    expect(container.querySelectorAll('[data-slot="post-skeleton"]').length).toBeGreaterThan(0)
    await act(async () => { done(page([post('p1')])) })
    expect(container.querySelector('[data-slot="post-skeleton"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Musculação · Push' })).toBeTruthy()
  })

  it('shows a post the person may see as the same card as the feed', async () => {
    api.fetchChallengeFeed.mockResolvedValue(page([post('p1', { comments_count: 2 })]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    expect(screen.getByRole('article', { name: 'Musculação · Push' })).toBeTruthy()
    expect(screen.getByText('Peito em dia')).toBeTruthy()
    expect(screen.getByText('Workout 3 this week · 6-week streak')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '2 comments' }))
    expect(screen.getByText('comments of p1')).toBeTruthy()
  })

  it('shows a private check-in as a compact row with the name and no photo', async () => {
    api.fetchChallengeFeed.mockResolvedValue(page([stub('s1'), post('p1')]))
    const { container } = render(<ChallengeFeed id="c1" />)
    await settle()
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Caio')
    expect(items[0].textContent).toContain('Private check-in')
    // No photo, title, caption or buttons on the stub: it is only a row.
    expect(items[0].querySelector('img')).toBeNull()
    expect(within(items[0]).queryByRole('button')).toBeNull()
    expect(within(items[0]).queryByRole('heading')).toBeNull()
    // Only the visible post asked for a photo link.
    expect(api.signedUrls).toHaveBeenCalledTimes(1)
    expect(api.signedUrls).toHaveBeenCalledWith([`${BIA}/p1.jpg`])
    expect(container.querySelectorAll('article')).toHaveLength(1)
  })

  it('says it in Brazilian Portuguese', async () => {
    await setLang('pt-BR')
    api.fetchChallengeFeed.mockResolvedValue(page([stub('s1')]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    expect(screen.getByText('Check-in privado')).toBeTruthy()
  })

  it('loads more from the cursor and stops when there is no next page', async () => {
    const next = { before: '2026-10-10T12:00:00Z', before_key: 'checkin:p1' }
    api.fetchChallengeFeed.mockResolvedValueOnce(page([post('p1')], next)).mockResolvedValueOnce(page([post('p2', { at: '2026-10-09T12:00:00Z' })]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await settle()
    expect(api.fetchChallengeFeed).toHaveBeenLastCalledWith('c1', next)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('does not repeat a post the next page sends again', async () => {
    const next = { before: '2026-10-10T12:00:00Z', before_key: 'checkin:p1' }
    api.fetchChallengeFeed.mockResolvedValueOnce(page([post('p1')], next)).mockResolvedValueOnce(page([post('p1'), post('p2', { title: 'Corrida' })]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await settle()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Musculação · Push', 'Corrida'])
  })

  it('has a starting point when nobody checked in yet', async () => {
    api.fetchChallengeFeed.mockResolvedValue(page([]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    expect(screen.getByText('No check-ins yet')).toBeTruthy()
    expect(screen.getByText('Check-ins from people in this challenge show up here.')).toBeTruthy()
  })

  it('says when it cannot load and tries again', async () => {
    api.fetchChallengeFeed.mockRejectedValueOnce(new SocialError('network')).mockResolvedValueOnce(page([post('p1')]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the server')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(screen.getByRole('heading', { name: 'Musculação · Push' })).toBeTruthy()
  })

  it('keeps what is shown when a later page fails, and lets the person retry', async () => {
    const next = { before: '2026-10-10T12:00:00Z', before_key: 'checkin:p1' }
    api.fetchChallengeFeed.mockResolvedValueOnce(page([post('p1')], next)).mockRejectedValueOnce(new SocialError('network'))
    render(<ChallengeFeed id="c1" />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await settle()
    expect(toast.error).toHaveBeenCalledWith('Could not reach the server. Check your connection and try again.')
    expect(screen.getByRole('heading', { name: 'Musculação · Push' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy()
  })

  it('hides a post from this list as well as from the feed', async () => {
    api.fetchChallengeFeed.mockResolvedValue(page([post('p1'), post('p2', { title: 'Corrida' })]))
    render(<ChallengeFeed id="c1" />)
    await settle()
    fireEvent.click(screen.getAllByRole('button', { name: 'Post options' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Hide this post' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Musculação · Push' })).toBeNull())
    expect(api.hideCheckin).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('heading', { name: 'Corrida' })).toBeTruthy()
  })

  it('starts over for another challenge and ignores a late answer for the old one', async () => {
    let late!: (p: ChallengeFeedPage) => void
    api.fetchChallengeFeed.mockReturnValueOnce(new Promise(r => { late = r })).mockResolvedValueOnce(page([post('p9', { title: 'Do outro' })]))
    const { rerender } = render(<ChallengeFeed id="c1" />)
    rerender(<ChallengeFeed id="c2" />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Do outro' })).toBeTruthy()
    await act(async () => { late(page([post('p1')])) })
    expect(screen.queryByRole('heading', { name: 'Musculação · Push' })).toBeNull()
    expect(api.fetchChallengeFeed).toHaveBeenLastCalledWith('c2', null)
  })
})
