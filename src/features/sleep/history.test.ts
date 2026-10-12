// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isValidElement } from 'react'

const h = vi.hoisted(() => ({ fetchNights: vi.fn() }))
vi.mock('./sleep-api', async orig => ({ ...(await orig<typeof import('./sleep-api')>()), fetchNights: h.fetchNights }))

import { buildSleepMonth, loadSleepMonth, monthBounds, nightAt } from './history'
import { useSleep } from './useSleep'
import { ME, logOf, nightOf, targetOf } from './test-sleep'
import type { CalendarCell, CalendarWeek } from '@/components/calendar/MonthCalendar'
import type { SleepPeriod } from './types'

const TODAY = '2026-10-07' // a Wednesday
const YESTERDAY = '2026-10-06'
const SINCE_SEPT: SleepPeriod[] = [{ started_on: '2026-09-20', ended_on: null }]
const TARGETS = [targetOf({ valid_from: '2026-09-20' })]

const cells = (weeks: CalendarWeek[]) => weeks.flatMap(w => w.cells).filter((c): c is CalendarCell => c != null)
const cell = (weeks: CalendarWeek[], day: string) => cells(weeks).find(c => c.day === day)!

describe('buildSleepMonth', () => {
  it('lays the month out Monday first and leaves the days of other months blank', () => {
    const weeks = buildSleepMonth('2026-10', [], {}, SINCE_SEPT, TARGETS, TODAY)
    expect(weeks.map(w => w.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(weeks[0].cells.slice(0, 3)).toEqual([null, null, null])
    expect(weeks[0].cells[3]?.day).toBe('2026-10-01')
    expect(cells(weeks)).toHaveLength(31)
  })

  it('gives each night its state of plan decision 17, with a label and an icon', () => {
    const nights = [
      nightOf({ night: '2026-10-01' }),
      nightOf({ night: '2026-10-02', on_target: false, bed_time: '00:30', bed_diff_min: 90 }),
      nightOf({ night: '2026-10-03', logged: false, on_target: false, duration_min: null, bed_time: null, wake_time: null, bed_diff_min: null }),
    ]
    const weeks = buildSleepMonth('2026-10', nights, {}, SINCE_SEPT, TARGETS, TODAY)
    const expected: [string, string, string][] = [
      ['2026-10-01', 'on_target', 'On target'],
      ['2026-10-02', 'logged', 'Off target'],
      ['2026-10-03', 'none', 'Not logged'],
      // Inside the period, closed, with no row: nothing logged.
      ['2026-10-04', 'none', 'Not logged'],
      // Yesterday and today can still change.
      [YESTERDAY, 'open', 'Still open'],
      [TODAY, 'open', 'Still open'],
      ['2026-10-08', 'future', 'Not yet'],
    ]
    for (const [day, state, label] of expected) {
      const c = cell(weeks, day)
      expect(c.state, day).toBe(state)
      expect(c.label, day).toBe(label)
      expect(isValidElement(c.icon), day).toBe(true)
      expect(c.accessibleText, day).toContain(label)
    }
    // The words say how long the night was, never the colour alone.
    expect(cell(weeks, '2026-10-01').accessibleText).toBe('Thursday 1 October: On target, 7h 50')
  })

  it('calls a night logged with no goal in force just logged', () => {
    const weeks = buildSleepMonth('2026-10', [nightOf({ night: '2026-10-01', on_target: false, target: null, bed_diff_min: null })], {}, SINCE_SEPT, TARGETS, TODAY)
    expect(cell(weeks, '2026-10-01')).toMatchObject({ state: 'logged', label: 'Logged' })
  })

  it('marks today as current and does not let a day to come be picked', () => {
    const weeks = buildSleepMonth('2026-10', [], {}, SINCE_SEPT, TARGETS, TODAY)
    expect(cell(weeks, TODAY).current).toBe(true)
    expect(cells(weeks).filter(c => c.current).map(c => c.day)).toEqual([TODAY])
    expect(cell(weeks, TODAY).selectable).not.toBe(false)
    for (const c of cells(weeks).filter(c => c.day > TODAY)) expect(c, c.day).toMatchObject({ state: 'future', selectable: false })
  })

  it('fades the nights outside a period and does not let them be picked', () => {
    const periods: SleepPeriod[] = [{ started_on: '2026-09-01', ended_on: '2026-10-02' }, { started_on: '2026-10-05', ended_on: null }]
    const weeks = buildSleepMonth('2026-10', [], {}, periods, TARGETS, TODAY)
    expect(cell(weeks, '2026-10-02').state).toBe('none')
    expect(cell(weeks, '2026-10-03')).toMatchObject({ state: 'inactive', label: 'Not tracked', selectable: false })
    expect(cell(weeks, '2026-10-04')).toMatchObject({ state: 'inactive', selectable: false })
    expect(cell(weeks, '2026-10-05').state).toBe('none')
    // Turned off yesterday: today is outside every period, though it has not closed.
    const off = buildSleepMonth('2026-10', [], {}, [{ started_on: '2026-09-01', ended_on: YESTERDAY }], TARGETS, TODAY)
    expect(cell(off, YESTERDAY).state).toBe('open')
    expect(cell(off, TODAY)).toMatchObject({ state: 'inactive', selectable: false })
  })

  it('says how an open night is going so far, against the goal in force that night', () => {
    const logs = { [TODAY]: logOf({ night: TODAY, bed_time: '23:20', wake_time: '07:10', duration_min: 470 }) }
    const weeks = buildSleepMonth('2026-10', [], logs, SINCE_SEPT, TARGETS, TODAY)
    expect(cell(weeks, TODAY).accessibleText).toBe('Wednesday 7 October: Still open, 7h 50, on target')
    expect(cell(weeks, YESTERDAY).accessibleText).toBe('Tuesday 6 October: Still open')
  })
})

describe('nightAt', () => {
  it('is the closed row when there is one', () => {
    const row = nightOf({ night: '2026-10-01', xp: 130 })
    expect(nightAt('2026-10-01', [row], {}, TARGETS)).toBe(row)
  })

  it('reads an open night from its log, judged by the goal in force that night', () => {
    const targets = [targetOf({ valid_from: '2026-09-01', goal_min: 540 }), targetOf({ valid_from: TODAY, goal_min: 420 })]
    const log = logOf({ night: YESTERDAY, bed_time: '23:10', wake_time: '06:50', duration_min: 460, quality: 4, note: 'ok' })
    expect(nightAt(YESTERDAY, [], { [YESTERDAY]: log }, targets)).toMatchObject({
      night: YESTERDAY, logged: true, on_target: false, duration_min: 460, quality: 4, note: 'ok',
      bed_time: '23:10', wake_time: '06:50', target: { goal_min: 540, bed_target: '23:00' }, xp: 0
    })
  })

  it('is a night without a log, with its goal, when nothing was logged', () => {
    expect(nightAt('2026-10-04', [], {}, TARGETS)).toMatchObject({
      night: '2026-10-04', logged: false, on_target: false, duration_min: null, bed_time: null, target: { goal_min: 480, bed_target: '23:00' }, xp: 0
    })
  })
})

describe('monthBounds', () => {
  it('goes back no further than the month of the first period that covers a night', () => {
    const periods: SleepPeriod[] = [{ started_on: '2026-05-10', ended_on: '2026-05-09' }, { started_on: '2026-08-03', ended_on: '2026-08-20' }, ...SINCE_SEPT]
    expect(monthBounds(periods, TODAY)).toEqual({ min: '2026-08', max: '2026-10' })
  })

  it('stays on this month with no period known', () => {
    expect(monthBounds([], TODAY)).toEqual({ min: '2026-10', max: '2026-10' })
  })
})

describe('loadSleepMonth', () => {
  const realSleep = useSleep.getState()
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T15:00:00Z')) // noon in Sao Paulo
    localStorage.clear()
    h.fetchNights.mockReset()
    h.fetchNights.mockResolvedValue({ nights: [nightOf({ night: '2026-09-21' })], weeks: [], periods: SINCE_SEPT })
    useSleep.setState({ ...realSleep, userId: ME })
  })
  afterEach(() => { vi.useRealTimers(); useSleep.setState(realSleep) })

  it('asks nothing for a month without an active night', async () => {
    const gap: SleepPeriod[] = [{ started_on: '2026-08-01', ended_on: '2026-08-31' }, { started_on: '2026-10-01', ended_on: null }]
    expect(await loadSleepMonth('2026-09', gap, TODAY)).toBeNull()
    expect(await loadSleepMonth('2026-07', gap, TODAY)).toBeNull()
    // Turned on yesterday: two open nights, nothing closed to read yet.
    expect(await loadSleepMonth('2026-10', [{ started_on: YESTERDAY, ended_on: null }], TODAY)).toBeNull()
    expect(h.fetchNights).not.toHaveBeenCalled()
  })

  it('reads a month with a closed night inside a period', async () => {
    const data = await loadSleepMonth('2026-09', SINCE_SEPT, TODAY)
    expect(h.fetchNights).toHaveBeenCalledWith('2026-09-01', '2026-09-30')
    expect(data?.nights.map(n => n.night)).toEqual(['2026-09-21'])
  })
})
