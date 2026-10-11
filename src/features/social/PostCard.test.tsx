// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))
const api = vi.hoisted(() => ({ signedUrls: vi.fn(), react: vi.fn() }))
vi.mock('../checkin/checkin-api', async orig => ({ ...(await orig<typeof import('../checkin/checkin-api')>()), ...api }))

import { PostCard, PostSkeleton } from './PostCard'
import { usePostOverlay } from './post-state'
import { useCheckins } from '../checkin/useCheckins'
import { SocialError } from './social-api'
import { BIA, ME, checkinItemOf } from './test-social'
import type { ReactionGroup } from './types'
import { setLang } from '../../lib/i18n.js'

const NOW = new Date('2026-10-10T14:00:00Z')
const hide = vi.fn(async (_id: string) => {})
const realHide = useCheckins.getState().hide
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const photo = () => screen.getByTestId('post-photo')
const group = (n: number): ReactionGroup[] => Array.from({ length: n }, (_, i) => ({ emoji: String.fromCodePoint(0x1f600 + i), count: 1, mine: true }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  usePostOverlay.setState({ by: {} })
  useCheckins.setState({ userId: ME, hide })
  api.signedUrls.mockReset().mockImplementation(async (paths: string[]) => Object.fromEntries(paths.map(p => [p, 'https://cdn.test/' + p])))
  api.react.mockReset().mockResolvedValue(undefined)
  hide.mockReset().mockResolvedValue(undefined)
  h.toast.mockReset(); h.toast.success.mockReset(); h.toast.error.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers(); useCheckins.setState({ userId: null, hide: realHide }) })

describe('PostCard', () => {
  it('shows the photo through a signed link, with the title, caption, context and comments', async () => {
    const item = checkinItemOf('c1', { comments_count: 2, reactions: [{ emoji: '🔥', count: 3, mine: false }, { emoji: '💪', count: 1, mine: true }] })
    render(<PostCard item={item} onOpen={vi.fn()} />)
    expect(screen.getByText('Bia')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Musculação · Push' })).toBeTruthy()
    expect(screen.getByText('Peito em dia')).toBeTruthy()
    expect(screen.getByText('Workout 3 this week · 6-week streak')).toBeTruthy()
    expect(screen.getByText(/^2 hr\.? ago$/)).toBeTruthy()
    await settle()
    const img = screen.getByRole('img', { name: 'Photo by Bia: Musculação · Push' }) as HTMLImageElement
    expect(img.src).toBe(`https://cdn.test/${BIA}/c1.jpg`)
    expect(api.signedUrls).toHaveBeenCalledWith([`${BIA}/c1.jpg`])
    const fire = screen.getByRole('button', { name: '🔥: 3 reactions' })
    expect(fire.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '💪: 1 reaction' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '2 comments' })).toBeTruthy()
  })

  it('shows a skeleton the size of the photo until the link arrives, and asks once for many cards', async () => {
    render(<><PostCard item={checkinItemOf('c1')} onOpen={vi.fn()} /><PostCard item={checkinItemOf('c2')} onOpen={vi.fn()} /></>)
    expect(screen.getAllByTestId('post-photo')[0].querySelector('[data-slot="skeleton"]')).toBeTruthy()
    await settle()
    expect(api.signedUrls).toHaveBeenCalledTimes(1)
    expect(api.signedUrls.mock.calls[0][0]).toEqual([`${BIA}/c1.jpg`, `${BIA}/c2.jpg`])
  })

  it('says the context, comments and reactions in Brazilian Portuguese', async () => {
    await setLang('pt-BR')
    try {
      render(<PostCard item={checkinItemOf('c1', { comments_count: 1, reactions: [{ emoji: '🔥', count: 2, mine: false }] })} onOpen={vi.fn()} />)
      expect(screen.getByText('3º treino da semana · Sequência de 6 semanas')).toBeTruthy()
      expect(screen.getByRole('button', { name: '1 comentário' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '🔥: 2 reações' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Reagir com 💪' })).toBeTruthy()
      expect(screen.getByText('há 2 h')).toBeTruthy()
      await settle()
      expect(screen.getByRole('img', { name: 'Foto de Bia: Musculação · Push' })).toBeTruthy()
    } finally { await setLang('en') }
  })

  it('says when the photo cannot be loaded and tries again', async () => {
    api.signedUrls.mockRejectedValueOnce(new SocialError('network'))
    render(<PostCard item={checkinItemOf('c1')} onOpen={vi.fn()} />)
    await settle()
    expect(screen.getByText('Couldn’t load the photo.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(screen.getByRole('img', { name: 'Photo by Bia: Musculação · Push' })).toBeTruthy()
  })

  it('marks my own private post with a lock and the words, and offers no hide on it', () => {
    render(<PostCard item={checkinItemOf('c1', { user: { id: ME, name: 'Ana', avatar_url: null }, visibility: 'private' })} onOpen={vi.fn()} />)
    const lock = screen.getByText('Only me')
    expect(lock.parentElement?.querySelector('svg.lucide-lock')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Post options' })).toBeNull()
  })

  it('toggles 💪 with a double tap on the photo', async () => {
    const item = checkinItemOf('c1')
    render(<PostCard item={item} onOpen={vi.fn()} />)
    fireEvent.click(photo())
    expect(api.react).not.toHaveBeenCalled()
    fireEvent.click(photo())
    await settle()
    expect(api.react).toHaveBeenLastCalledWith('c1', '💪', true)
    expect(screen.getByRole('button', { name: '💪: 1 reaction' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(photo()); fireEvent.click(photo())
    await settle()
    expect(api.react).toHaveBeenLastCalledWith('c1', '💪', false)
    expect(screen.queryByRole('button', { name: '💪: 1 reaction' })).toBeNull()
  })

  it('has a 💪 button that does what the double tap does', async () => {
    render(<PostCard item={checkinItemOf('c1')} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'React with 💪' }))
    await settle()
    expect(api.react).toHaveBeenCalledWith('c1', '💪', true)
  })

  it('adds to a group of others and takes my reaction back', async () => {
    const item = checkinItemOf('c1', { reactions: [{ emoji: '🔥', count: 2, mine: false }] })
    render(<PostCard item={item} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '🔥: 2 reactions' }))
    await settle()
    expect(api.react).toHaveBeenCalledWith('c1', '🔥', true)
    fireEvent.click(screen.getByRole('button', { name: '🔥: 3 reactions' }))
    await settle()
    expect(api.react).toHaveBeenLastCalledWith('c1', '🔥', false)
    expect(screen.getByRole('button', { name: '🔥: 2 reactions' })).toBeTruthy()
  })

  it('reacts with any emoji from the picker', async () => {
    render(<PostCard item={checkinItemOf('c1')} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Paste any emoji'), { target: { value: '🦄' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use' }))
    await settle()
    expect(api.react).toHaveBeenCalledWith('c1', '🦄', true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: '🦄: 1 reaction' })).toBeTruthy()
  })

  it('blocks an 11th different emoji before it reaches the server', async () => {
    render(<PostCard item={checkinItemOf('c1', { reactions: group(10) })} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'React with 💪' }))
    await settle()
    expect(api.react).not.toHaveBeenCalled()
    expect(h.toast.error).toHaveBeenCalledWith('You already left 10 reactions here. Remove one to add another.')
    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
    expect(within(screen.getByRole('dialog')).getByText('You already left 10 reactions here. Remove one to add another.')).toBeTruthy()
  })

  it('puts the reaction back when the server refuses it', async () => {
    api.react.mockRejectedValueOnce(new SocialError('not_found'))
    render(<PostCard item={checkinItemOf('c1')} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'React with 💪' }))
    await settle()
    expect(screen.queryByRole('button', { name: '💪: 1 reaction' })).toBeNull()
    expect(h.toast.error).toHaveBeenCalledWith('This post is no longer available.')
  })

  it('opens the comments', () => {
    const onOpen = vi.fn()
    const item = checkinItemOf('c1')
    render(<PostCard item={item} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    expect(onOpen).toHaveBeenCalledWith(item)
  })

  it('hides a friend’s post just for me', async () => {
    render(<PostCard item={checkinItemOf('c1')} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hide this post' }))
    await settle()
    expect(hide).toHaveBeenCalledWith('c1')
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Post hidden.'))
  })

  it('shows a post still going up with the photo from this phone and no reactions yet', async () => {
    const blob = new Blob([new Uint8Array(4)], { type: 'image/jpeg' })
    const item = checkinItemOf('c9', { user: { id: ME, name: 'Ana', avatar_url: null }, pending: true, photo: blob, context: null })
    render(<PostCard item={item} onOpen={vi.fn()} />)
    expect(screen.getByText('Sending…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add reaction' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull()
    await settle()
    expect(api.signedUrls).not.toHaveBeenCalled()
    expect((screen.getByRole('img', { name: 'Photo by Ana: Musculação · Push' }) as HTMLImageElement).src).toMatch(/^blob:/)
  })
})

describe('PostSkeleton', () => {
  it('has the shape of a post: header, photo, title and reactions', () => {
    const { container } = render(<PostSkeleton />)
    const root = container.querySelector('[data-slot="post-skeleton"]')!
    expect(root.getAttribute('aria-busy')).toBe('true')
    expect(root.querySelector('.aspect-\\[4\\/5\\]')).toBeTruthy()
    expect(root.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(5)
  })
})
