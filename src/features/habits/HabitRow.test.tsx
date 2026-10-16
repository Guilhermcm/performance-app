// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

import HabitRow from './HabitRow'
import { weekDots } from './week'
import { setLang } from '../../lib/i18n.js'
import { habitOf, H1 } from './test-habits'
import type { HabitCheck } from './types'

// The week of Monday 2026-10-12.
const MONDAY = '2026-10-12'
const TUESDAY = '2026-10-13'
const WEDNESDAY = '2026-10-14'
const check = (day: string): HabitCheck => ({ habit_id: H1, day, counted: null })

type Over = Partial<Parameters<typeof HabitRow>[0]>
const onMove = vi.fn()
const onToggle = vi.fn()
const onEdit = vi.fn()
const row = (over: Over = {}) => render(
  <ul>
    <HabitRow habit={habitOf()} week={{ target: 3, done: 2 }} days={weekDots(H1, [check(MONDAY), check(TUESDAY)], WEDNESDAY)}
      run={0} canMove={{ up: true, down: true }} onMove={onMove} onToggle={onToggle} onEdit={onEdit} {...over} />
  </ul>
)
const dots = () => within(screen.getByRole('group'))

afterEach(async () => {
  cleanup()
  ;[onMove, onToggle, onEdit].forEach(f => f.mockReset())
  await setLang('en')
})

describe('HabitRow', () => {
  it('shows the seven days, with today and yesterday as buttons and the others read only, each named by day and state', () => {
    row()
    const buttons = dots().getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Yesterday, done', 'Today, not done'])
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    expect(dots().getAllByRole('img').map(d => d.getAttribute('aria-label'))).toEqual([
      'Monday, done', 'Thursday, still ahead', 'Friday, still ahead', 'Saturday, still ahead', 'Sunday, still ahead'
    ])
    fireEvent.click(buttons[1])
    expect(onToggle).toHaveBeenCalledWith(WEDNESDAY)
    fireEvent.click(buttons[0])
    expect(onToggle).toHaveBeenCalledWith(TUESDAY)
  })

  it('shows the count for the week, with a mark once the week is met, and names the days by the habit', () => {
    row()
    expect(screen.getByRole('group').getAttribute('aria-label')).toBe('Read')
    expect(screen.getByText('2 of 3 this week')).toBeTruthy()
    cleanup()
    row({ week: { target: 3, done: 3 } })
    expect(screen.getByText('3 of 3 this week').querySelector('svg')).toBeTruthy()
  })

  it('on Monday makes only today a button (plan decision 14)', () => {
    row({ days: weekDots(H1, [check('2026-10-11')], MONDAY) })
    expect(dots().getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Today, not done'])
    expect(dots().getAllByRole('img')).toHaveLength(6)
  })

  it('says a past day without a check as not done', () => {
    row({ days: weekDots(H1, [], '2026-10-16') })
    expect(dots().getAllByRole('img').map(d => d.getAttribute('aria-label')).slice(0, 3)).toEqual([
      'Monday, not done', 'Tuesday, not done', 'Wednesday, not done'
    ])
  })

  it('disables up on the first habit and down on the last, and moves by one', () => {
    row({ canMove: { up: false, down: true } })
    const up = screen.getByRole('button', { name: 'Move up' }) as HTMLButtonElement
    const down = screen.getByRole('button', { name: 'Move down' }) as HTMLButtonElement
    expect(up.disabled).toBe(true)
    expect(down.disabled).toBe(false)
    fireEvent.click(down)
    expect(onMove).toHaveBeenCalledWith(1)
    cleanup()
    row({ canMove: { up: true, down: false } })
    expect((screen.getByRole('button', { name: 'Move down' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move up' }))
    expect(onMove).toHaveBeenCalledWith(-1)
  })

  it('says N per week, and every day for 7', async () => {
    await setLang('pt-BR')
    row()
    expect(screen.getByText('3 por semana')).toBeTruthy()
    cleanup()
    row({ habit: habitOf({ per_week: 7 }) })
    expect(screen.getByText('Todo dia')).toBeTruthy()
  })

  it('shows the run of weeks, as 8+ from 8 on, and nothing without one', async () => {
    row({ run: 3 })
    expect(screen.getByText('3 weeks in a row')).toBeTruthy()
    cleanup()
    row({ run: 1 })
    expect(screen.getByText('1 week in a row')).toBeTruthy()
    cleanup()
    row({ run: 8 })
    expect(screen.getByText('8+ weeks in a row')).toBeTruthy()
    cleanup()
    row({ run: 12 })
    expect(screen.getByText('8+ weeks in a row')).toBeTruthy()
    cleanup()
    row({ run: 0 })
    expect(screen.queryByText(/in a row/)).toBeNull()
    cleanup()
    await setLang('pt-BR')
    row({ run: 9 })
    expect(screen.getByText('8+ semanas seguidas')).toBeTruthy()
  })

  it('opens the habit to edit', async () => {
    await setLang('pt-BR')
    row()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Read' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
