// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), fetchDays: vi.fn(), fetchPeriods: vi.fn(), fetchLogs: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./nutrition-api', async orig => ({
  ...(await orig<typeof import('./nutrition-api')>()), fetchDays: h.fetchDays, fetchPeriods: h.fetchPeriods, fetchLogs: h.fetchLogs
}))
vi.mock('./outbox', () => ({ enqueue: vi.fn(), flushOutbox: vi.fn(async () => ({ sent: 0, dropped: 0, reasons: [] })), pending: () => [], clearOutbox: vi.fn() }))

import HistoryScreen from './HistoryScreen'
import { useNutrition } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'
import { writeHistory, type Period } from './history'
import { ME, OTHER, targetOf } from './test-nutrition'
import type { NutritionDay, NutritionHistory, NutritionWeek } from './types'

// 2026-10-06 (a Tuesday) 15:00 UTC is noon in Sao Paulo.
const TODAY = '2026-10-06'
const SINCE_SEPT: Period[] = [{ started_on: '2026-09-20', ended_on: null }]
const realNutrition = useNutrition.getState()
const realProfile = useProfile.getState()
const realProgress = useProgress.getState()

const dayOf = (day: string, over: Partial<NutritionDay> = {}): NutritionDay => ({
  day, kcal: 2300, protein_g: 150, carbs_g: 260, fat_g: 70, meals: 3,
  target: { kcal: 2400, protein_g: 160, carbs_g: 270, fat_g: 70 },
  logged: true, on_target: true, balanced: false, imported: false, xp: 40, ...over
})
const weekOf = (start: string, over: Partial<NutritionWeek> = {}): NutritionWeek => ({ start, target: 5, on_target: 4, target_hit: false, ...over })
const historyOf = (days: NutritionDay[], weeks: NutritionWeek[]): NutritionHistory => ({ target: targetOf(), days, weeks })

const OCTOBER = historyOf(
  [dayOf('2026-10-01'), dayOf('2026-10-02', { on_target: false }), dayOf('2026-10-03', { logged: false, on_target: false, meals: 1 })],
  [weekOf('2026-09-28', { on_target: 5, target_hit: true }), weekOf('2026-10-05', { on_target: 0 })]
)
const SEPTEMBER = historyOf([dayOf('2026-09-21')], [weekOf('2026-09-21', { on_target: 4 })])

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const profile = (id = ME) => useProfile.setState({ status: 'ready', profile: { id, timezone: 'America/Sao_Paulo', nutrition_enabled: true } as never })
const streak = (current: number, best: number) => useProgress.setState({
  status: 'ready', progress: progressOf(700, {}, { nutrition: {
    target: 5, on_target: 1, logged: 2, streak: { current, best, shields: 0 }, confirms_on: '2026-10-08', last_closed: null, last_week: null
  } })
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  localStorage.clear()
  setOnline(true)
  h.nav.mockReset()
  h.fetchPeriods.mockReset().mockResolvedValue(SINCE_SEPT)
  h.fetchDays.mockReset().mockImplementation(async (from: string) => (from.startsWith('2026-10') ? OCTOBER : SEPTEMBER))
  h.fetchLogs.mockReset().mockResolvedValue([])
  profile()
  streak(3, 1)
  useNutrition.setState({ ...realNutrition, userId: ME, status: 'ready', targets: [targetOf({ valid_from: '2026-09-01' })], logs: {} })
})
afterEach(() => {
  cleanup(); vi.useRealTimers(); setOnline(true)
  useNutrition.setState(realNutrition); useProfile.setState({ ...realProfile, profile: null }); useProgress.setState(realProgress)
})

describe('HistoryScreen', () => {
  it('shows the current and the best streak on top', () => {
    render(<HistoryScreen />)
    expect(screen.getByRole('heading', { level: 1, name: 'Nutrition history' })).toBeTruthy()
    const top = screen.getByRole('group', { name: 'Streaks' })
    expect(within(top).getByText('Current streak').nextElementSibling?.textContent).toBe('3 weeks')
    expect(within(top).getByText('Best streak').nextElementSibling?.textContent).toBe('1 week')
  })

  it('reads the current month and names each day by its state, with icon and words', async () => {
    render(<HistoryScreen />)
    await screen.findByRole('button', { name: /1 October: On target/ })
    expect(h.fetchDays).toHaveBeenCalledTimes(1)
    expect(h.fetchDays).toHaveBeenCalledWith('2026-10-01', TODAY)
    expect(screen.getByRole('button', { name: /2 October: Logged, off target/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /3 October: Not logged/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /5 October: Still open/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /6 October: Still open/ }).getAttribute('aria-current')).toBe('date')
    // Days to come cannot be opened.
    expect(screen.getByRole('img', { name: /\b7 October: Not yet/ })).toBeTruthy()
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getAllByRole('listitem').map(li => li.textContent))
      .toEqual(['On target', 'Logged, off target', 'Not logged', 'Still open', 'Not tracked'])
  })

  it('sums each week up beside it, with a badge when the weekly goal was met', async () => {
    render(<HistoryScreen />)
    await screen.findByText('5/5 on target')
    expect(screen.getByText('0/5 on target')).toBeTruthy()
    expect(screen.getAllByText('Weekly goal met')).toHaveLength(1)
  })

  it('goes back month by month to the first period and no further', async () => {
    render(<HistoryScreen />)
    await screen.findByRole('button', { name: /1 October: On target/ })
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
    await screen.findByRole('button', { name: /21 September: On target/ })
    expect(h.fetchDays).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30')
    // Before the pillar was turned on: faded, not a button.
    expect(screen.getByRole('img', { name: /19 September: Not tracked/ })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains a month without any active day and asks the server nothing for it', async () => {
    h.fetchPeriods.mockResolvedValue([{ started_on: '2026-08-01', ended_on: '2026-08-31' }, { started_on: '2026-10-05', ended_on: null }])
    render(<HistoryScreen />)
    // October: only yesterday and today, both still open, so nothing closed to read.
    await screen.findByRole('button', { name: /5 October: Still open/ })
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByText('Nutrition was off this month, so no day counts here.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(h.fetchDays).not.toHaveBeenCalled()
  })

  it('explains that the history starts with the pillar when it was never on', async () => {
    h.fetchPeriods.mockResolvedValue([])
    render(<HistoryScreen />)
    expect(await screen.findByText('Your history starts the day you turn on Nutrition.')).toBeTruthy()
    expect(h.fetchDays).not.toHaveBeenCalled()
  })

  it('keeps months per account: a settled month is read from the phone, offline too', async () => {
    writeHistory({ userId: ME, periods: SINCE_SEPT, months: { '2026-09': { fetchedOn: TODAY, data: SEPTEMBER } } })
    setOnline(false)
    render(<HistoryScreen />)
    // The current month was never read on this phone.
    expect(await screen.findByText('Connect to see this month.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('button', { name: /21 September: On target/ })).toBeTruthy()
    expect(h.fetchPeriods).not.toHaveBeenCalled()
    expect(h.fetchDays).not.toHaveBeenCalled()
  })

  it('does not ask again for a settled month online, and shows another account nothing of it', async () => {
    writeHistory({ userId: ME, periods: SINCE_SEPT, months: { '2026-09': { fetchedOn: TODAY, data: SEPTEMBER } } })
    render(<HistoryScreen />)
    await screen.findByRole('button', { name: /1 October: On target/ })
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByRole('button', { name: /21 September: On target/ })
    expect(h.fetchDays).toHaveBeenCalledTimes(1)
    cleanup()

    profile(OTHER)
    setOnline(false)
    render(<HistoryScreen />)
    expect(await screen.findByText('Connect to see your history.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says when the month could not be read and tries again', async () => {
    h.fetchDays.mockRejectedValueOnce(new Error('boom'))
    render(<HistoryScreen />)
    expect(await screen.findByText('Could not load your history.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: /1 October: On target/ })).toBeTruthy()
  })

  it('opens the day sheet when a day is tapped', async () => {
    render(<HistoryScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /1 October: On target/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { name: /Thursday/ })).toBeTruthy()
    expect(within(sheet).getByText('+40 XP')).toBeTruthy()
  })

  it('goes back to the diary', () => {
    render(<HistoryScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith('/nutricao')
  })
})
