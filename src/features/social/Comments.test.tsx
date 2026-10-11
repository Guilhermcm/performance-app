// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))
const api = vi.hoisted(() => ({ fetchCheckin: vi.fn(), comment: vi.fn(), deleteComment: vi.fn() }))
vi.mock('../checkin/checkin-api', async orig => ({ ...(await orig<typeof import('../checkin/checkin-api')>()), ...api }))

import { CommentsSheet } from './Comments'
import { postView, usePostOverlay } from './post-state'
import { useCheckins } from '../checkin/useCheckins'
import { useProfile } from '../profile/useProfile'
import { SocialError } from './social-api'
import { BIA, CAIO, ME, checkinItemOf } from './test-social'
import type { CheckinComment, CheckinView } from './types'

const NOW = new Date('2026-10-10T14:00:00Z')
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const ana = { id: ME, name: 'Ana', avatar_url: null }
const bia = { id: BIA, name: 'Bia', avatar_url: null }
const caio = { id: CAIO, name: 'Caio', avatar_url: null }
const commentOf = (id: number, over: Partial<CheckinComment> = {}): CheckinComment =>
  ({ id, user: bia, body: 'Monstro!', created_at: '2026-10-10T12:30:00Z', can_delete: false, ...over })
const viewOf = (over: Partial<CheckinView> = {}): CheckinView => ({
  id: 'c1', user: bia, day: '2026-10-10', activity: 'strength', routine_name: null, title: 'Musculação · Push', caption: null,
  duration_min: 55, visibility: 'friends', photo_path: `${BIA}/c1.jpg`, created_at: '2026-10-10T12:00:00Z',
  reactions: [{ emoji: '💪', count: 2, mine: true, users: [ana, caio] }, { emoji: '🔥', count: 1, mine: false, users: [caio] }],
  comments: [commentOf(1, { user: caio, body: 'Bora!' }), commentOf(2, { user: ana, body: 'Valeu', can_delete: true })],
  ...over
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  usePostOverlay.setState({ by: {} })
  useCheckins.setState({ userId: ME })
  useProfile.setState({ profile: { id: ME, display_name: 'Ana', avatar_url: null } as never })
  api.fetchCheckin.mockReset().mockResolvedValue(viewOf())
  api.comment.mockReset().mockResolvedValue(7)
  api.deleteComment.mockReset().mockResolvedValue(undefined)
  h.toast.error.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers(); useCheckins.setState({ userId: null }); useProfile.setState({ profile: null }) })

describe('CommentsSheet', () => {
  it('loads the post with who reacted and the comments in the order they were sent', async () => {
    render(<CommentsSheet id="c1" onClose={vi.fn()} />)
    expect(api.fetchCheckin).toHaveBeenCalledWith('c1')
    await settle()
    const dialog = screen.getByRole('dialog')
    const who = within(dialog).getByRole('list', { name: 'Who reacted' })
    expect(within(who).getAllByRole('listitem').map(l => l.textContent)).toEqual(['💪Ana, Caio', '🔥Caio'])
    const list = within(dialog).getByRole('list', { name: 'Comments' })
    expect(within(list).getAllByRole('listitem').map(l => l.querySelector('p:last-child')?.textContent)).toEqual(['Bora!', 'Valeu'])
  })

  it('sends a comment, which shows at the end and counts on the card', async () => {
    const item = checkinItemOf('c1', { comments_count: 2 })
    render(<CommentsSheet id="c1" item={item} onClose={vi.fn()} />)
    await settle()
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    const field = screen.getByLabelText('Write a comment') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: '   ' } })
    expect(send.disabled).toBe(true)
    fireEvent.change(field, { target: { value: '  Que treino!  ' } })
    expect(screen.getByText('15/500')).toBeTruthy()
    fireEvent.click(send)
    await settle()
    expect(api.comment).toHaveBeenCalledWith('c1', 'Que treino!')
    const list = screen.getByRole('list', { name: 'Comments' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('Que treino!')).toBeTruthy()
    expect(field.value).toBe('')
    expect(postView(item).comments_count).toBe(3)
  })

  it('stops a comment at 500 characters', async () => {
    render(<CommentsSheet id="c1" onClose={vi.fn()} />)
    await settle()
    const field = screen.getByLabelText('Write a comment') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'a'.repeat(520) } })
    expect(field.value).toHaveLength(500)
  })

  it('deletes my own comment and leaves the others without a delete button', async () => {
    const item = checkinItemOf('c1', { comments_count: 2 })
    render(<CommentsSheet id="c1" item={item} onClose={vi.fn()} />)
    await settle()
    const buttons = screen.getAllByRole('button', { name: 'Delete comment' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    await settle()
    expect(api.deleteComment).toHaveBeenCalledWith(2)
    expect(screen.queryByText('Valeu')).toBeNull()
    expect(postView(item).comments_count).toBe(1)
  })

  it('keeps both comments deleted when two deletes finish out of order', async () => {
    const item = checkinItemOf('c1', { comments_count: 3 })
    api.fetchCheckin.mockResolvedValue(viewOf({ comments: [
      commentOf(1, { user: ana, body: 'Um', can_delete: true }), commentOf(2, { user: ana, body: 'Dois', can_delete: true }), commentOf(3, { user: caio, body: 'Três' })
    ] }))
    const done: Array<() => void> = []
    api.deleteComment.mockImplementation(() => new Promise<void>(r => { done.push(r) }))
    render(<CommentsSheet id="c1" item={item} onClose={vi.fn()} />)
    await settle()
    const [first, second] = screen.getAllByRole('button', { name: 'Delete comment' })
    fireEvent.click(first); fireEvent.click(second)
    await act(async () => { done[0]() })
    await act(async () => { done[1]() })
    expect(screen.queryByText('Um')).toBeNull()
    expect(screen.queryByText('Dois')).toBeNull()
    expect(screen.getByText('Três')).toBeTruthy()
    expect(postView(item).comments_count).toBe(1)
  })

  it('on my own post, deletes anyone’s comment', async () => {
    api.fetchCheckin.mockResolvedValue(viewOf({ user: ana, comments: [commentOf(1, { user: caio, body: 'Bora!', can_delete: true })] }))
    render(<CommentsSheet id="c1" onClose={vi.fn()} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }))
    await settle()
    expect(api.deleteComment).toHaveBeenCalledWith(1)
    expect(screen.getByText('No comments yet.')).toBeTruthy()
  })

  it('keeps the text when sending fails, and says why', async () => {
    api.comment.mockRejectedValueOnce(new SocialError('network'))
    render(<CommentsSheet id="c1" onClose={vi.fn()} />)
    await settle()
    const field = screen.getByLabelText('Write a comment') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'Boa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await settle()
    expect(field.value).toBe('Boa')
    expect(h.toast.error).toHaveBeenCalledWith('Could not reach the server. Check your connection and try again.')
  })

  it('says when the post is gone', async () => {
    api.fetchCheckin.mockRejectedValue(new SocialError('not_found'))
    render(<CommentsSheet id="c1" onClose={vi.fn()} />)
    await settle()
    expect(screen.getByText('This post is no longer available.')).toBeTruthy()
    expect(screen.queryByLabelText('Write a comment')).toBeNull()
  })

  it('is closed without a post', () => {
    render(<CommentsSheet id={null} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.fetchCheckin).not.toHaveBeenCalled()
  })
})
