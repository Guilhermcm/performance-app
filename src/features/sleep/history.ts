// The sleep calendar's month (spec 7.2, plan decision 17): the nights of a month as cells for
// MonthCalendar. The grid, the periods and what to ask the server come from the nutrition history
// (same {started_on, ended_on} periods); only the states and their words are the night's own.
import { createElement, type ReactNode } from 'react'
import { Check, Circle, CircleDashed, Clock, Dot, Minus } from 'lucide-react'
import type { CalendarCell, CalendarWeek } from '@/components/calendar/MonthCalendar'
import { t } from '../../lib/i18n.js'
import { buildMonth, firstMonth, monthOf, monthRange } from '../nutrition/history'
import { classifyNight } from './classify'
import { nightDate, nightStatus, nightSummary } from './labels'
import { goalOf, targetAt } from './goal'
import { fmtDuration } from './time'
import { useSleep } from './useSleep'
import type { SleepHistory, SleepLog, SleepNight, SleepPeriod, SleepTarget } from './types'

// on_target, logged (off target, or with no goal in force) and none come from a closed night; open
// is today or yesterday, which can still change; inactive is outside every period; future is a
// night still to come.
export type NightState = 'on_target' | 'logged' | 'none' | 'inactive' | 'open' | 'future'

// Icon and words per state, never colour alone: the same shapes as the nutrition calendar.
export const NIGHT_STATE: Record<NightState, { label: () => string; icon: () => ReactNode }> = {
  on_target: { label: () => t('On target'), icon: () => createElement(Check, { className: 'size-4', strokeWidth: 3 }) },
  logged: { label: () => t('Off target'), icon: () => createElement(Dot, { className: 'size-5', strokeWidth: 4 }) },
  none: { label: () => t('Not logged'), icon: () => createElement(Circle, { className: 'size-3' }) },
  open: { label: () => t('Still open'), icon: () => createElement(CircleDashed, { className: 'size-3.5' }) },
  inactive: { label: () => t('Not tracked'), icon: () => createElement(Minus, { className: 'size-3' }) },
  future: { label: () => t('Not yet'), icon: () => createElement(Clock, { className: 'size-3' }) },
}
export const NIGHT_LEGEND: NightState[] = ['on_target', 'logged', 'none', 'open', 'inactive', 'future']

// A night as the sheet shows it: the closed row when there is one; else its log, judged by the goal
// in force that night (still to confirm, no XP yet): today's or yesterday's, or an older one whose
// day has closed but whose closed row the phone has not received yet; else a night with nothing logged.
export function nightAt(night: string, nights: SleepNight[], logs: Record<string, SleepLog>, targets: SleepTarget[]): SleepNight {
  const row = nights.find(n => n.night === night)
  if (row) return row
  const target = goalOf(targetAt(targets, night))
  const log = logs[night]
  if (log) {
    return {
      ...classifyNight(log, target), night, target, xp: 0,
      duration_min: log.duration_min, quality: log.quality, bed_time: log.bed_time, wake_time: log.wake_time, note: log.note
    }
  }
  return {
    night, logged: false, on_target: false, rested: false, bed_diff_min: null, target, xp: 0,
    duration_min: null, quality: null, bed_time: null, wake_time: null, note: null
  }
}

// The month as Monday-first rows of cells. nutrition/history buildMonth lays the grid out and
// decides future, open, inside or outside a period; a closed night then speaks for its day, and an
// older day with a log but no closed row yet stays open.
export function buildSleepMonth(
  month: string, nights: SleepNight[], logs: Record<string, SleepLog>, periods: SleepPeriod[], targets: SleepTarget[], today: string,
): CalendarWeek[] {
  const byNight = new Map(nights.map(n => [n.night, n]))
  return buildMonth(month, [], [], periods, today).map(row => ({
    start: row.start,
    cells: row.cells.map(c => {
      if (!c.inMonth) return null
      const closed = byNight.get(c.day)
      const log = logs[c.day]
      let state: NightState
      let label: string
      let detail = ''
      if (c.future) state = 'future'
      else if (closed && c.state !== 'open') {
        state = closed.on_target ? 'on_target' : closed.logged ? 'logged' : 'none'
        if (closed.logged && closed.duration_min != null) detail = `, ${fmtDuration(closed.duration_min)}`
      } else if (c.state === 'open' || log) {
        // Today, yesterday, or a logged night whose day closed before the phone heard back: still
        // to confirm, never "Not logged".
        state = 'open'
        if (log) detail = `, ${fmtDuration(log.duration_min)}, ${nightSummary(log, goalOf(targetAt(targets, c.day)))}`
      } else state = c.state === 'inactive' ? 'inactive' : 'none'
      // A night with no goal in force was only recorded, not judged (plan decision 5).
      if (state === 'logged' && closed) label = nightStatus(closed, closed.target ? { valid_from: closed.night, ...closed.target } : null).text
      else label = NIGHT_STATE[state].label()
      const cell: CalendarCell = {
        day: c.day,
        state,
        label,
        icon: NIGHT_STATE[state].icon(),
        accessibleText: `${nightDate(c.day)}: ${label}${detail}`,
        selectable: state !== 'future' && state !== 'inactive',
        current: c.day === today,
      }
      return cell
    }),
  }))
}

// Navigation runs from the month of the first period that covers a night to this month.
export function monthBounds(periods: SleepPeriod[], today: string): { min: string; max: string } {
  const max = monthOf(today)
  return { min: firstMonth(periods) ?? max, max }
}

// A month's closed nights from the server (or the saved copy), only when it holds a night inside a
// period that has already closed: a month before the first period, between periods, or whose
// active nights are all still open asks nothing and is null.
export function loadSleepMonth(month: string, periods: SleepPeriod[], today: string): Promise<SleepHistory | null> {
  if (!monthRange(month, periods, today)) return Promise.resolve(null)
  return useSleep.getState().loadMonth(month)
}
