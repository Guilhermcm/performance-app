// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  fetchNights: vi.fn(),
  fetchPeriods: vi.fn(),
  fetchTargets: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./sleep-api', async orig => ({
  ...(await orig<typeof import('./sleep-api')>()), fetchNights: h.fetchNights, fetchPeriods: h.fetchPeriods, fetchTargets: h.fetchTargets
}))

import SleepScreen from './SleepScreen'
import { droppedNoticeText, useSleep } from './useSleep'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { ME, logOf, nightOf, targetOf } from './test-sleep'
import type { Profile } from '../profile/types'
import type { SleepPeriod } from './types'

// 2026-10-07 (a Wednesday) at 07:30 in Sao Paulo.
const TODAY = '2026-10-07'
const SINCE_OCT: SleepPeriod[] = [{ started_on: '2026-10-01', ended_on: null }]
const realProfile = useProfile.getState()
const realSleep = useSleep.getState()
const refresh = vi.fn(async () => {})

const profile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo', sleep_enabled: true, sleep_nights_per_week: 5, ...over } as unknown as Profile })
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const sleep = (over: Partial<ReturnType<typeof useSleep.getState>> = {}) =>
  useSleep.setState({ ...realSleep, refresh, userId: ME, status: 'ready', stale: false, droppedNotice: false, logs: {}, closed: [], periods: SINCE_OCT, weeks: [], targets: [targetOf()], ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T10:30:00Z'))
  setOnline(true)
  localStorage.clear()
  ;[h.nav, h.toast, h.fetchNights, h.fetchPeriods, h.fetchTargets, refresh].forEach(f => f.mockReset())
  h.fetchNights.mockResolvedValue({ nights: [], weeks: [], periods: SINCE_OCT })
  h.fetchPeriods.mockResolvedValue(SINCE_OCT)
  h.fetchTargets.mockResolvedValue([targetOf()])
  profile()
  sleep({ closed: [nightOf({ night: '2026-10-04', bed_time: '23:10', wake_time: '07:00' })] })
})
afterEach(async () => {
  cleanup(); vi.useRealTimers(); setOnline(true)
  useProfile.setState(realProfile); useSleep.setState(realSleep)
  await setLang('en')
})

describe('SleepScreen', () => {
  it('invites to turn the pillar on when it is off, and opens the setup right here', async () => {
    await setLang('pt-BR')
    profile({ sleep_enabled: false })
    render(<SleepScreen />)
    expect(screen.queryByRole('heading', { name: 'Como foi a noite?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ligar o Sono' }))
    expect(h.nav).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Ligar o Sono' })).toBeTruthy()
  })

  it('puts the night form on top while today is not logged', async () => {
    await setLang('pt-BR')
    render(<SleepScreen />)
    expect(screen.getByRole('heading', { name: 'Como foi a noite?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
  })

  it('shows the night once it is logged, with its times, its quality and Edit', async () => {
    await setLang('pt-BR')
    sleep({ logs: { [TODAY]: logOf({ night: TODAY, bed_time: '23:20', wake_time: '07:00', duration_min: 460, quality: 4 }) } })
    render(<SleepScreen />)
    expect(screen.queryByRole('heading', { name: 'Como foi a noite?' })).toBeNull()
    const top = screen.getByTestId('sleep-last-night')
    expect(within(top).getByText('7h 40')).toBeTruthy()
    expect(within(top).getByText('deitou 23:20 · acordou 07:00')).toBeTruthy()
    expect(within(top).getByText('Boa')).toBeTruthy()
    expect(within(top).getByText('A confirmar')).toBeTruthy()
    fireEvent.click(within(top).getByRole('button', { name: /Editar/ }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Editar a noite' })).toBeTruthy()
  })

  it('shows an older night without Edit, under the form for today', async () => {
    await setLang('pt-BR')
    sleep({ closed: [nightOf({ night: '2026-10-05', bed_time: '23:20', wake_time: '07:00', duration_min: 460 })] })
    render(<SleepScreen />)
    expect(screen.getByRole('heading', { name: 'Como foi a noite?' })).toBeTruthy()
    const top = screen.getByTestId('sleep-last-night')
    expect(within(top).getByText('deitou 23:20 · acordou 07:00')).toBeTruthy()
    expect(within(top).getByText('No alvo')).toBeTruthy()
    expect(within(top).queryByRole('button', { name: /Editar/ })).toBeNull()
  })

  it('lets yesterday be edited while it is still open', () => {
    sleep({ logs: { '2026-10-06': logOf({ night: '2026-10-06', bed_time: '23:20', wake_time: '07:00', duration_min: 460 }) } })
    render(<SleepScreen />)
    expect(within(screen.getByTestId('sleep-last-night')).getByRole('button', { name: /Edit/ })).toBeTruthy()
  })

  it('shows the shape of the screen while the first load runs', () => {
    sleep({ status: 'loading', closed: [] })
    render(<SleepScreen />)
    expect(screen.getByTestId('sleep-skeleton').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.queryByTestId('sleep-stats')).toBeNull()
  })

  it('asks for the first night when nothing was logged yet', async () => {
    await setLang('pt-BR')
    sleep({ closed: [] })
    render(<SleepScreen />)
    expect(screen.getByRole('heading', { name: 'Registre sua primeira noite' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
    expect(screen.queryByTestId('sleep-last-night')).toBeNull()
  })

  it('shows the saved copy offline and still lets the night be logged', async () => {
    await setLang('pt-BR')
    setOnline(false)
    sleep({ stale: true, closed: [nightOf({ night: '2026-10-05', bed_time: '23:20', wake_time: '07:00', duration_min: 460 })] })
    render(<SleepScreen />)
    expect(screen.getByText(/^Sem conexão/)).toBeTruthy()
    expect(within(screen.getByTestId('sleep-last-night')).getByText('deitou 23:20 · acordou 07:00')).toBeTruthy()
    expect(screen.getByTestId('sleep-stats')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('offers a retry when the nights could not load and nothing is saved', () => {
    sleep({ status: 'error', closed: [] })
    render(<SleepScreen />)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says once that nights of closed days were not saved', () => {
    sleep({ droppedNotice: true })
    render(<SleepScreen />)
    expect(h.toast).toHaveBeenCalledWith(droppedNoticeText())
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(useSleep.getState().droppedNotice).toBe(false)
  })

  it('shows the four numbers and leaves room for the charts', () => {
    const { container } = render(<SleepScreen />)
    expect(screen.getAllByTestId(/^sleep-stat-/)).toHaveLength(4)
    const charts = container.querySelector('[data-slot="sleep-charts"]')
    expect(charts).toBeTruthy()
    expect(charts?.childElementCount).toBe(0)
  })

  it('shows the month of nights, going back no further than the first period', async () => {
    render(<SleepScreen />)
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(h.fetchPeriods).toHaveBeenCalledTimes(1))
    // The store already holds the closed nights of the last 62 days: nothing more to read.
    expect(h.fetchNights).not.toHaveBeenCalled()
  })

  it('goes back to an earlier period and reads a month older than the store holds', async () => {
    h.fetchPeriods.mockResolvedValue([{ started_on: '2026-07-10', ended_on: null }])
    h.fetchNights.mockResolvedValue({ nights: [nightOf({ night: '2026-08-03', xp: 120 })], weeks: [], periods: [{ started_on: '2026-07-10', ended_on: null }] })
    render(<SleepScreen />)
    const prev = screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement
    await waitFor(() => expect(prev.disabled).toBe(false))
    fireEvent.click(prev)
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
    expect(h.fetchNights).not.toHaveBeenCalled()
    fireEvent.click(prev)
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeTruthy()
    await waitFor(() => expect(h.fetchNights).toHaveBeenCalledWith('2026-08-01', '2026-08-31'))
    fireEvent.click(await screen.findByRole('button', { name: /^Monday 3 August: On target/ }))
    expect(within(screen.getByRole('dialog')).getByText('+120 XP')).toBeTruthy()
    fireEvent.click(prev)
    expect(screen.getByRole('heading', { name: 'July 2026' })).toBeTruthy()
    expect(prev.disabled).toBe(true)
  })

  it('says when a month is out of reach offline', async () => {
    setOnline(false)
    h.fetchNights.mockRejectedValue(new TypeError('Failed to fetch'))
    sleep({ periods: [{ started_on: '2026-07-10', ended_on: null }] })
    render(<SleepScreen />)
    const prev = screen.getByRole('button', { name: 'Previous month' })
    fireEvent.click(prev); fireEvent.click(prev)
    expect(await screen.findByText('Connect to see this month.')).toBeTruthy()
  })

  it('opens a closed night from the calendar, and today in the log sheet', async () => {
    sleep({ closed: [nightOf({ night: '2026-10-04', xp: 130 })] })
    render(<SleepScreen />)
    fireEvent.click(screen.getByRole('button', { name: /^Sunday 4 October: On target/ }))
    let sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('+130 XP')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Wednesday 7 October: Still open/ }))
    sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { name: 'Log night' })).toBeTruthy()
  })
})
