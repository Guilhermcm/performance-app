// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import MonthCalendar, { type CalendarCell, type CalendarWeek } from './MonthCalendar'

const icon = <svg data-testid="icon" />
const cellOf = (day: string, over: Partial<CalendarCell> = {}): CalendarCell =>
  ({ day, state: 'done', label: 'Done', icon, accessibleText: `${day}: Done`, ...over })

// October 2026 starts on a Thursday: the first row opens with three empty slots.
const weeks: CalendarWeek[] = [
  { start: '2026-09-28', cells: [null, null, null, cellOf('2026-10-01'), cellOf('2026-10-02', { state: 'off', label: 'Off', accessibleText: '2026-10-02: Off', selectable: false }), cellOf('2026-10-03'), cellOf('2026-10-04')], summary: '3/5 on target' },
  { start: '2026-10-05', cells: ['05', '06', '07', '08', '09', '10', '11'].map(d => cellOf(`2026-10-${d}`, { current: d === '06' })) }
]

afterEach(cleanup)

const base = { month: '2026-10', weeks, onSelectDay: vi.fn(), onPrevMonth: vi.fn(), onNextMonth: vi.fn(), minMonth: '2026-09', maxMonth: '2026-10' }

describe('MonthCalendar', () => {
  it('titles the month and heads the columns Monday first', () => {
    render(<MonthCalendar {...base} />)
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy()
    const heads = screen.getAllByRole('columnheader')
    expect(heads).toHaveLength(7)
    expect(heads[0].querySelector('abbr')?.getAttribute('title')).toBe('Monday')
    expect(heads[6].querySelector('abbr')?.getAttribute('title')).toBe('Sunday')
  })

  it('names each day with its full text, marks today and calls back on a tap', () => {
    const onSelectDay = vi.fn()
    render(<MonthCalendar {...base} onSelectDay={onSelectDay} />)
    const day = screen.getByRole('button', { name: '2026-10-01: Done' })
    expect(day.getAttribute('data-state')).toBe('done')
    expect(day.textContent).toContain('1')
    fireEvent.click(day)
    expect(onSelectDay).toHaveBeenCalledWith('2026-10-01')
    expect(screen.getByRole('button', { name: '2026-10-06: Done' }).getAttribute('aria-current')).toBe('date')
  })

  it('shows a day that cannot be opened without a button, still named', () => {
    render(<MonthCalendar {...base} />)
    expect(screen.queryByRole('button', { name: '2026-10-02: Off' })).toBeNull()
    expect(screen.getByRole('img', { name: '2026-10-02: Off' })).toBeTruthy()
  })

  it('puts the week summary under its row', () => {
    render(<MonthCalendar {...base} />)
    expect(screen.getByText('3/5 on target')).toBeTruthy()
  })

  it('moves between months inside the bounds only', () => {
    const onPrevMonth = vi.fn(), onNextMonth = vi.fn()
    const { rerender } = render(<MonthCalendar {...base} onPrevMonth={onPrevMonth} onNextMonth={onNextMonth} />)
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onPrevMonth).toHaveBeenCalled()
    rerender(<MonthCalendar {...base} month="2026-09" weeks={[]} onPrevMonth={onPrevMonth} onNextMonth={onNextMonth} />)
    expect((screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onNextMonth).toHaveBeenCalled()
  })

  it('shows the empty slot instead of the grid, and a skeleton in the shape of the month while loading', () => {
    const { rerender } = render(<MonthCalendar {...base} empty={<p>Nothing this month</p>} />)
    expect(screen.getByText('Nothing this month')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    rerender(<MonthCalendar {...base} loading />)
    const busy = screen.getByRole('status')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    // Five rows of seven for October 2026.
    expect(within(busy).getAllByTestId('calendar-skeleton-day')).toHaveLength(35)
  })

  it('lists the legend with icon and label', () => {
    render(<MonthCalendar {...base} legend={[{ state: 'done', label: 'Done', icon }, { state: 'off', label: 'Off', icon }]} />)
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Done', 'Off'])
  })
})
