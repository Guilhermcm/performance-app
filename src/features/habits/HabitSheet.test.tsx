// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import HabitSheet from './HabitSheet'
import { useHabits } from './useHabits'
import { useProfile } from '../profile/useProfile'
import { classify } from '@/lib/supabase-errors'
import { habitOf, H1 } from './test-habits'
import type { Habit } from './types'
import type { Profile } from '../profile/types'

const realProfile = useProfile.getState()
const realHabits = useHabits.getState()
const saveHabit = vi.fn(), archiveHabit = vi.fn(), reactivateHabit = vi.fn(), onOpenChange = vi.fn()

const show = (habit?: Habit) => render(<HabitSheet habit={habit} open onOpenChange={onOpenChange} />)
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const nameField = () => screen.getByLabelText('Name') as HTMLInputElement
const type = (value: string) => fireEvent.change(nameField(), { target: { value } })
const choose = (n: string) => fireEvent.click(screen.getByRole('radio', { name: n }))
const manyActive = (n: number) => Array.from({ length: n }, (_, i) => habitOf({ id: `h${i}`, sort: i }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Wednesday 14 October 2026, noon in São Paulo: five days left in the week, counting today.
  vi.setSystemTime(new Date('2026-10-14T15:00:00Z'))
  ;[saveHabit, archiveHabit, reactivateHabit, onOpenChange, h.toast].forEach(f => f.mockReset())
  saveHabit.mockImplementation((input: object) => habitOf(input as Partial<Habit>))
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo' } as unknown as Profile })
  useHabits.setState({ habits: [], status: 'ready', saveHabit, archiveHabit, reactivateHabit })
})
afterEach(() => { cleanup(); vi.useRealTimers(); useProfile.setState(realProfile); useHabits.setState(realHabits) })

describe('HabitSheet: creating', () => {
  it('blocks an empty or blank name and saves it without the spaces at the ends', () => {
    show()
    expect(screen.getByRole('heading', { name: 'New habit' })).toBeTruthy()
    expect(button('Create habit').disabled).toBe(true)
    type('    ')
    expect(button('Create habit').disabled).toBe(true)
    fireEvent.click(button('Create habit'))
    expect(saveHabit).not.toHaveBeenCalled()
    type('  Read 10 pages  ')
    expect(button('Create habit').disabled).toBe(false)
    fireEvent.click(button('Create habit'))
    expect(saveHabit).toHaveBeenCalledWith({ name: 'Read 10 pages', icon: 'check', per_week: 7 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(h.toast).toHaveBeenCalledWith('Habit created')
  })

  it('cuts the name at 40 characters and shows the count', () => {
    show()
    type('a'.repeat(41))
    expect(nameField().value).toBe('a'.repeat(40))
    expect(screen.getByText('40/40')).toBeTruthy()
    type('Run')
    expect(screen.getByText('3/40')).toBeTruthy()
  })

  it('offers the 24 icons as named buttons that show which one is chosen', () => {
    show()
    const grid = within(screen.getByRole('group', { name: 'Icon' }))
    const icons = grid.getAllByRole('button')
    expect(icons).toHaveLength(24)
    expect(icons.every(b => b.getAttribute('aria-label'))).toBe(true)
    expect(grid.getByRole('button', { name: 'Check mark' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(grid.getByRole('button', { name: 'Book' }))
    expect(grid.getByRole('button', { name: 'Book' }).getAttribute('aria-pressed')).toBe('true')
    expect(grid.getByRole('button', { name: 'Check mark' }).getAttribute('aria-pressed')).toBe('false')
    type('Read')
    fireEvent.click(button('Create habit'))
    expect(saveHabit).toHaveBeenCalledWith({ name: 'Read', icon: 'book', per_week: 7 })
  })

  it('picks N from 1 to 7, starting at 7', () => {
    show()
    for (const n of ['1', '2', '3', '4', '5', '6', '7']) expect(screen.getByRole('radio', { name: n })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '0' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '8' })).toBeNull()
    expect(screen.getByRole('radio', { name: '7' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Every day')).toBeTruthy()
    choose('3')
    expect(screen.getByText('3 times a week')).toBeTruthy()
    type('Run')
    fireEvent.click(button('Create habit'))
    expect(saveHabit).toHaveBeenCalledWith({ name: 'Run', icon: 'check', per_week: 3 })
  })

  it('says how many times a habit created on a Wednesday counts this week', () => {
    show()
    expect(screen.getByText('This week it counts 5 times, since the week has already started.')).toBeTruthy()
    choose('5')
    expect(screen.queryByText(/This week it counts/)).toBeNull()
    cleanup()
    // Sunday: one day left.
    vi.setSystemTime(new Date('2026-10-18T15:00:00Z'))
    show()
    choose('3')
    expect(screen.getByText('This week it counts once, since the week has already started.')).toBeTruthy()
  })

  it('cannot create a 21st active habit and says why', () => {
    useHabits.setState({ habits: [...manyActive(20), habitOf({ id: 'old', archived_at: '2026-10-01T00:00:00Z' })] })
    show()
    type('One more')
    expect(button('Create habit').disabled).toBe(true)
    expect(screen.getByText('You already have 20 active habits, the most allowed. Archive one to make room.')).toBeTruthy()
    fireEvent.click(button('Create habit'))
    expect(saveHabit).not.toHaveBeenCalled()
  })

  it('creates with 19 active habits', () => {
    useHabits.setState({ habits: manyActive(19) })
    show()
    type('One more')
    expect(button('Create habit').disabled).toBe(false)
    expect(screen.queryByText(/the most allowed/)).toBeNull()
  })

  it('keeps the sheet open and explains when the store refuses a 21st habit', () => {
    saveHabit.mockImplementation(() => { throw classify({ code: 'P0001', message: 'too_many_habits' }) })
    show()
    type('Run')
    fireEvent.click(button('Create habit'))
    expect(h.toast).toHaveBeenCalledWith('You already have 20 active habits, the most allowed. Archive one to make room.')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('has nothing to archive', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Archive habit' })).toBeNull()
  })
})

describe('HabitSheet: editing', () => {
  const read = habitOf({ id: H1, name: 'Read', icon: 'book', per_week: 3 })

  it('starts from the habit and saves the changes', () => {
    useHabits.setState({ habits: [read] })
    show(read)
    expect(screen.getByRole('heading', { name: 'Edit habit' })).toBeTruthy()
    expect(nameField().value).toBe('Read')
    expect(screen.getByRole('button', { name: 'Book' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('radio', { name: '3' }).getAttribute('aria-checked')).toBe('true')
    // An existing habit does not get the mid-week count of a new one.
    expect(screen.queryByText(/This week it counts/)).toBeNull()
    type(' Read a book ')
    fireEvent.click(button('Save'))
    expect(saveHabit).toHaveBeenCalledWith({ id: H1, name: 'Read a book', icon: 'book', per_week: 3 })
    expect(h.toast).toHaveBeenCalledWith('Saved')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('warns that a new N counts from next week', () => {
    useHabits.setState({ habits: [read] })
    show(read)
    expect(screen.queryByText('The new goal counts from next week.')).toBeNull()
    choose('5')
    expect(screen.getByRole('status').textContent).toBe('The new goal counts from next week.')
    choose('3')
    expect(screen.queryByText('The new goal counts from next week.')).toBeNull()
    choose('5')
    fireEvent.click(button('Save'))
    expect(saveHabit).toHaveBeenCalledWith({ id: H1, name: 'Read', icon: 'book', per_week: 5 })
  })

  it('still edits a habit with 20 active', () => {
    useHabits.setState({ habits: [read, ...manyActive(19)] })
    show(read)
    expect(button('Save').disabled).toBe(false)
    expect(screen.queryByText(/the most allowed/)).toBeNull()
  })

  it('asks before archiving, and archives on confirmation', () => {
    useHabits.setState({ habits: [read] })
    show(read)
    fireEvent.click(button('Archive habit'))
    expect(screen.getByRole('alertdialog', { name: 'Archive this habit?' })).toBeTruthy()
    fireEvent.click(button('Cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(archiveHabit).not.toHaveBeenCalled()
    fireEvent.click(button('Archive habit'))
    fireEvent.click(button('Archive'))
    expect(archiveHabit).toHaveBeenCalledWith(H1)
    expect(saveHabit).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Habit archived')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('HabitSheet: an archived habit', () => {
  const old = habitOf({ id: H1, name: 'Read', icon: 'book', per_week: 7, archived_at: '2026-10-01T00:00:00Z' })

  it('reactivates it, with the edits made in the sheet', () => {
    useHabits.setState({ habits: [old] })
    show(old)
    expect(screen.queryByRole('button', { name: 'Archive habit' })).toBeNull()
    // Reactivating counts as creating: the days left this week.
    expect(screen.getByText('This week it counts 5 times, since the week has already started.')).toBeTruthy()
    fireEvent.click(button('Reactivate'))
    expect(reactivateHabit).toHaveBeenCalledWith(H1)
    expect(saveHabit).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Habit reactivated')
    expect(onOpenChange).toHaveBeenCalledWith(false)

    reactivateHabit.mockClear()
    cleanup()
    show(old)
    choose('4')
    fireEvent.click(button('Reactivate'))
    expect(saveHabit).toHaveBeenCalledWith({ id: H1, name: 'Read', icon: 'book', per_week: 4 })
    expect(reactivateHabit).toHaveBeenCalledWith(H1)
    expect(saveHabit.mock.invocationCallOrder[0]).toBeLessThan(reactivateHabit.mock.invocationCallOrder[0])
  })

  it('cannot come back with 20 active habits and says why', () => {
    useHabits.setState({ habits: [old, ...manyActive(20)] })
    show(old)
    expect(button('Reactivate').disabled).toBe(true)
    expect(screen.getByText('You already have 20 active habits, the most allowed. Archive one to make room.')).toBeTruthy()
  })
})
