// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), path: '/social/ranking' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ pathname: h.path }) }))

import TabBar from './TabBar'
import { DEF, useStore } from '../../store/useStore.js'
import { useSocial } from '../social/useSocial'
import { challengeOf } from '../social/test-social'

beforeEach(() => {
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1' } })
  useSocial.getState().reset()
  h.nav.mockClear()
  h.path = '/social/ranking'
})
afterEach(() => { cleanup(); useStore.setState({ user: null }) })

const tab = (name: RegExp) => screen.getByRole('button', { name })

describe('TabBar', () => {
  it('has Home, Plan, Start, Nutrition and Social, and opens the social area', () => {
    render(<TabBar onStart={() => {}} />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Home', 'Plan', 'Start', 'Nutrition', 'Social'])
    expect(tab(/Social/).className).toBe('on')
    fireEvent.click(tab(/Social/))
    expect(h.nav).toHaveBeenCalledWith('/social')
  })

  it('lights Plan on the exercise library, and Social on an invite', () => {
    h.path = '/library'
    const { unmount } = render(<TabBar onStart={() => {}} />)
    expect(tab(/Plan/).className).toBe('on')
    unmount()
    h.path = '/convite/AbCdEfGh12'
    render(<TabBar onStart={() => {}} />)
    expect(tab(/Social/).className).toBe('on')
  })

  it('lights Plan on Stats, History and Structural balance, and Nutrition on the diary', () => {
    for (const path of ['/stats', '/history', '/structural-balance']) {
      h.path = path
      const { unmount } = render(<TabBar onStart={() => {}} />)
      expect(tab(/Plan/).className).toBe('on')
      unmount()
    }
    h.path = '/nutricao'
    render(<TabBar onStart={() => {}} />)
    expect(tab(/Nutrition/).className).toBe('on')
    expect(tab(/Plan/).className).toBe('')
    fireEvent.click(tab(/Nutrition/))
    expect(h.nav).toHaveBeenCalledWith('/nutricao')
  })

  it('counts challenge invitations on the social tab', () => {
    useSocial.setState({ challenges: { status: 'ready', data: [challengeOf({ me: { joined: false, won: null } })], stale: false, error: null } })
    render(<TabBar onStart={() => {}} />)
    expect(screen.getByRole('button', { name: 'Social. Challenge invitations: 1' })).toBeTruthy()
  })
})
