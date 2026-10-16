// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ fetchHistory: vi.fn(), fetchPeriods: vi.fn() }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./habits-api', async orig => ({
  ...(await orig<typeof import('./habits-api')>()), fetchHistory: h.fetchHistory, fetchPeriods: h.fetchPeriods
}))

import HabitsHistory from './HabitsHistory'
import { useHabits } from './useHabits'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { H1, H2, ME, habitOf } from './test-habits'
import type { HabitHistory, HabitPeriod } from './types'
import type { Profile } from '../profile/types'

// Wednesday 2026-10-14 at 09:00 in Sao Paulo. The store holds the last 62 days: from 14 August.
const TODAY = '2026-10-14'
const SINCE_OCT: HabitPeriod[] = [{ started_on: '2026-10-01', ended_on: null }]
const SINCE_JULY: HabitPeriod[] = [{ started_on: '2026-07-10', ended_on: null }]
const realProfile = useProfile.getState()
const realHabits = useHabits.getState()
const toggleCheck = vi.fn()

const READ = habitOf({ id: H1, name: 'Read', per_week: 3, sort: 0 })
const RUN = habitOf({ id: H2, name: 'Run', icon: 'footprints', per_week: 2, sort: 1 })
const recent = (over: Partial<HabitHistory> = {}): HabitHistory => ({
  days: [{ day: '2026-10-05', checks: 2, valid: 2, xp: 232 }],
  checks: [{ habit_id: H1, day: '2026-10-05', counted: true }, { habit_id: H2, day: '2026-10-05', counted: true }],
  targets: [{ habit_id: H1, week_start: '2026-10-05', target: 3 }, { habit_id: H2, week_start: '2026-10-05', target: 2 }],
  periods: SINCE_OCT, ...over
})
const store = (over: Partial<ReturnType<typeof useHabits.getState>> = {}) =>
  useHabits.setState({ ...realHabits, toggleCheck, userId: ME, status: 'ready', habits: [READ, RUN], checks: [], recent: recent(), ...over })
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const prevButton = () => screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement
const nextButton = () => screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
  setOnline(true)
  localStorage.clear()
  toggleCheck.mockReset(); h.fetchHistory.mockReset(); h.fetchPeriods.mockReset()
  h.fetchPeriods.mockResolvedValue(SINCE_OCT)
  h.fetchHistory.mockResolvedValue(recent({ days: [], checks: [], targets: [] }))
  useProfile.setState({ status: 'ready', profile: { id: ME, timezone: 'America/Sao_Paulo', habits_enabled: true } as unknown as Profile })
  store()
})
afterEach(async () => {
  cleanup(); vi.useRealTimers(); setOnline(true)
  useProfile.setState(realProfile); useHabits.setState(realHabits)
  await setLang('en')
})

describe('HabitsHistory', () => {
  it('shows this month with no way past the first period, reading nothing the store holds', async () => {
    render(<HabitsHistory />)
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy()
    expect(prevButton().disabled).toBe(true)
    expect(nextButton().disabled).toBe(true)
    await waitFor(() => expect(h.fetchPeriods).toHaveBeenCalledTimes(1))
    expect(prevButton().disabled).toBe(true)
    expect(h.fetchHistory).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Monday 5 October: All checked, 2 checks counted' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Legend' })).toBeTruthy()
  })

  it('goes back month by month to the first period, reading a month older than the store holds', async () => {
    h.fetchPeriods.mockResolvedValue(SINCE_JULY)
    h.fetchHistory.mockResolvedValue(recent({
      days: [{ day: '2026-08-03', checks: 1, valid: 1, xp: 116 }], checks: [{ habit_id: H2, day: '2026-08-03', counted: true }],
      targets: [{ habit_id: H1, week_start: '2026-08-03', target: 3 }, { habit_id: H2, week_start: '2026-08-03', target: 2 }],
      periods: SINCE_JULY
    }))
    render(<HabitsHistory />)
    await waitFor(() => expect(prevButton().disabled).toBe(false))
    fireEvent.click(prevButton())
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
    // September starts after 14 August: the store already has it.
    expect(h.fetchHistory).not.toHaveBeenCalled()
    fireEvent.click(prevButton())
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeTruthy()
    await waitFor(() => expect(h.fetchHistory).toHaveBeenCalledWith('2026-08-01', '2026-08-31'))
    fireEvent.click(await screen.findByRole('button', { name: 'Monday 3 August: Partly checked, 1 check counted' }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getAllByRole('listitem').map(i => i.textContent)).toEqual(['Run'])
    expect(within(sheet).getByText('+116 XP')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    fireEvent.click(prevButton())
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeTruthy()
    expect(prevButton().disabled).toBe(true)
    fireEvent.click(nextButton())
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeTruthy()
  })

  it('opens a closed day in the day sheet', () => {
    render(<HabitsHistory />)
    fireEvent.click(screen.getByRole('button', { name: /^Monday 5 October: All checked/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading').textContent).toBe('Monday 5 October')
    expect(within(sheet).getAllByRole('listitem').map(i => i.textContent)).toEqual(['Read', 'Run'])
    expect(within(sheet).getAllByRole('button').map(b => b.textContent)).toEqual(['Close'])
  })

  it('opens yesterday with a check for each active habit', () => {
    store({ checks: [{ habit_id: H1, day: '2026-10-13', counted: null }] })
    render(<HabitsHistory />)
    fireEvent.click(screen.getByRole('button', { name: 'Tuesday 13 October: Still open, 1 check' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Run' }))
    expect(toggleCheck).toHaveBeenCalledWith(H2, '2026-10-13')
  })

  it('does not let a day outside the periods or still to come be picked', () => {
    render(<HabitsHistory />)
    expect(screen.queryByRole('button', { name: /^Wednesday 30 September/ })).toBeNull()
    expect(screen.getByRole('img', { name: 'Thursday 15 October: Not yet' })).toBeTruthy()
  })

  it('says a month was off, and when one is out of reach offline', async () => {
    h.fetchPeriods.mockResolvedValue([{ started_on: '2026-07-10', ended_on: '2026-07-31' }, ...SINCE_OCT])
    render(<HabitsHistory />)
    await waitFor(() => expect(prevButton().disabled).toBe(false))
    fireEvent.click(prevButton()); fireEvent.click(prevButton())
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeTruthy()
    expect(screen.getByText('Habits were off this month, so no day counts here.')).toBeTruthy()
    expect(h.fetchHistory).not.toHaveBeenCalled()
    cleanup()

    setOnline(false)
    h.fetchHistory.mockRejectedValue(new TypeError('Failed to fetch'))
    store({ recent: recent({ periods: SINCE_JULY }) })
    render(<HabitsHistory />)
    fireEvent.click(prevButton()); fireEvent.click(prevButton())
    expect(await screen.findByText('Connect to see this month.')).toBeTruthy()
  })

  it('offers a retry when a month could not load', async () => {
    h.fetchPeriods.mockResolvedValue(SINCE_JULY)
    h.fetchHistory.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<HabitsHistory />)
    await waitFor(() => expect(prevButton().disabled).toBe(false))
    fireEvent.click(prevButton()); fireEvent.click(prevButton())
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Could not load your history.')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(h.fetchHistory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
