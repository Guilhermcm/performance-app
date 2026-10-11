// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), path: '/social/ranking' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ pathname: h.path }) }))

import TabBar from './TabBar'
import { DEF, useStore } from '../../store/useStore.js'
import { useSocial } from '../social/useSocial'
import { challengeOf } from '../social/test-social'
import { useCheckinFlow } from '../checkin/open-checkin'

beforeEach(() => {
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1' } })
  useSocial.getState().reset()
  h.nav.mockClear()
  h.path = '/social/ranking'
})
afterEach(() => { cleanup(); vi.useRealTimers(); useStore.setState({ user: null }) })

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

  it('counts challenge invitations on the social tab', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
    useSocial.setState({ challenges: { status: 'ready', data: [challengeOf({ me: { joined: false, won: null } })], stale: false, error: null } })
    render(<TabBar />)
    expect(screen.getByRole('button', { name: 'Social. Challenge invitations: 1' })).toBeTruthy()
  })

  it('does not count a nutrition invitation after its last day, while it is still active', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
    const invite = challengeOf({ template: 'nutrition_days_on_target', ends_on: '2026-10-18', me: { joined: false, won: null } })
    useSocial.setState({ challenges: { status: 'ready', data: [invite], stale: false, error: null } })
    render(<TabBar />)
    expect(screen.getByRole('button', { name: 'Social' })).toBeTruthy()
  })
})
