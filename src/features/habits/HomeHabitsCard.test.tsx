// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import HomeHabitsCard from './HomeHabitsCard'
import { useHabits } from './useHabits'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'
import { setLang } from '../../lib/i18n.js'
import { habitOf, H1, H2 } from './test-habits'
import type { Habit, HabitCheck } from './types'
import type { Profile } from '../profile/types'

// The week of Monday 2026-10-12. Sao Paulo is UTC-3: HH:MM local on `day` is (HH+3):MM UTC.
const MONDAY = '2026-10-12'
const SATURDAY = '2026-10-17'
const at = (hhmm: string, day = SATURDAY) => {
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hh + 3, mm))
}
const realProfile = useProfile.getState()
const realHabits = useHabits.getState()
const realProgress = useProgress.getState()
const toggleCheck = vi.fn(realHabits.toggleCheck)

const profile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo', habits_enabled: true, ...over } as unknown as Profile })
const store = (habits: Habit[], checks: HabitCheck[] = [], targets: Record<string, number> = {}, status: 'idle' | 'loading' | 'ready' | 'error' = 'ready') =>
  useHabits.setState({ userId: null, status, habits, checks, targets, targetsWeek: MONDAY, toggleCheck })
const check = (habit_id: string, day: string): HabitCheck => ({ habit_id, day, counted: null })
const card = () => screen.queryByTestId('home-habits-card')
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(at('09:00'))
  h.nav.mockReset(); toggleCheck.mockClear()
  profile()
})
afterEach(async () => {
  cleanup(); vi.useRealTimers()
  useProfile.setState(realProfile); useHabits.setState(realHabits); useProgress.setState(realProgress)
  await setLang('en')
})

describe('HomeHabitsCard', () => {
  it('shows nothing with the pillar off or without an active habit', () => {
    profile({ habits_enabled: false })
    store([habitOf()])
    expect(render(<HomeHabitsCard />).container.innerHTML).toBe('')
    cleanup()
    profile()
    store([habitOf({ archived_at: '2026-10-13T12:00:00.000Z' })])
    expect(render(<HomeHabitsCard />).container.innerHTML).toBe('')
    cleanup()
    store([])
    expect(render(<HomeHabitsCard />).container.innerHTML).toBe('')
  })

  it('holds a skeleton until the store answers', () => {
    store([], [], {}, 'loading')
    render(<HomeHabitsCard />)
    expect(card()?.getAttribute('aria-busy')).toBe('true')
  })

  it('lists the habits still missing checks first, then the complete ones, each by its order', () => {
    store(
      [habitOf({ id: H1, name: 'Read', sort: 0 }), habitOf({ id: H2, name: 'Walk', sort: 1, icon: 'footprints' }), habitOf({ id: 'h3', name: 'Water', sort: 2, icon: 'droplet' })],
      [check(H1, MONDAY), check(H1, '2026-10-13')],
      { [H1]: 2, [H2]: 3, h3: 3 }
    )
    render(<HomeHabitsCard />)
    expect(rows().map(r => r.textContent)).toEqual([
      expect.stringContaining('Walk'), expect.stringContaining('Water'), expect.stringContaining('Read')
    ])
    expect(rows()[2].textContent).toContain('2 of 2 this week')
    expect(rows()[0].textContent).toContain('0 of 3 this week')
  })

  it('says in words that a habit is late: 2 left in 2 days on a Saturday with 1 of 3', async () => {
    await setLang('pt-BR')
    store([habitOf({ id: H1, name: 'Ler', per_week: 3 }), habitOf({ id: H2, name: 'Correr', sort: 1, per_week: 3 })],
      [check(H1, MONDAY), check(H2, MONDAY), check(H2, '2026-10-14')], { [H1]: 3, [H2]: 3 })
    render(<HomeHabitsCard />)
    const [read, run] = rows()
    expect(read.textContent).toContain('1 de 3 na semana')
    expect(read.textContent).toContain('faltam 2 em 2 dias')
    // 2 of 3 with two days to go is not late.
    expect(run.textContent).toContain('2 de 3 na semana')
    expect(run.textContent).not.toContain('faltam')
  })

  it('words the last days of the week without a count of zero days', () => {
    const SUNDAY = '2026-10-18'
    vi.setSystemTime(at('09:00', SUNDAY))
    store([habitOf({ id: H1, name: 'Read' }), habitOf({ id: H2, name: 'Walk', sort: 1 })],
      [check(H1, MONDAY), check(H1, SUNDAY), check(H2, MONDAY)], { [H1]: 3, [H2]: 3 })
    render(<HomeHabitsCard />)
    const [read, walk] = rows()
    // Read was checked today: one still missing and no day after today.
    expect(read.textContent).toContain('1 left, and the week ends today')
    // Walk has today: two missing in one day.
    expect(walk.textContent).toContain('2 left in 1 day')
  })

  it('checks today in one tap with a 44 px button named after the habit, and undoes it', async () => {
    await setLang('pt-BR')
    store([habitOf({ id: H1, name: 'Ler' })], [], { [H1]: 3 })
    render(<HomeHabitsCard />)
    const button = screen.getByRole('button', { name: 'Marcar Ler hoje' })
    expect(button.className).toContain('size-11')
    fireEvent.click(button)
    expect(toggleCheck).toHaveBeenCalledTimes(1)
    expect(toggleCheck).toHaveBeenCalledWith(H1, SATURDAY)
    expect(screen.getByText('1 de 3 na semana')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Desmarcar Ler hoje' }))
    expect(toggleCheck).toHaveBeenCalledTimes(2)
    expect(toggleCheck).toHaveBeenLastCalledWith(H1, SATURDAY)
    expect(screen.getByRole('button', { name: 'Marcar Ler hoje' })).toBeTruthy()
  })

  it('sums the week in the footer with the XP the client predicts', async () => {
    await setLang('pt-BR')
    // Q = 10, so each valid check pays 60: 6 checks are 360, plus 30 for each of the 3 days.
    const days = [MONDAY, '2026-10-13', '2026-10-14']
    store([habitOf({ id: H1, name: 'Ler', per_week: 5 }), habitOf({ id: H2, name: 'Correr', sort: 1, per_week: 5 })],
      days.flatMap(d => [check(H1, d), check(H2, d)]), { [H1]: 5, [H2]: 5 })
    render(<HomeHabitsCard />)
    expect(screen.getByText('Semana: 6 de 10 · +450 XP até agora')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Hábitos' }))
    expect(h.nav).toHaveBeenCalledWith('/habitos')
  })

  it('shows the first 6 of 8 habits and See all, which opens /habitos', () => {
    const many = Array.from({ length: 8 }, (_, i) => habitOf({ id: `h${i}`, name: `Habit ${i}`, sort: i }))
    store(many, [], Object.fromEntries(many.map(x => [x.id, 3])))
    render(<HomeHabitsCard />)
    expect(rows()).toHaveLength(6)
    expect(rows()[5].textContent).toContain('Habit 5')
    fireEvent.click(screen.getByRole('button', { name: 'See all' }))
    expect(h.nav).toHaveBeenCalledWith('/habitos')
  })

  it('checks the new day after midnight without a reload', () => {
    vi.setSystemTime(at('23:59'))
    store([habitOf({ id: H1, name: 'Read' })], [check(H1, SATURDAY)], { [H1]: 3 })
    render(<HomeHabitsCard />)
    expect(screen.getByRole('button', { name: 'Unmark Read today' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(60_000) })
    fireEvent.click(screen.getByRole('button', { name: 'Mark Read done today' }))
    expect(toggleCheck).toHaveBeenCalledWith(H1, '2026-10-18')
  })

  it('renders with a cached progress that has no habits in it', () => {
    useProgress.setState({ status: 'ready', userId: 'u1', progress: progressOf(400) })
    expect(useProgress.getState().progress).not.toHaveProperty('habits')
    store([habitOf({ id: H1, name: 'Read' })], [], { [H1]: 3 })
    render(<HomeHabitsCard />)
    expect(card()).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark Read done today' })).toBeTruthy()
  })
})
