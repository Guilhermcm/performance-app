// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, Fragment, isValidElement } from 'react'
import { render, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ fetchHistory: vi.fn() }))
vi.mock('./habits-api', async orig => ({ ...(await orig<typeof import('./habits-api')>()), fetchHistory: h.fetchHistory }))

import { HABIT_LEGEND, HABIT_DAY_STATE, buildHabitsMonth, loadHabitsMonth, monthBounds } from './history'
import { useHabits } from './useHabits'
import { H1, H2, ME, habitOf } from './test-habits'
import type { CalendarCell, CalendarWeek } from '@/components/calendar/MonthCalendar'
import type { HabitCheck, HabitDay, HabitHistory, HabitPeriod, HabitTarget } from './types'

const TODAY = '2026-10-14' // a Wednesday
const YESTERDAY = '2026-10-13'
const SINCE_SEPT: HabitPeriod[] = [{ started_on: '2026-09-20', ended_on: null }]
const READ = habitOf({ id: H1, name: 'Read', per_week: 3, sort: 0 })
const RUN = habitOf({ id: H2, name: 'Run', icon: 'footprints', per_week: 2, sort: 1 })
const HABITS = [READ, RUN]

const day = (d: string, checks: number, valid: number, xp = 0): HabitDay => ({ day: d, checks, valid, xp })
const target = (habit_id: string, week_start: string, t: number): HabitTarget => ({ habit_id, week_start, target: t })
const check = (habit_id: string, d: string, counted: boolean | null = null): HabitCheck => ({ habit_id, day: d, counted })
const history = (over: Partial<HabitHistory> = {}): HabitHistory => ({
  days: [], checks: [], periods: SINCE_SEPT,
  // Two habits due the week of 5 October; only Read the week of 28 September.
  targets: [target(H1, '2026-09-28', 3), target(H2, '2026-09-28', 0), target(H1, '2026-10-05', 3), target(H2, '2026-10-05', 2)],
  ...over
})

const cells = (weeks: CalendarWeek[]) => weeks.flatMap(w => w.cells).filter((c): c is CalendarCell => c != null)
const cell = (weeks: CalendarWeek[], d: string) => cells(weeks).find(c => c.day === d)!
// What the cell draws under the day number: its icon and, on a day with checks, the count.
const drawn = (c: CalendarCell) => {
  const { container } = render(createElement(Fragment, null, c.icon))
  const text = container.textContent
  cleanup()
  return text
}

describe('buildHabitsMonth', () => {
  it('lays the month out Monday first and leaves the days of other months blank', () => {
    const weeks = buildHabitsMonth('2026-10', history(), [], HABITS, TODAY)
    expect(weeks.map(w => w.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(weeks[0].cells.slice(0, 3)).toEqual([null, null, null])
    expect(cells(weeks)).toHaveLength(31)
  })

  it('gives each day its state of plan decision 14, with a label and an icon', () => {
    const h = history({
      days: [
        day('2026-10-01', 1, 1, 116), // one habit due that week: all of it
        day('2026-10-05', 2, 2, 230),
        day('2026-10-06', 1, 1, 116),
        day('2026-10-07', 0, 0),
        // Two checks, one past its habit's goal: every habit due was checked, one counted.
        day('2026-10-08', 2, 1, 116),
      ]
    })
    const weeks = buildHabitsMonth('2026-10', h, [], HABITS, TODAY)
    const expected: [string, string, string][] = [
      ['2026-10-01', 'all', 'All checked'],
      ['2026-10-05', 'all', 'All checked'],
      ['2026-10-06', 'partial', 'Partly checked'],
      ['2026-10-07', 'none', 'Nothing checked'],
      ['2026-10-08', 'all', 'All checked'],
      // Inside the period, closed, with no row: nothing checked.
      ['2026-10-09', 'none', 'Nothing checked'],
      // Yesterday and today can still change.
      [YESTERDAY, 'open', 'Still open'],
      [TODAY, 'open', 'Still open'],
      ['2026-10-15', 'future', 'Not yet'],
    ]
    for (const [d, state, label] of expected) {
      const c = cell(weeks, d)
      expect(c.state, d).toBe(state)
      expect(c.label, d).toBe(label)
      expect(isValidElement(c.icon), d).toBe(true)
      expect(c.accessibleText, d).toContain(label)
    }
    // The words say how many checks counted, never the colour alone.
    expect(cell(weeks, '2026-10-05').accessibleText).toBe('Monday 5 October: All checked, 2 checks counted')
    expect(cell(weeks, '2026-10-06').accessibleText).toBe('Tuesday 6 October: Partly checked, 1 check counted')
    expect(cell(weeks, '2026-10-07').accessibleText).toBe('Wednesday 7 October: Nothing checked')
  })

  it('numbers a day with checks by its valid ones', () => {
    const h = history({ days: [day('2026-10-05', 2, 2), day('2026-10-06', 1, 1), day('2026-10-07', 0, 0), day('2026-10-08', 2, 1)] })
    const weeks = buildHabitsMonth('2026-10', h, [], HABITS, TODAY)
    expect(drawn(cell(weeks, '2026-10-05'))).toBe('2')
    expect(drawn(cell(weeks, '2026-10-06'))).toBe('1')
    expect(drawn(cell(weeks, '2026-10-08'))).toBe('1')
    expect(drawn(cell(weeks, '2026-10-07'))).toBe('')
    expect(cell(weeks, '2026-10-08').accessibleText).toBe('Thursday 8 October: All checked, 1 check counted')
  })

  it('has a label and an icon for every state of the legend', () => {
    expect(HABIT_LEGEND).toEqual(['all', 'partial', 'none', 'open', 'inactive', 'future'])
    for (const s of HABIT_LEGEND) {
      expect(HABIT_DAY_STATE[s].label().length, s).toBeGreaterThan(0)
      expect(isValidElement(HABIT_DAY_STATE[s].icon()), s).toBe(true)
    }
  })

  it('marks today as current and does not let a day to come be picked', () => {
    const weeks = buildHabitsMonth('2026-10', history(), [], HABITS, TODAY)
    expect(cells(weeks).filter(c => c.current).map(c => c.day)).toEqual([TODAY])
    expect(cell(weeks, TODAY).selectable).not.toBe(false)
    expect(cell(weeks, YESTERDAY).selectable).not.toBe(false)
    for (const c of cells(weeks).filter(c => c.day > TODAY)) expect(c, c.day).toMatchObject({ state: 'future', selectable: false })
  })

  it('fades the days outside a period and does not let them be picked', () => {
    const periods: HabitPeriod[] = [{ started_on: '2026-09-01', ended_on: '2026-10-02' }, { started_on: '2026-10-05', ended_on: null }]
    const weeks = buildHabitsMonth('2026-10', history({ periods }), [], HABITS, TODAY)
    expect(cell(weeks, '2026-10-02').state).toBe('none')
    expect(cell(weeks, '2026-10-03')).toMatchObject({ state: 'inactive', label: 'Not tracked', selectable: false })
    expect(cell(weeks, '2026-10-04')).toMatchObject({ state: 'inactive', selectable: false })
    expect(cell(weeks, '2026-10-05').state).toBe('none')
    // Turned off yesterday: today is outside every period, though it has not closed.
    const off = buildHabitsMonth('2026-10', history({ periods: [{ started_on: '2026-09-01', ended_on: YESTERDAY }] }), [], HABITS, TODAY)
    expect(cell(off, YESTERDAY).state).toBe('open')
    expect(cell(off, TODAY)).toMatchObject({ state: 'inactive', selectable: false })
  })

  it('counts the checks of an open day so far, and keeps an older one pending until its row arrives', () => {
    const open = [check(H1, TODAY), check(H2, TODAY), check(H1, '2026-10-09'), check('gone', TODAY)]
    const weeks = buildHabitsMonth('2026-10', history(), open, HABITS, TODAY)
    expect(cell(weeks, TODAY).accessibleText).toBe('Wednesday 14 October: Still open, 2 checks')
    expect(drawn(cell(weeks, TODAY))).toBe('2')
    expect(cell(weeks, YESTERDAY).accessibleText).toBe('Tuesday 13 October: Still open')
    // The day turned with the screen open, or the pull failed offline: 9 October has closed, its
    // check is still on the phone and no closed row came back yet.
    expect(cell(weeks, '2026-10-09')).toMatchObject({ state: 'open', accessibleText: 'Friday 9 October: Still open, 1 check' })
    // Once the row is there, it speaks for the day.
    const closed = buildHabitsMonth('2026-10', history({ days: [day('2026-10-09', 1, 1)] }), open, HABITS, TODAY)
    expect(cell(closed, '2026-10-09').state).toBe('partial')
  })
})

describe('monthBounds', () => {
  it('goes back no further than the month of the first period that covers a day', () => {
    const periods: HabitPeriod[] = [{ started_on: '2026-05-10', ended_on: '2026-05-09' }, { started_on: '2026-08-03', ended_on: '2026-08-20' }, ...SINCE_SEPT]
    expect(monthBounds(periods, TODAY)).toEqual({ min: '2026-08', max: '2026-10' })
  })

  it('stays on this month with no period known', () => {
    expect(monthBounds([], TODAY)).toEqual({ min: '2026-10', max: '2026-10' })
  })
})

describe('loadHabitsMonth', () => {
  const realHabits = useHabits.getState()
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T15:00:00Z')) // noon in Sao Paulo
    localStorage.clear()
    h.fetchHistory.mockReset()
    h.fetchHistory.mockResolvedValue(history({ days: [day('2026-09-21', 1, 1)] }))
    useHabits.setState({ ...realHabits, userId: ME })
  })
  afterEach(() => { vi.useRealTimers(); useHabits.setState(realHabits) })

  it('asks nothing for a month without an active day', async () => {
    const gap: HabitPeriod[] = [{ started_on: '2026-08-01', ended_on: '2026-08-31' }, { started_on: '2026-10-01', ended_on: null }]
    expect(await loadHabitsMonth('2026-09', gap, TODAY)).toBeNull()
    expect(await loadHabitsMonth('2026-07', gap, TODAY)).toBeNull()
    // Turned on yesterday: two open days, nothing closed to read yet.
    expect(await loadHabitsMonth('2026-10', [{ started_on: YESTERDAY, ended_on: null }], TODAY)).toBeNull()
    expect(h.fetchHistory).not.toHaveBeenCalled()
  })

  it('reads a month with a closed day inside a period', async () => {
    const data = await loadHabitsMonth('2026-09', SINCE_SEPT, TODAY)
    expect(h.fetchHistory).toHaveBeenCalledWith('2026-09-01', '2026-09-30')
    expect(data?.days.map(d => d.day)).toEqual(['2026-09-21'])
  })
})
