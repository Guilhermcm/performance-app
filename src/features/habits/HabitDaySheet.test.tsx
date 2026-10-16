// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import HabitDaySheet from './HabitDaySheet'
import { useHabits } from './useHabits'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { H1, H2, ME, habitOf } from './test-habits'
import type { HabitCheck, HabitHistory } from './types'
import type { Profile } from '../profile/types'

// Monday 2026-10-12 at 09:00 in Sao Paulo: yesterday is Sunday the 11th, in the week before.
const MONDAY = '2026-10-12'
const SUNDAY = '2026-10-11'
const SATURDAY = '2026-10-10'
const realProfile = useProfile.getState()
const realHabits = useHabits.getState()
const toggleCheck = vi.fn()

const LER = habitOf({ id: H1, name: 'Ler', per_week: 3, sort: 0 })
const CORRER = habitOf({ id: H2, name: 'Correr', icon: 'footprints', per_week: 2, sort: 1 })
const OLD = habitOf({ id: 'h3', name: 'Meditar', icon: 'brain', sort: 2, archived_at: '2026-10-01T12:00:00.000Z' })
const check = (habit_id: string, day: string, counted: boolean | null = null): HabitCheck => ({ habit_id, day, counted })
const recent = (over: Partial<HabitHistory> = {}): HabitHistory => ({
  days: [{ day: SATURDAY, checks: 2, valid: 1, xp: 116 }],
  // Correr had met its goal already that week: its check did not count.
  checks: [check(H2, SATURDAY, false), check(H1, SATURDAY, true)],
  targets: [{ habit_id: H1, week_start: '2026-10-05', target: 3 }, { habit_id: H2, week_start: '2026-10-05', target: 2 }],
  periods: [{ started_on: '2026-09-01', ended_on: null }], ...over
})
const store = (over: Partial<ReturnType<typeof useHabits.getState>> = {}) =>
  useHabits.setState({ ...realHabits, toggleCheck, userId: ME, status: 'ready', habits: [LER, CORRER, OLD], checks: [], recent: recent(), ...over })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
  toggleCheck.mockReset()
  useProfile.setState({ status: 'ready', profile: { id: ME, timezone: 'America/Sao_Paulo', habits_enabled: true } as unknown as Profile })
  store()
})
afterEach(async () => {
  cleanup(); vi.useRealTimers()
  useProfile.setState(realProfile); useHabits.setState(realHabits)
  await setLang('en')
})

describe('HabitDaySheet', () => {
  it('lists the habits checked on a closed day and says which went over the goal', async () => {
    await setLang('pt-BR')
    render(<HabitDaySheet day={SATURDAY} open onOpenChange={() => {}} />)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading').textContent).toBe('sábado, 10 de outubro')
    const items = within(sheet).getAllByRole('listitem')
    // In list order, whatever order the server sent.
    expect(items.map(i => i.textContent)).toEqual(['Ler', 'CorrerAlém da meta'])
    expect(within(items[1]).getByText('Além da meta')).toBeTruthy()
    expect(within(sheet).getByText('Tudo marcado')).toBeTruthy()
    expect(within(sheet).getByText('+116 XP')).toBeTruthy()
    // Two days back: read only.
    expect(within(sheet).getAllByRole('button').map(b => b.textContent)).toEqual(['Fechar'])
  })

  it('reads an older day from the month it is given', async () => {
    const month: HabitHistory = recent({
      days: [{ day: '2026-08-03', checks: 1, valid: 1, xp: 116 }], checks: [check(H2, '2026-08-03', true)]
    })
    render(<HabitDaySheet day="2026-08-03" history={month} open onOpenChange={() => {}} />)
    expect(screen.getAllByRole('listitem').map(i => i.textContent)).toEqual(['Correr'])
  })

  it('says when nothing was checked on a closed day', () => {
    store({ recent: recent({ days: [{ day: SATURDAY, checks: 0, valid: 0, xp: 0 }], checks: [] }) })
    render(<HabitDaySheet day={SATURDAY} open onOpenChange={() => {}} />)
    expect(screen.getByText('No habit checked on this day.')).toBeTruthy()
    expect(screen.getByText('Nothing checked')).toBeTruthy()
    expect(screen.queryByText(/XP/)).toBeNull()
  })

  it('keeps a closed day without its row yet pending, with the checks on the phone', () => {
    store({ recent: recent({ days: [], checks: [] }), checks: [check(H1, SATURDAY)] })
    render(<HabitDaySheet day={SATURDAY} open onOpenChange={() => {}} />)
    expect(screen.getAllByRole('listitem').map(i => i.textContent)).toEqual(['Ler'])
    expect(screen.getByText('To confirm')).toBeTruthy()
    expect(screen.queryByText(/XP/)).toBeNull()
  })

  it('on a Monday, checks Sunday from the sheet: every active habit with its own check', async () => {
    await setLang('pt-BR')
    store({ checks: [check(H2, SUNDAY)] })
    render(<HabitDaySheet day={SUNDAY} open onOpenChange={() => {}} />)
    const sheet = screen.getByRole('dialog')
    const ler = within(sheet).getByRole('button', { name: 'Ler' })
    const correr = within(sheet).getByRole('button', { name: 'Correr' })
    expect(ler.getAttribute('aria-pressed')).toBe('false')
    expect(correr.getAttribute('aria-pressed')).toBe('true')
    // An archived habit is not offered.
    expect(within(sheet).queryByText('Meditar')).toBeNull()
    fireEvent.click(ler)
    expect(toggleCheck).toHaveBeenCalledWith(H1, SUNDAY)
    fireEvent.click(correr)
    expect(toggleCheck).toHaveBeenLastCalledWith(H2, SUNDAY)
  })

  it('on the day the pillar was turned on leaves yesterday read only: it was before the pillar', () => {
    store({ recent: recent({ periods: [{ started_on: MONDAY, ended_on: null }] }) })
    render(<HabitDaySheet day={SUNDAY} open onOpenChange={() => {}} />)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getAllByRole('button').map(b => b.textContent)).toEqual(['Close'])
    expect(within(sheet).getByText('Not tracked')).toBeTruthy()
    // Today is still open.
    cleanup()
    render(<HabitDaySheet day={MONDAY} open onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Correr' })).toBeTruthy()
  })

  it('checks today the same way', () => {
    render(<HabitDaySheet day={MONDAY} open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Correr' }))
    expect(toggleCheck).toHaveBeenCalledWith(H2, MONDAY)
    expect(screen.getByText('Still open')).toBeTruthy()
  })

  it('closes from its button', () => {
    const onOpenChange = vi.fn()
    render(<HabitDaySheet day={SATURDAY} open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
