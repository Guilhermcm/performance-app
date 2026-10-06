// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), bwSheet: vi.fn(), weighInsSheet: vi.fn(), goalSheet: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../../sheets.jsx', () => ({
  bwSheet: h.bwSheet, weighInsSheet: h.weighInsSheet, goalSheet: h.goalSheet, bwDeltaColor: () => '',
  dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn(), starterPlanSheet: vi.fn()
}))
vi.mock('../../components/LineChart.jsx', () => ({ default: () => null }))

import { useStore } from '../../store/useStore.js'
import HomeScreen from './HomeScreen'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'
import { RADAR_CARD } from './PillarRadarSkeleton'

const setS = (over: Record<string, unknown> = {}, user: unknown = null) =>
  useStore.setState((s: any) => ({ S: { ...s.S, routines: [], dayPlan: {}, workouts: [], bodyweight: [], active: null, week: {}, ...over }, user }))

beforeEach(() => Object.values(h).forEach(f => f.mockClear()))
afterEach(() => { cleanup(); useStore.setState({ user: null }) })

describe('HomeScreen', () => {
  it('shows the progress card only to a signed-in account', () => {
    setS()
    const { container, unmount } = render(<HomeScreen />)
    expect(container.querySelector('[data-slot="progress-hero"]')).toBeNull()
    unmount()
    setS({}, { id: 'u1', name: 'Ana' })
    const again = render(<HomeScreen />)
    expect(again.container.querySelector('[data-slot="progress-hero"]')).toBeTruthy()
  })

  it('opens Stats from the header', () => {
    setS()
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }))
    expect(h.nav).toHaveBeenCalledWith('/stats')
  })

  it('opens the gym check-in and hides it when switched off', () => {
    setS({ checkIn: true })
    render(<HomeScreen />)
    fireEvent.click(screen.getByTestId('checkin-card'))
    expect(h.nav).toHaveBeenCalledWith('/checkin')
    cleanup()
    setS({ checkIn: false })
    render(<HomeScreen />)
    expect(screen.queryByTestId('checkin-card')).toBeNull()
  })

  it('logs a weigh-in, sets a goal and lists every weigh-in', () => {
    setS({ bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }, { d: '2026-10-03', w: 79.5, t: 2 }], unit: 'kg' })
    render(<HomeScreen />)
    expect(screen.getByRole('heading', { name: 'Body weight' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }))
    fireEvent.click(screen.getByRole('button', { name: 'All weigh-ins' }))
    expect(h.bwSheet).toHaveBeenCalledTimes(1)
    expect(h.goalSheet).toHaveBeenCalledTimes(1)
    expect(h.weighInsSheet).toHaveBeenCalledTimes(1)
  })

  it('shows the nutrition card to a signed-in account with a profile', () => {
    localStorage.clear()
    setS({}, { id: 'u1', name: 'Ana' })
    useProfile.setState({ profile: { timezone: 'America/Sao_Paulo', nutrition_enabled: false } as never })
    try {
      render(<HomeScreen />)
      expect(screen.getByText('Track what you eat')).toBeTruthy()
    } finally {
      useProfile.setState({ profile: null })
    }
  })

  it('holds the radar in a skeleton of the same size while its chunk loads', async () => {
    setS({}, { id: 'u1', name: 'Ana' })
    useProfile.setState({ profile: { timezone: 'America/Sao_Paulo', nutrition_enabled: true } as never })
    useProgress.setState({ status: 'ready', progress: progressOf(400), userId: 'u1' })
    try {
      const { container } = render(<HomeScreen />)
      const skeleton = container.querySelector<HTMLElement>('[data-slot="pillar-radar"][aria-busy="true"]')!
      expect(skeleton).toBeTruthy()
      expect(skeleton.className).toContain(RADAR_CARD)
      const radar = await waitFor(() => {
        const el = container.querySelector<HTMLElement>('[data-slot="pillar-radar"]:not([aria-busy])')
        if (!el) throw new Error('radar not loaded yet')
        return el
      })
      expect(radar.className).toContain(RADAR_CARD)
      expect(container.querySelector('[data-slot="pillar-radar"][aria-busy="true"]')).toBeNull()
    } finally {
      useProfile.setState({ profile: null })
      useProgress.getState().reset()
    }
  })

  it('keeps the skeleton for a cached progress from before the radar', () => {
    setS({}, { id: 'u1', name: 'Ana' })
    useProfile.setState({ profile: { timezone: 'America/Sao_Paulo', nutrition_enabled: true } as never })
    useProgress.setState({ status: 'ready', progress: { ...progressOf(400), radar: undefined } as never, userId: 'u1' })
    try {
      const { container } = render(<HomeScreen />)
      expect(container.querySelector('[data-slot="pillar-radar"][aria-busy="true"]')).toBeTruthy()
    } finally {
      useProfile.setState({ profile: null })
      useProgress.getState().reset()
    }
  })
})
