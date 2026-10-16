// The habits calendar's month (spec 7.3, plan decision 14): the days of a month as cells for
// MonthCalendar. The grid, the periods and what to ask the server come from the nutrition history
// (same {started_on, ended_on} periods); only the states and their words are the habits' own.
import { createElement, type ReactNode } from 'react'
import { Check, Circle, CircleDashed, CircleDot, Clock, Minus } from 'lucide-react'
import type { CalendarCell, CalendarWeek } from '@/components/calendar/MonthCalendar'
import { t, tn } from '../../lib/i18n.js'
import { buildMonth, firstMonth, monthOf, monthRange } from '../nutrition/history'
import { nightDate as dayDate } from '../sleep/labels'
import { weekStartOf } from '../gamification/xp'
import { useHabits } from './useHabits'
import type { Habit, HabitCheck, HabitDay, HabitHistory, HabitPeriod, HabitTarget } from './types'

// all, partial and none come from a closed day; open is today or yesterday, which can still change
// (or an older day whose closed row has not reached the phone yet); inactive is outside every
// period; future is a day still to come.
export type HabitDayState = 'all' | 'partial' | 'none' | 'inactive' | 'open' | 'future'

// Icon and words per state, never colour alone: the same shapes as the other calendars.
export const HABIT_DAY_STATE: Record<HabitDayState, { label: () => string; icon: () => ReactNode }> = {
  all: { label: () => t('All checked'), icon: () => createElement(Check, { className: 'size-3.5', strokeWidth: 3 }) },
  partial: { label: () => t('Partly checked'), icon: () => createElement(CircleDot, { className: 'size-3' }) },
  none: { label: () => t('Nothing checked'), icon: () => createElement(Circle, { className: 'size-3' }) },
  open: { label: () => t('Still open'), icon: () => createElement(CircleDashed, { className: 'size-3.5' }) },
  inactive: { label: () => t('Not tracked'), icon: () => createElement(Minus, { className: 'size-3' }) },
  future: { label: () => t('Not yet'), icon: () => createElement(Clock, { className: 'size-3' }) },
}
export const HABIT_LEGEND: HabitDayState[] = ['all', 'partial', 'none', 'open', 'inactive', 'future']

const countedText = (n: number): string => (n === 1 ? t('1 check counted') : tn(n, '{0} checks counted', n))
const checksText = (n: number): string => (n === 1 ? t('1 check') : tn(n, '{0} checks', n))

// How many habits had a target above 0 in the week of `day`: the checks a day needs to be "all".
export function habitsDue(day: string, targets: HabitTarget[]): number {
  const week = weekStartOf(day)
  return new Set(targets.filter(x => x.week_start === week && x.target > 0).map(x => x.habit_id)).size
}

// A closed day's state: no check, every habit due that week checked, or some of them.
export function closedState(row: HabitDay, targets: HabitTarget[]): 'all' | 'partial' | 'none' {
  if (row.checks <= 0) return 'none'
  return row.checks >= habitsDue(row.day, targets) ? 'all' : 'partial'
}

// The checks on the phone for `day`, one per habit, only of habits the store knows.
export function openChecks(day: string, open: HabitCheck[], habits: Habit[]): string[] {
  const known = new Set(habits.map(h => h.id))
  return [...new Set(open.filter(c => c.day === day && known.has(c.habit_id)).map(c => c.habit_id))]
}

// The glyph of the state with, on a day with checks, the count beside it in tabular mono.
function iconWith(state: HabitDayState, count: number | null): ReactNode {
  const glyph = HABIT_DAY_STATE[state].icon()
  if (count == null) return glyph
  return createElement('span', { className: 'inline-flex items-center gap-0.5' },
    glyph, createElement('span', { className: 'font-mono text-[11px] leading-none tabular-nums' }, count))
}

// The month as Monday-first rows of cells. nutrition/history buildMonth lays the grid out and
// decides future, open, inside or outside a period; a closed day then speaks for itself (its
// number is its valid checks), and an older day with checks on the phone but no closed row yet
// stays open. `open` is the store's checks (yesterday and this week, with the ones not sent yet).
export function buildHabitsMonth(month: string, history: HabitHistory, open: HabitCheck[], habits: Habit[], today: string): CalendarWeek[] {
  const byDay = new Map(history.days.map(d => [d.day, d]))
  return buildMonth(month, [], [], history.periods, today).map(row => ({
    start: row.start,
    cells: row.cells.map(c => {
      if (!c.inMonth) return null
      const closed = byDay.get(c.day)
      const pending = openChecks(c.day, open, habits).length
      let state: HabitDayState
      let count: number | null = null
      let detail = ''
      if (c.future) state = 'future'
      else if (closed && c.state !== 'open') {
        state = closedState(closed, history.targets)
        if (state !== 'none') {
          count = closed.valid
          detail = `, ${countedText(closed.valid)}`
        }
      } else if (c.state === 'open' || pending > 0) {
        // Today, yesterday, or a day with checks that closed before the phone heard back: still
        // to confirm, never "Nothing checked".
        state = 'open'
        if (pending > 0) {
          count = pending
          detail = `, ${checksText(pending)}`
        }
      } else state = c.state === 'inactive' ? 'inactive' : 'none'
      const label = HABIT_DAY_STATE[state].label()
      const cell: CalendarCell = {
        day: c.day,
        state,
        label,
        icon: iconWith(state, count),
        accessibleText: `${dayDate(c.day)}: ${label}${detail}`,
        selectable: state !== 'future' && state !== 'inactive',
        current: c.day === today,
      }
      return cell
    }),
  }))
}

// Navigation runs from the month of the first period that covers a day to this month.
export function monthBounds(periods: HabitPeriod[], today: string): { min: string; max: string } {
  const max = monthOf(today)
  return { min: firstMonth(periods) ?? max, max }
}

// A month's closed days from the server (or the saved copy), only when it holds a day inside a
// period that has already closed: a month before the first period, between periods, or whose
// active days are all still open asks nothing and is null.
export function loadHabitsMonth(month: string, periods: HabitPeriod[], today: string): Promise<HabitHistory | null> {
  if (!monthRange(month, periods, today)) return Promise.resolve(null)
  return useHabits.getState().loadMonth(month)
}
