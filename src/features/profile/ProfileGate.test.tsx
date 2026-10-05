// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const store = vi.hoisted(() => ({ state: { status: 'idle', profile: null, userId: null, load: vi.fn(), reset: vi.fn() } as any }))
vi.mock('./useProfile', () => ({ useProfile: (sel?: (s: unknown) => unknown) => (sel ? sel(store.state) : store.state) }))
vi.mock('./Onboarding', () => ({ default: () => <div>onboarding</div> }))
vi.mock('../../store/useStore.js', () => ({ useStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' } }) }))

import ProfileGate from './ProfileGate'

beforeEach(() => { store.state = { ...store.state, load: vi.fn(), reset: vi.fn() } })
afterEach(cleanup)

describe('ProfileGate', () => {
  it('loads the profile of the signed-in user', () => {
    store.state.status = 'idle'
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(store.state.load).toHaveBeenCalledWith('u1')
  })

  it('shows onboarding when the profile is missing', () => {
    store.state = { ...store.state, status: 'missing', userId: 'u1' }
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(screen.getByText('onboarding')).toBeTruthy()
  })

  it('shows the app when ready', () => {
    store.state = { ...store.state, status: 'ready', userId: 'u1', profile: { id: 'u1' } }
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(screen.getByText('app')).toBeTruthy()
  })

  it('offers a retry on error', () => {
    store.state = { ...store.state, status: 'error', userId: 'u1' }
    render(<ProfileGate><div>app</div></ProfileGate>)
    screen.getByRole('button', { name: /try again/i }).click()
    expect(store.state.load).toHaveBeenCalledWith('u1')
  })

  it('keeps onboarding on screen while it is finishing', () => {
    store.state = { ...store.state, status: 'ready', userId: 'u1', profile: { id: 'u1' }, onboarding: true }
    render(<ProfileGate><div>app</div></ProfileGate>)
    expect(screen.getByText('onboarding')).toBeTruthy()
  })
})
