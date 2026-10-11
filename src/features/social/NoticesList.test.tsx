// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))
vi.mock('./Comments', () => ({
  CommentsSheet: ({ id }: { id: string | null }) => (id ? <p>comments of {id}</p> : null)
}))

import { NoticesButton, NoticesList } from './NoticesList'
import { useCheckins } from '../checkin/useCheckins'
import { CAIO, ME, noticeOf } from './test-social'
import type { SocialNotice } from './types'
import { setLang } from '../../lib/i18n.js'

const NOW = new Date('2026-10-10T14:00:00Z')
const readNotices = vi.fn(async () => {})
const real = { readNotices: useCheckins.getState().readNotices }
const settle = () => act(async () => { for (let i = 0; i < 3; i++) await Promise.resolve() })
const caio = { id: CAIO, name: 'Caio', avatar_url: null }
const NOTICES: SocialNotice[] = [
  noticeOf(3, { kind: 'challenge_invite', checkin_id: null, checkin_title: null, challenge_id: 'ch1', challenge_title: 'Outubro forte' }),
  noticeOf(2, { kind: 'comment', actor: caio, checkin_title: null, checkin_id: 'gone' }),
  noticeOf(1, { read: true })
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  useCheckins.setState({ userId: ME, notices: NOTICES, unread: 2, readNotices })
  readNotices.mockReset().mockImplementation(async () => {
    useCheckins.setState(s => ({ notices: s.notices.map(n => ({ ...n, read: true })), unread: 0 }))
  })
  h.nav.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); useCheckins.setState({ userId: null, notices: [], unread: 0, ...real }) })

describe('NoticesList', () => {
  it('lists reactions, comments and invites, newest first, with the unread ones marked', () => {
    render(<NoticesList fresh={new Set([3, 2])} onOpenPost={vi.fn()} onOpenChallenge={vi.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items.map(i => i.querySelector('[data-slot="notice-text"]')?.textContent)).toEqual([
      'Bia invited you to “Outubro forte”',
      'Caio commented on your check-in',
      'Bia reacted to “Musculação · Push”'
    ])
    expect(within(items[0]).getByText('Unread')).toBeTruthy()
    expect(within(items[2]).queryByText('Unread')).toBeNull()
  })

  it('opens the post or the challenge a notice is about', () => {
    const onOpenPost = vi.fn(), onOpenChallenge = vi.fn()
    render(<NoticesList fresh={new Set()} onOpenPost={onOpenPost} onOpenChallenge={onOpenChallenge} />)
    fireEvent.click(screen.getByRole('button', { name: /Bia reacted to/ }))
    expect(onOpenPost).toHaveBeenCalledWith('c1')
    fireEvent.click(screen.getByRole('button', { name: /Outubro forte/ }))
    expect(onOpenChallenge).toHaveBeenCalledWith('ch1')
  })

  it('speaks Brazilian Portuguese', async () => {
    await setLang('pt-BR')
    try {
      render(<NoticesList fresh={new Set([3])} onOpenPost={vi.fn()} onOpenChallenge={vi.fn()} />)
      expect([...document.querySelectorAll('[data-slot="notice-text"]')].map(e => e.textContent)).toEqual([
        'Bia te convidou para “Outubro forte”',
        'Caio comentou no seu check-in',
        'Bia reagiu a “Musculação · Push”'
      ])
      expect(screen.getAllByText('Não lido')).toHaveLength(2)
    } finally { await setLang('en') }
  })

  it('explains an empty list', () => {
    useCheckins.setState({ notices: [] })
    render(<NoticesList fresh={new Set()} onOpenPost={vi.fn()} onOpenChallenge={vi.fn()} />)
    expect(screen.getByText('No notices yet')).toBeTruthy()
  })
})

describe('NoticesButton', () => {
  it('counts the unread notices and marks them read once opened, keeping the marks on screen', async () => {
    render(<NoticesButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Notices. Unread: 2' }))
    await settle()
    expect(readNotices).toHaveBeenCalledTimes(1)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText('Unread')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Notices' })).toBeTruthy()
  })

  it('opens the post of a notice in the comments, and a challenge on its page', async () => {
    render(<NoticesButton />)
    fireEvent.click(screen.getByRole('button', { name: /^Notices/ }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Bia reacted to/ }))
    expect(screen.getByText('comments of c1')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Notices/ }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Outubro forte/ }))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios/ch1')
  })
})
