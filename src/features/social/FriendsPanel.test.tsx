// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  createInvite: vi.fn(), cancelInvite: vi.fn(), removeFriend: vi.fn(), shareLink: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('./social-api', async orig => ({
  ...(await orig<typeof import('./social-api')>()),
  createInvite: h.createInvite, cancelInvite: h.cancelInvite, removeFriend: h.removeFriend
}))
vi.mock('./share', () => ({ shareLink: h.shareLink }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import FriendsPanel from './FriendsPanel'
import { useSocial } from './useSocial'
import { SocialError } from './social-api'
import { useStore } from '../../store/useStore.js'
import { BIA, ME, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, invites: ready([]) })
  useStore.setState({ user: { id: ME } })
  load.mockClear()
  ;[h.createInvite, h.cancelInvite, h.removeFriend, h.shareLink, h.toast, h.toast.success, h.toast.error].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }); useStore.setState({ user: null }) })

describe('FriendsPanel', () => {
  it('asks for both lists and shows the shape of the list while loading', () => {
    const { container } = render(<FriendsPanel />)
    expect(load).toHaveBeenCalledWith('friends')
    expect(load).toHaveBeenCalledWith('invites')
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('offers a retry when the list could not load', () => {
    useSocial.setState({ friends: { status: 'error', data: null, stale: false, error: 'network' } })
    render(<FriendsPanel />)
    expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeTruthy()
    load.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(load).toHaveBeenCalledWith('friends')
  })

  it('invites the first friend and copies the link where there is no share sheet', async () => {
    useSocial.setState({ friends: ready([]) })
    h.createInvite.mockResolvedValue({ code: 'AbCdEfGh12', expires_at: '2026-10-12T15:00:00Z' })
    h.shareLink.mockResolvedValue('copied')
    render(<FriendsPanel />)
    expect(screen.getByText('Training together pays off')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }))
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Invite link copied'))
    expect(h.shareLink.mock.calls[0][0]).toMatch(/#\/convite\/AbCdEfGh12$/)
    expect(load).toHaveBeenCalledWith('invites')
  })

  it('shows the link to copy by hand when nothing else worked', async () => {
    useSocial.setState({ friends: ready([]) })
    h.createInvite.mockResolvedValue({ code: 'AbCdEfGh12', expires_at: '2026-10-12T15:00:00Z' })
    h.shareLink.mockResolvedValue('failed')
    render(<FriendsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }))
    expect(await screen.findByDisplayValue(/#\/convite\/AbCdEfGh12$/)).toBeTruthy()
  })

  it('explains why an invite was refused', async () => {
    useSocial.setState({ friends: ready([]) })
    h.createInvite.mockRejectedValue(new SocialError('invite_limit'))
    render(<FriendsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite a friend' }))
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('You have 5 open invites. Cancel one or wait for one to expire.'))
  })

  it('lists friends with level, streak and week XP', () => {
    useSocial.setState({ friends: ready([friendOf(BIA, 'Bia')]) })
    render(<FriendsPanel />)
    const row = screen.getByRole('button', { name: /Bia/ })
    expect(within(row).getByText('Level 3')).toBeTruthy()
    expect(within(row).getByText('3 week streak')).toBeTruthy()
    expect(within(row).getByText('250 XP this week')).toBeTruthy()
  })

  it('opens a friend and removes them after a confirmation', async () => {
    useSocial.setState({ friends: ready([friendOf(BIA, 'Bia')]) })
    h.removeFriend.mockResolvedValue(undefined)
    render(<FriendsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /Bia/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText(/^Friends since /)).toBeTruthy()
    expect(within(sheet).getByRole('progressbar', { name: 'Level 3' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove friend' }))
    expect(within(sheet).getByText('Remove Bia as a friend? You will no longer see each other in the ranking or the feed.')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(h.removeFriend).toHaveBeenCalledWith(ME, BIA))
    expect(h.toast).toHaveBeenCalledWith('Bia removed from your friends')
  })

  it('cancels an open invite', async () => {
    useSocial.setState({
      friends: ready([friendOf(BIA, 'Bia')]),
      invites: ready([{ code: 'AbCdEfGh12', created_at: '2026-10-05T12:00:00Z', expires_at: '2026-10-12T12:00:00Z' }])
    })
    h.cancelInvite.mockResolvedValue(undefined)
    render(<FriendsPanel />)
    expect(screen.getByText(/^Expires /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(h.cancelInvite).toHaveBeenCalledWith('AbCdEfGh12'))
    expect(screen.queryByText(/^Expires /)).toBeNull()
  })
})
