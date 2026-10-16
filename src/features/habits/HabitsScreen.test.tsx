// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
// The setup turns the pillar on through the profile; here only whether it opens matters.
vi.mock('./HabitsSetup', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="habits-setup" /> : null)
}))

import HabitsScreen from './HabitsScreen'
import { droppedNoticeText, useHabits } from './useHabits'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'
import { setLang } from '../../lib/i18n.js'
import { habitOf, H1, H2, ME } from './test-habits'
import type { Habit, HabitCheck } from './types'
import type { Profile } from '../profile/types'

// Wednesday 2026-10-14 at 09:00 in Sao Paulo (UTC-3), in the week of Monday 2026-10-12.
const MONDAY = '2026-10-12'
const TUESDAY = '2026-10-13'
const TODAY = '2026-10-14'
const realProfile = useProfile.getState()
const realHabits = useHabits.getState()
const realProgress = useProgress.getState()
const refresh = vi.fn(async () => {})
const toggleCheck = vi.fn()
const move = vi.fn()
const reactivateHabit = vi.fn()

const profile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: { id: ME, timezone: 'America/Sao_Paulo', habits_enabled: true, ...over } as unknown as Profile })
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const check = (habit_id: string, day: string): HabitCheck => ({ habit_id, day, counted: null })
const READ = habitOf({ id: H1, name: 'Read', per_week: 3, sort: 0 })
const WALK = habitOf({ id: H2, name: 'Walk', icon: 'footprints', per_week: 7, sort: 1 })
const store = (over: Partial<ReturnType<typeof useHabits.getState>> = {}) =>
  useHabits.setState({
    ...realHabits, refresh, toggleCheck, move, reactivateHabit, userId: ME, status: 'ready', stale: false, droppedNotice: false,
    habits: [READ, WALK], checks: [], targets: { [H1]: 3, [H2]: 7 }, targetsWeek: MONDAY, recent: null, ...over
  })
const habitsList = () => screen.getByRole('list', { name: /^(Your habits|Seus hábitos)$/ })
const rows = () => within(habitsList()).getAllByRole('listitem')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
  setOnline(true)
  localStorage.clear()
  ;[h.nav, h.toast, refresh, toggleCheck, move, reactivateHabit].forEach(f => f.mockReset())
  profile()
  store()
  useProgress.setState({ status: 'ready', progress: progressOf(0) })
})
afterEach(async () => {
  cleanup(); vi.useRealTimers(); setOnline(true)
  useProfile.setState(realProfile); useHabits.setState(realHabits); useProgress.setState(realProgress)
  await setLang('en')
})

describe('HabitsScreen', () => {
  it('invites to turn the pillar on when it is off, and opens the setup right here', async () => {
    await setLang('pt-BR')
    profile({ habits_enabled: false })
    render(<HabitsScreen />)
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ligar Hábitos' }))
    expect(h.nav).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'habits-setup' })).toBeTruthy()
  })

  it('tops the screen with C of Q this week, the streak and the shields', async () => {
    await setLang('pt-BR')
    store({ checks: [MONDAY, TUESDAY, TODAY].flatMap(d => [check(H1, d), check(H2, d)]) })
    useProgress.setState({
      progress: progressOf(0, {}, { habits: { week: { q: 10, c: 2, xp: 0 }, streak: { current: 3, best: 5, shields: 1 }, last_week: null } })
    })
    render(<HabitsScreen />)
    const top = screen.getByTestId('habits-week')
    expect(within(top).getByText((_, el) => el?.tagName === 'P' && el.textContent === '6 de 10 nesta semana')).toBeTruthy()
    expect(within(top).getByText('3 semanas')).toBeTruthy()
    expect(within(top).getByText('1 de 2')).toBeTruthy()
  })

  it('reads a streak of 0 from a cached progress without the habits block, and from no progress at all', () => {
    useProgress.setState({ progress: progressOf(0) })
    render(<HabitsScreen />)
    expect(within(screen.getByTestId('habits-week')).getByText('0 weeks')).toBeTruthy()
    expect(within(screen.getByTestId('habits-week')).getByText('0 of 2')).toBeTruthy()
    cleanup()
    useProgress.setState({ status: 'loading', progress: null })
    render(<HabitsScreen />)
    expect(within(screen.getByTestId('habits-week')).getByText('0 weeks')).toBeTruthy()
  })

  it('lists the active habits in order with their week, and moves them with the arrows', () => {
    store({ checks: [check(H1, MONDAY)] })
    render(<HabitsScreen />)
    expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('Read'), expect.stringContaining('Walk')])
    const first = within(rows()[0])
    expect((first.getByRole('button', { name: 'Move up' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(first.getByRole('button', { name: 'Move down' }))
    expect(move).toHaveBeenCalledWith(H1, 1)
    fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Move up' }))
    expect(move).toHaveBeenCalledWith(H2, -1)
    expect((within(rows()[1]).getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('checks today from a row and opens a habit to edit', async () => {
    render(<HabitsScreen />)
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Today, not done' }))
    expect(toggleCheck).toHaveBeenCalledWith(H1, TODAY)
    fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Edit Walk' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Edit habit' })).toBeTruthy()
  })

  it('shows the run of weeks of each habit from the recent history', () => {
    // The last judged week is the one of Monday 10-05 (week_start <= today - 8).
    const weeks = ['2026-10-05', '2026-09-28']
    store({
      recent: {
        days: [], periods: [],
        targets: weeks.map(week_start => ({ habit_id: H1, week_start, target: 1 })),
        checks: weeks.map(day => ({ habit_id: H1, day, counted: true }))
      }
    })
    render(<HabitsScreen />)
    expect(within(rows()[0]).getByText('2 weeks in a row')).toBeTruthy()
    expect(within(rows()[1]).queryByText(/in a row/)).toBeNull()
  })

  it('shows the shape of the screen while the first load runs', () => {
    store({ status: 'loading', habits: [] })
    render(<HabitsScreen />)
    expect(screen.getByTestId('habits-skeleton').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('asks for the first habit when there is none, opening the habit sheet', async () => {
    await setLang('pt-BR')
    store({ habits: [], targets: {} })
    render(<HabitsScreen />)
    expect(screen.queryByTestId('habits-week')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Crie seu primeiro hábito' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Novo hábito' })).toBeTruthy()
  })

  it('opens a new habit from the list', () => {
    render(<HabitsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'New habit' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'New habit' })).toBeTruthy()
  })

  it('puts the archived habits last, with Reactivate', async () => {
    await setLang('pt-BR')
    const old: Habit = habitOf({ id: 'h3', name: 'Meditate', icon: 'brain', sort: 2, archived_at: '2026-10-01T12:00:00.000Z' })
    store({ habits: [READ, WALK, old] })
    const { container } = render(<HabitsScreen />)
    expect(rows()).toHaveLength(2)
    const archived = screen.getByRole('region', { name: 'Arquivados' })
    expect(within(archived).getByText('Meditate')).toBeTruthy()
    // After the list and after the history slot: the last thing on the screen.
    const slot = container.querySelector('[data-slot="habits-history"]')!
    expect(slot).toBeTruthy()
    expect(habitsList().compareDocumentPosition(archived) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(slot.compareDocumentPosition(archived) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(archived).getByRole('button', { name: 'Reativar' }))
    expect(reactivateHabit).toHaveBeenCalledWith('h3')
    expect(h.toast).toHaveBeenCalledWith('Hábito reativado')
  })

  it('says why a habit cannot come back when 20 are active', () => {
    reactivateHabit.mockImplementation(() => { throw { code: 'P0001', message: 'too_many_habits' } })
    store({ habits: [READ, habitOf({ id: 'h3', name: 'Meditate', archived_at: '2026-10-01T12:00:00.000Z' })] })
    render(<HabitsScreen />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Archived' })).getByRole('button', { name: 'Reactivate' }))
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('20'))
  })

  it('shows the saved copy offline and still takes a check', async () => {
    await setLang('pt-BR')
    setOnline(false)
    store({ stale: true })
    render(<HabitsScreen />)
    expect(screen.getByText(/^Sem conexão/)).toBeTruthy()
    const today = within(rows()[0]).getByRole('button', { name: 'Hoje, sem check' }) as HTMLButtonElement
    expect(today.disabled).toBe(false)
    fireEvent.click(today)
    expect(toggleCheck).toHaveBeenCalledWith(H1, TODAY)
  })

  it('offers a retry when the habits could not load and nothing is saved', () => {
    store({ status: 'error', habits: [], targets: {} })
    render(<HabitsScreen />)
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Create your first habit' })).toBeNull()
  })

  it('says once that the queue dropped checks from closed days, then forgets it', () => {
    store({ droppedNotice: true })
    const { rerender } = render(<HabitsScreen />)
    expect(h.toast).toHaveBeenCalledWith(droppedNoticeText())
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(useHabits.getState().droppedNotice).toBe(false)
    rerender(<HabitsScreen />)
    expect(h.toast).toHaveBeenCalledTimes(1)
  })

  it('leaves the history slot for the calendar', () => {
    const { container } = render(<HabitsScreen />)
    expect(container.querySelector('[data-slot="habits-history"]')).toBeTruthy()
  })

  it('goes back to Home when opened directly', () => {
    render(<HabitsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith('/home')
  })
})
