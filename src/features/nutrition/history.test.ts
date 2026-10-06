// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  activeOn, buildMonth, firstMonth, isSettled, monthHasActiveDay, monthRange, readHistory, shiftMonth, writeHistory,
  type MonthCell, type Period
} from './history'
import type { NutritionDay, NutritionWeek } from './types'

const TODAY = '2026-10-06' // a Tuesday
const SINCE_SEPT: Period[] = [{ started_on: '2026-09-20', ended_on: null }]

const dayOf = (day: string, over: Partial<NutritionDay> = {}): NutritionDay => ({
  day, kcal: 2300, protein_g: 150, carbs_g: 260, fat_g: 70, meals: 3,
  target: { kcal: 2400, protein_g: 160, carbs_g: 270, fat_g: 70 },
  logged: true, on_target: true, balanced: false, imported: false, xp: 40, ...over
})
const weekOf = (start: string, over: Partial<NutritionWeek> = {}): NutritionWeek => ({ start, target: 5, on_target: 4, target_hit: false, ...over })
const cell = (rows: { cells: MonthCell[] }[], day: string) => rows.flatMap(r => r.cells).find(c => c.day === day)!

describe('month arithmetic', () => {
  it('shifts months across years', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('starts navigation at the month of the first period that covers a day', () => {
    expect(firstMonth([])).toBeNull()
    // Turned on and off the same day: the period covers no day.
    expect(firstMonth([{ started_on: '2026-05-10', ended_on: '2026-05-09' }, { started_on: '2026-08-03', ended_on: null }])).toBe('2026-08')
  })

  it('knows the days inside a period', () => {
    const p: Period[] = [{ started_on: '2026-08-01', ended_on: '2026-08-31' }, { started_on: '2026-10-01', ended_on: null }]
    expect(activeOn(p, '2026-07-31')).toBe(false)
    expect(activeOn(p, '2026-08-31')).toBe(true)
    expect(activeOn(p, '2026-09-15')).toBe(false)
    expect(activeOn(p, '2026-10-20')).toBe(true)
  })
})

describe('buildMonth', () => {
  it('lays the month out Monday first, whole weeks, with the days of other months marked', () => {
    const rows = buildMonth('2026-10', [], [], SINCE_SEPT, TODAY)
    expect(rows.map(r => r.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(rows.every(r => r.cells.length === 7)).toBe(true)
    expect(cell(rows, '2026-09-30').inMonth).toBe(false)
    expect(cell(rows, '2026-10-01').inMonth).toBe(true)
    expect(cell(rows, '2026-11-01').inMonth).toBe(false)
  })

  it('gives each day its state: on target, logged, not logged, open, outside the period', () => {
    const days = [
      dayOf('2026-10-01'),
      dayOf('2026-10-02', { on_target: false }),
      dayOf('2026-10-03', { logged: false, on_target: false, meals: 1 }),
    ]
    const rows = buildMonth('2026-10', days, [], SINCE_SEPT, TODAY)
    expect(cell(rows, '2026-10-01').state).toBe('on_target')
    expect(cell(rows, '2026-10-02').state).toBe('logged')
    expect(cell(rows, '2026-10-03').state).toBe('none')
    // Inside the period with no closed row: nothing logged.
    expect(cell(rows, '2026-10-04').state).toBe('none')
    // Yesterday and today can still change.
    expect(cell(rows, '2026-10-05').state).toBe('open')
    expect(cell(rows, TODAY).state).toBe('open')
    expect(cell(rows, '2026-10-07')).toMatchObject({ state: 'inactive', future: true })
    expect(cell(rows, '2026-10-01').data?.xp).toBe(40)
  })

  it('fades the days before the pillar was turned on and after it was turned off', () => {
    const rows = buildMonth('2026-10', [], [], [{ started_on: '2026-10-03', ended_on: null }], TODAY)
    expect(cell(rows, '2026-10-02')).toMatchObject({ state: 'inactive', future: false })
    expect(cell(rows, '2026-10-03').state).toBe('none')
    const off = buildMonth('2026-10', [], [], [{ started_on: '2026-09-01', ended_on: '2026-10-02' }], TODAY)
    expect(cell(off, '2026-10-02').state).toBe('none')
    expect(cell(off, '2026-10-03').state).toBe('inactive')
    expect(cell(off, TODAY).state).toBe('inactive')
  })

  it('puts the week summary on the weeks that counted, never on weeks to come or outside the period', () => {
    const weeks = [weekOf('2026-09-28', { on_target: 4, target_hit: false }), weekOf('2026-10-05', { on_target: 0 }), weekOf('2026-10-12')]
    const rows = buildMonth('2026-10', [], weeks, SINCE_SEPT, TODAY)
    expect(rows[0].summary).toEqual(weeks[0])
    expect(rows[1].summary).toEqual(weeks[1])
    expect(rows[2].summary).toBeNull()
    const late = buildMonth('2026-10', [], weeks, [{ started_on: '2026-10-05', ended_on: null }], TODAY)
    expect(late[0].summary).toBeNull()
  })
})

describe('what to ask the server', () => {
  it('asks for the month up to today when it holds a closed day inside a period', () => {
    expect(monthRange('2026-10', SINCE_SEPT, TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(monthRange('2026-09', SINCE_SEPT, TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('asks nothing for a month without an active day, or whose active days are all still open', () => {
    const gap: Period[] = [{ started_on: '2026-08-01', ended_on: '2026-08-31' }, { started_on: '2026-10-01', ended_on: null }]
    expect(monthHasActiveDay('2026-09', gap, TODAY)).toBe(false)
    expect(monthRange('2026-09', gap, TODAY)).toBeNull()
    // Before activation.
    expect(monthHasActiveDay('2026-07', gap, TODAY)).toBe(false)
    expect(monthRange('2026-07', gap, TODAY)).toBeNull()
    // Turned on yesterday: two open days, nothing closed to read yet.
    const fresh: Period[] = [{ started_on: '2026-10-05', ended_on: null }]
    expect(monthHasActiveDay('2026-10', fresh, TODAY)).toBe(true)
    expect(monthRange('2026-10', fresh, TODAY)).toBeNull()
  })

  it('treats a month as settled once every day of its weeks had closed when it was read', () => {
    // September's last row runs to Sunday 4 October, which closes on the 6th.
    expect(isSettled('2026-09', '2026-10-05')).toBe(false)
    expect(isSettled('2026-09', '2026-10-06')).toBe(true)
    expect(isSettled('2026-10', TODAY)).toBe(false)
  })
})

describe('history cache', () => {
  beforeEach(() => localStorage.clear())

  it('keeps months and periods per account', () => {
    const data = { target: null, days: [dayOf('2026-09-21')], weeks: [weekOf('2026-09-21')] }
    writeHistory({ userId: 'a', periods: SINCE_SEPT, months: { '2026-09': { fetchedOn: TODAY, data } } })
    expect(readHistory('a').months['2026-09'].data).toEqual(data)
    expect(readHistory('a').periods).toEqual(SINCE_SEPT)
    const other = readHistory('b')
    expect(other).toEqual({ userId: 'b', periods: null, months: {} })
  })

  it('survives a broken saved copy', () => {
    localStorage.setItem('perf_nutrition_history_v1', '{nope')
    expect(readHistory('a')).toEqual({ userId: 'a', periods: null, months: {} })
  })
})
