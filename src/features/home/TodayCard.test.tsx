// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../../sheets.jsx', () => ({ dayOverrideSheet: h.dayOverrideSheet, calendarSheet: h.calendarSheet, startFlow: h.startFlow }))

import { useStore } from '../../store/useStore.js'
import { todayISO } from '../../lib/format.js'
import { TodayCard } from './TodayCard'

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]
const everyDay = { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }
const setS = (over: Record<string, unknown> = {}) =>
  useStore.setState((s: any) => ({ S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, week: {}, ...over } }))

beforeEach(() => Object.values(h).forEach(f => f.mockClear()))
afterEach(cleanup)

describe('TodayCard', () => {
  it("starts today's plan from the today row", () => {
    setS({ week: everyDay })
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Push')
    expect(screen.getByTestId('today-tag').textContent).toBe('Start')
    fireEvent.click(screen.getByTestId('today-row'))
    expect(h.startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('offers to plan a rest day', () => {
    setS()
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Rest day')
    fireEvent.click(screen.getByTestId('today-row'))
    expect(h.dayOverrideSheet).toHaveBeenCalledWith(todayISO())
  })

  it('reports a finished day as done', () => {
    setS({ week: everyDay, workouts: [{ id: 'w', d: todayISO(), name: 'Push', entries: [] }] })
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Push — done')
    expect(screen.getByTestId('today-tag').textContent).toBe('Done')
  })

  it('moves between weeks and opens a day', () => {
    setS()
    render(<TodayCard />)
    expect(screen.getByTestId('week-label').textContent).toBe('This week')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByTestId('week-label').textContent).not.toBe('This week')
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    const today = screen.getAllByRole('button').find(b => b.getAttribute('aria-current') === 'date')!
    fireEvent.click(today)
    expect(h.dayOverrideSheet).toHaveBeenCalledWith(todayISO())
  })

  it('opens the calendar and counts every workout', () => {
    setS({ workouts: [{ id: 'a', d: '2026-01-01', entries: [] }, { id: 'b', d: '2026-01-02', entries: [] }] })
    render(<TodayCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(h.calendarSheet).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 workouts total')).toBeTruthy()
  })
})
