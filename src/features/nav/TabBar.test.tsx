// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), path: '/social/ranking' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ pathname: h.path }) }))

import TabBar from './TabBar'
import { DEF, useStore } from '../../store/useStore.js'
import { useCheckins } from '../checkin/useCheckins'
import { useCheckinFlow, registerCheckinCamera } from '../checkin/open-checkin'

beforeEach(() => {
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1' } })
  useCheckins.setState({ unread: 0 })
  h.nav.mockClear()
  h.path = '/social/ranking'
})
afterEach(() => { cleanup(); useStore.setState({ user: null }); useCheckins.setState({ unread: 0 }) })

const tab = (name: RegExp) => screen.getByRole('button', { name })

describe('TabBar', () => {
  it('opens the check-in panel from the center button, which shows a camera', () => {
    useCheckinFlow.setState({ open: false, opts: {} })
    render(<TabBar />)
    const center = tab(/^Check-in$/)
    expect(center.querySelector('svg.lucide-camera')).toBeTruthy()
    fireEvent.click(center)
    expect(useCheckinFlow.getState()).toMatchObject({ open: true, opts: {} })
    expect(h.nav).not.toHaveBeenCalled()
  })

  it('opens the rear camera in the same tap, through the input already on the page', () => {
    const camera = document.createElement('input')
    camera.type = 'file'
    camera.setAttribute('capture', 'environment')
    // Whether the panel was asked to open by the time the camera was.
    const click = vi.fn(() => useCheckinFlow.getState().open)
    camera.click = click
    registerCheckinCamera(camera)
    try {
      useCheckinFlow.setState({ open: false, opts: {} })
      render(<TabBar />)
      fireEvent.click(tab(/^Check-in$/))
      expect(click).toHaveBeenCalledTimes(1)
      expect(click.mock.results[0].value).toBe(true)
    } finally { registerCheckinCamera(null) }
  })

  it('has no check-in button without a signed-in account, since the panel is not mounted for it', () => {
    useStore.setState({ user: null })
    localStorage.setItem('gym_guest', '1')
    try {
      render(<TabBar />)
      expect(screen.queryByRole('button', { name: /^Check-in$/ })).toBeNull()
      expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Home', 'Plan', 'Nutrition', 'Social'])
    } finally { localStorage.removeItem('gym_guest') }
  })

  it('no longer turns into Resume during a workout: the Plan has it', () => {
    useStore.setState({ S: { ...useStore.getState().S, active: { id: 'a', name: 'Push', entries: [], cur: 0 } } })
    render(<TabBar />)
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull()
    expect(tab(/^Check-in$/)).toBeTruthy()
  })

  it('has Home, Plan, Check-in, Nutrition and Social, and opens the social area', () => {
    render(<TabBar />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Home', 'Plan', 'Check-in', 'Nutrition', 'Social'])
    expect(tab(/Social/).className).toBe('on')
    fireEvent.click(tab(/Social/))
    expect(h.nav).toHaveBeenCalledWith('/social')
  })

  it('lights Plan on the exercise library, and Social on an invite', () => {
    h.path = '/library'
    const { unmount } = render(<TabBar />)
    expect(tab(/Plan/).className).toBe('on')
    unmount()
    h.path = '/convite/AbCdEfGh12'
    render(<TabBar />)
    expect(tab(/Social/).className).toBe('on')
  })

  it('lights Plan on Stats, History, Structural balance and the live workout, and Nutrition on the diary', () => {
    for (const path of ['/stats', '/history', '/structural-balance', '/workout']) {
      h.path = path
      const { unmount } = render(<TabBar />)
      expect(tab(/Plan/).className).toBe('on')
      unmount()
    }
    h.path = '/nutricao'
    render(<TabBar />)
    expect(tab(/Nutrition/).className).toBe('on')
    expect(tab(/Plan/).className).toBe('')
    fireEvent.click(tab(/Nutrition/))
    expect(h.nav).toHaveBeenCalledWith('/nutricao')
  })

  it('lights Home on the Sleep screen, which opens from Home and the profile', () => {
    h.path = '/sono'
    render(<TabBar />)
    expect(tab(/Home/).className).toBe('on')
    expect(tab(/Nutrition/).className).toBe('')
  })

  it('counts unread notices and pending invitations on the social tab', () => {
    useCheckins.setState({ unread: 3 })
    render(<TabBar />)
    const social = screen.getByRole('button', { name: 'Social. Notices: 3' })
    expect(social.textContent).toContain('3')
  })

  it('shows no counter with nothing new, and 9+ past nine', () => {
    const { unmount } = render(<TabBar />)
    expect(screen.getByRole('button', { name: 'Social' })).toBeTruthy()
    unmount()
    useCheckins.setState({ unread: 12 })
    render(<TabBar />)
    expect(screen.getByRole('button', { name: 'Social. Notices: 12' }).textContent).toContain('9+')
  })
})
