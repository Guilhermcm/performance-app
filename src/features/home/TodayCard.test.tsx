// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(), dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn(), openCheckinCamera: vi.fn()
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../../sheets.jsx', () => ({ dayOverrideSheet: h.dayOverrideSheet, calendarSheet: h.calendarSheet, startFlow: h.startFlow }))
vi.mock('../checkin/open-checkin', () => ({ openCheckinCamera: h.openCheckinCamera }))
vi.mock('../checkin/photo-src', () => ({
  useCheckinPhoto: (_photo: unknown, path: string | null) => ({ url: path ? 'https://photos/' + path : null, failed: false, fail() {}, retry() {} })
}))

import { useStore } from '../../store/useStore.js'
import { todayISO } from '../../lib/format.js'
import { useCheckins, type MyCheckin } from '../checkin/useCheckins'
import { useProfile } from '../profile/useProfile'
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

// A signed-in account checks in (phase 1c): the card shows today's routine or a rest day, and
// either the check-in made today, with its photo and title, or the way to make one. The live
// workout moved to the Plan.
describe('TodayCard with check-ins', () => {
  // Saturday 10/10/2026, noon in Sao Paulo.
  const TODAY = '2026-10-10'
  const row = (over: Partial<MyCheckin> = {}): MyCheckin => ({
    id: 'c1', day: TODAY, activity: 'strength', routine_id: 'r1', routine_name: 'Push', title: 'Push at the gym', caption: null,
    note: 'Left knee', duration_min: 55, visibility: 'friends', photo_path: 'u1/c1.jpg', detail: null, created_at: TODAY + 'T15:00:00Z', ...over
  })
  const signedIn = (mine: MyCheckin[] = []) => {
    useProfile.setState({ profile: { id: 'u1', timezone: 'America/Sao_Paulo', days_per_week: 3 } as never })
    useCheckins.setState({ userId: 'u1', mine, today: mine.filter(r => r.day === TODAY) })
  }

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T15:00:00Z')) })
  afterEach(() => {
    vi.useRealTimers()
    useCheckins.setState({ userId: null, mine: [], today: [] })
    useProfile.setState({ profile: null })
  })

  it("offers a check-in with today's routine", () => {
    setS({ week: everyDay })
    signedIn()
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Push')
    expect(screen.queryByTestId('today-tag')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Post a check-in' }))
    expect(h.openCheckinCamera).toHaveBeenCalledWith({ routineId: 'r1' })
    expect(h.startFlow).not.toHaveBeenCalled()
    // The live workout is reached from the Plan now.
    expect(screen.queryByRole('button', { name: /Choose a different workout/ })).toBeNull()
  })

  it('offers a check-in on a rest day too, without a routine', () => {
    setS()
    signedIn()
    render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Rest day')
    fireEvent.click(screen.getByRole('button', { name: 'Post a check-in' }))
    expect(h.openCheckinCamera).toHaveBeenCalledWith({})
    expect(h.dayOverrideSheet).not.toHaveBeenCalled()
  })

  it("shows today's check-in with its photo and title, and opens it in My workouts", () => {
    setS({ week: everyDay })
    signedIn([row()])
    const { container } = render(<TodayCard />)
    expect(screen.getByTestId('today-title').textContent).toBe('Push at the gym')
    expect(screen.getByTestId('today-tag').textContent).toBe('Done')
    const thumb = container.querySelector('[data-testid="today-thumb"] img') as HTMLImageElement
    expect(thumb.src).toBe('https://photos/u1/c1.jpg')
    expect(screen.queryByRole('button', { name: 'Post a check-in' })).toBeNull()
    fireEvent.click(screen.getByTestId('today-row'))
    expect(h.nav).toHaveBeenCalledWith('/plan/treinos', { state: { day: TODAY } })
  })

  it('says a check-in is still on its way up', () => {
    setS({ week: everyDay })
    signedIn([row({ pending: true, photo: new Blob(['x']) })])
    render(<TodayCard />)
    expect(screen.getByText('Sending…')).toBeTruthy()
  })

  it('links a live workout finished today without a check-in to the one it offers', () => {
    const w = { id: 'w1', d: TODAY, name: 'Push', routineId: 'r1', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }
    setS({ week: everyDay, workouts: [w] })
    signedIn()
    render(<TodayCard />)
    expect(screen.getByText('Workout logged. Check in so the day counts.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Post a check-in' }))
    expect(h.openCheckinCamera).toHaveBeenCalledWith({
      routineId: 'r1', fromWorkout: 'w1', detail: { entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }
    })
  })

  it('marks the days with a check-in as done in the week', () => {
    setS()
    signedIn([row({ id: 'c2', day: '2026-10-07' })])
    render(<TodayCard />)
    const wednesday = screen.getAllByRole('button').find(b => b.getAttribute('aria-label')?.startsWith('Wednesday 7'))!
    expect(wednesday.getAttribute('data-state')).toBe('done')
    expect(wednesday.getAttribute('aria-label')).toBe('Wednesday 7, Done')
  })

  it('still resumes a workout in progress', () => {
    setS({ week: everyDay, active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } })
    signedIn()
    render(<TodayCard />)
    expect(screen.getByTestId('today-tag').textContent).toBe('Resume')
    fireEvent.click(screen.getByTestId('today-row'))
    expect(h.nav).toHaveBeenCalledWith('/workout')
  })
})
