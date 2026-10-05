// @vitest-environment happy-dom
// The header's avatar is the way into the Profile screen (/perfil): it shows the profile's initial
// (or photo), greets by the profile's name, and is only there for a signed-in account.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useProfile } from '../features/profile/useProfile.ts'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [], dayPlan: {}, workouts: [], active: null, week: {} } }))
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  useStore.setState({ user: null })
  useProfile.setState({ profile: null })
})

const mount = () => act(() => root.render(<Home />))
const avatar = () => host.querySelector('[data-testid="avatar-button"]')

describe('Home — avatar', () => {
  it('opens the Profile screen', () => {
    useStore.setState({ user: { id: 'u1', name: 'Guilherme Mendonca' } })
    useProfile.setState({ profile: { id: 'u1', display_name: 'Gui', avatar_url: null } })
    mount()
    expect(avatar().getAttribute('aria-label')).toBe('Profile')
    expect(avatar().textContent).toBe('G')
    expect(host.querySelector('h1').textContent).toBe('Hi Gui')
    act(() => { avatar().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(nav).toHaveBeenCalledWith('/perfil')
  })

  it('is not there without an account', () => {
    useStore.setState({ user: null })
    mount()
    expect(avatar()).toBeNull()
  })
})
