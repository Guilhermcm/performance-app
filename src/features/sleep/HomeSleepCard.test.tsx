// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), toast: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import HomeSleepCard from './HomeSleepCard'
import { useSleep } from './useSleep'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { logOf, nightOf, targetOf } from './test-sleep'
import type { Profile } from '../profile/types'

// Sao Paulo is UTC-3: 2026-10-07 (a Wednesday) at HH:MM local is (HH+3):MM UTC.
const TODAY = '2026-10-07'
const at = (hhmm: string, day = TODAY) => {
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hh + 3, mm))
}
const realProfile = useProfile.getState()
const realSleep = useSleep.getState()
const saveNight = vi.fn(realSleep.saveNight)
const refresh = vi.fn(async () => {})

const profile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo', sleep_enabled: true, ...over } as unknown as Profile })
const card = () => screen.queryByTestId('home-sleep-card')
const asking = () => screen.queryByRole('heading', { name: 'How was your night?' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(at('07:30'))
  h.nav.mockReset(); h.toast.mockReset(); saveNight.mockClear(); refresh.mockClear()
  profile()
  useSleep.setState({ ...realSleep, saveNight, refresh, userId: null, status: 'ready', targets: [targetOf()], logs: {}, closed: [] })
})
afterEach(async () => {
  cleanup(); vi.useRealTimers()
  useProfile.setState(realProfile); useSleep.setState(realSleep)
  await setLang('en')
})

describe('HomeSleepCard', () => {
  it('asks about the night from 04:00 to 13:59 when it is not logged yet', () => {
    for (const [time, shown] of [['03:59', false], ['04:00', true], ['13:59', true], ['14:00', false]] as const) {
      vi.setSystemTime(at(time))
      render(<HomeSleepCard />)
      expect(!!asking(), time).toBe(shown)
      cleanup()
    }
  })

  it('goes away on the next minute at 14:00, without a reload', () => {
    vi.setSystemTime(at('13:59'))
    render(<HomeSleepCard />)
    expect(asking()).toBeTruthy()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(card()).toBeNull()
  })

  it('starts from the times of the last logged night', () => {
    useSleep.setState({ closed: [nightOf({ night: '2026-10-04', bed_time: '23:50', wake_time: '07:25' })] })
    render(<HomeSleepCard />)
    expect(screen.getByRole('button', { name: /Went to bed/ }).textContent).toContain('23:50')
    expect(screen.getByRole('button', { name: /Woke up/ }).textContent).toContain('07:25')
  })

  it('starts from the bedtime target and the goal with no night logged', () => {
    render(<HomeSleepCard />)
    expect(screen.getByRole('button', { name: /Went to bed/ }).textContent).toContain('23:00')
    expect(screen.getByRole('button', { name: /Woke up/ }).textContent).toContain('07:00')
  })

  it('saves today in one tap and turns into the summary of the night', async () => {
    await setLang('pt-BR')
    // A 7h30 goal: 7h 40 in bed from 23:20 is on target.
    useSleep.setState({ targets: [targetOf({ goal_min: 450 })], closed: [nightOf({ night: '2026-10-05', bed_time: '23:20', wake_time: '07:00' })] })
    render(<HomeSleepCard />)
    expect(screen.getByRole('heading', { name: 'Como foi a noite?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(saveNight).toHaveBeenCalledTimes(1)
    expect(saveNight.mock.calls[0][0]).toMatchObject({ night: TODAY, bed_time: '23:20', wake_time: '07:00' })
    expect(screen.getByText('7h 40 · no alvo')).toBeTruthy()
    // A Wednesday night closes on Friday.
    expect(screen.getByText('Confirma na sexta')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Editar/ })).toBeTruthy()
  })

  it('says why a night is off target', async () => {
    await setLang('pt-BR')
    useSleep.setState({ logs: { [TODAY]: logOf({ night: TODAY, bed_time: '00:10', wake_time: '07:20', duration_min: 430 }) } })
    render(<HomeSleepCard />)
    expect(screen.getByText('7h 10 · fora do alvo: deitou 1h10 depois do alvo')).toBeTruthy()
  })

  it('only says logged with no goal in force', () => {
    useSleep.setState({ targets: [], logs: { [TODAY]: logOf({ night: TODAY, bed_time: '23:20', wake_time: '07:00', duration_min: 460 }) } })
    render(<HomeSleepCard />)
    expect(screen.getByText('7h 40 · logged')).toBeTruthy()
  })

  it('keeps the summary for the rest of the day once the night is logged', () => {
    vi.setSystemTime(at('18:00'))
    useSleep.setState({ targets: [targetOf({ goal_min: 450 })], logs: { [TODAY]: logOf({ night: TODAY, bed_time: '23:20', wake_time: '07:00', duration_min: 460 }) } })
    render(<HomeSleepCard />)
    expect(screen.getByText('7h 40 · on target')).toBeTruthy()
    expect(asking()).toBeNull()
  })

  it('opens the sleep screen on a tap and the night on Edit', () => {
    useSleep.setState({ targets: [targetOf({ goal_min: 450 })], logs: { [TODAY]: logOf({ night: TODAY, bed_time: '23:20', wake_time: '07:00', duration_min: 460 }) } })
    render(<HomeSleepCard />)
    fireEvent.click(screen.getByRole('button', { name: /7h 40 · on target/ }))
    expect(h.nav).toHaveBeenCalledWith('/sono')
    fireEvent.click(screen.getByRole('button', { name: 'Edit night' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Edit night' })).toBeTruthy()
    expect(h.nav).toHaveBeenCalledTimes(1)
  })

  it('shows nothing with the pillar off', () => {
    profile({ sleep_enabled: false })
    useSleep.setState({ logs: { [TODAY]: logOf({ night: TODAY }) } })
    const { container } = render(<HomeSleepCard />)
    expect(container.innerHTML).toBe('')
  })
})
