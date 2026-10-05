// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), getInvite: vi.fn(), acceptInvite: vi.fn(), signIn: vi.fn(), refresh: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useParams: () => ({ code: 'AbCdEfGh12' }) }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), getInvite: h.getInvite, acceptInvite: h.acceptInvite }))
vi.mock('../auth/auth', () => ({ signInWithGoogle: h.signIn }))
vi.mock('../gamification/useProgress', () => ({ useProgress: { getState: () => ({ refresh: h.refresh }) } }))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import InviteScreen from './InviteScreen'
import { useSocial } from './useSocial'
import { SocialError } from './social-api'
import { readPendingInvite, savePendingInvite } from './pending-invite'
import type { InviteInfo } from './types'

const CODE = 'AbCdEfGh12'
const open: InviteInfo = { status: 'open', expires_at: '2026-10-12T15:00:00Z', inviter: { name: 'Ana', avatar_url: null } }
const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)

beforeEach(() => {
  localStorage.clear()
  useSocial.getState().reset()
  useSocial.setState({ userId: 'u2', load })
  Object.values(h).forEach(f => f.mockReset())
  load.mockClear()
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('InviteScreen', () => {
  it('shows who invited before sign-in and keeps the code for after Google', async () => {
    h.getInvite.mockResolvedValue(open)
    render(<InviteScreen code={CODE} signedIn={false} />)
    expect(await screen.findByText('Ana invited you to train together')).toBeTruthy()
    expect(screen.getByText('Your weight, diet and loads stay private.')).toBeTruthy()
    expect(readPendingInvite()).toBe(CODE)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(h.signIn).toHaveBeenCalledTimes(1)
  })

  it('accepts by itself when coming back from Google with this invite', async () => {
    savePendingInvite(CODE)
    h.getInvite.mockResolvedValue(open)
    h.acceptInvite.mockResolvedValue({ id: 'a', name: 'Ana', avatar_url: null })
    render(<InviteScreen code={CODE} signedIn />)
    expect(await screen.findByText('You are friends now')).toBeTruthy()
    expect(screen.getByText('Ana is in your ranking now.')).toBeTruthy()
    expect(h.acceptInvite).toHaveBeenCalledWith(CODE)
    expect(readPendingInvite()).toBeNull()
    expect(load).toHaveBeenCalledWith('friends')
    expect(h.refresh).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create a challenge' }))
    expect(h.nav).toHaveBeenCalledWith('/social/desafios?novo=1', { replace: true })
  })

  it('asks a signed-in person who just opened the link to accept', async () => {
    h.getInvite.mockResolvedValue(open)
    h.acceptInvite.mockResolvedValue({ id: 'a', name: 'Ana', avatar_url: null })
    render(<InviteScreen code={CODE} signedIn />)
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invite' }))
    expect(await screen.findByText('You are friends now')).toBeTruthy()
  })

  it.each([
    ['expired', 'This invite has expired. Ask for a new link.'],
    ['used', 'Someone already used this invite. Ask for a new link.'],
    ['self', 'This is your own invite. Send it to a friend.'],
    ['already_friends', 'You are already friends.']
  ] as const)('explains an invite that is %s and forgets it', async (status, text) => {
    savePendingInvite(CODE)
    h.getInvite.mockResolvedValue({ ...open, status })
    render(<InviteScreen code={CODE} signedIn />)
    expect(await screen.findByText(text)).toBeTruthy()
    expect(readPendingInvite()).toBeNull()
    expect(h.acceptInvite).not.toHaveBeenCalled()
  })

  it('keeps the code and offers a retry when offline', async () => {
    savePendingInvite(CODE)
    h.getInvite.mockRejectedValue(new SocialError('network'))
    render(<InviteScreen code={CODE} signedIn />)
    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeTruthy()
    expect(readPendingInvite()).toBe(CODE)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(h.getInvite).toHaveBeenCalledTimes(2))
  })
})
