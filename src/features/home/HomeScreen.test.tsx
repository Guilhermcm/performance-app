// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), bwSheet: vi.fn(), weighInsSheet: vi.fn(), goalSheet: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../../sheets.jsx', () => ({
  bwSheet: h.bwSheet, weighInsSheet: h.weighInsSheet, goalSheet: h.goalSheet, bwDeltaColor: () => '',
  dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn(), starterPlanSheet: vi.fn()
}))
vi.mock('../../components/LineChart.jsx', () => ({ default: () => null }))

import { useStore } from '../../store/useStore.js'
import HomeScreen from './HomeScreen'

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
})
