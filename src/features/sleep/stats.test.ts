import { describe, it, expect } from 'vitest'
import { averageDuration, regularity, weekDebt, nightsOnTarget, type StatNight } from './stats'
import type { NightClass, SleepNight } from './types'

const n = (night: string, bed_time = '23:00', duration_min = 480, goal_min: number | null = 480): StatNight =>
  ({ night, bed_time, duration_min, goal_min })

describe('regularity', () => {
  it('is the population SD of the signed bedtime deviation, rounded to the minute', () => {
    const nights = [n('2026-10-08', '22:50'), n('2026-10-09', '23:10'), n('2026-10-10', '23:30'), n('2026-10-11', '00:10')]
    expect(regularity(nights, '2026-10-12', '23:00')).toEqual({ sd: 30, label: 'stable' })
  })

  it('needs three nights in the last 14 days', () => {
    expect(regularity([n('2026-10-10'), n('2026-10-11')], '2026-10-12', '23:00')).toBeNull()
    expect(regularity([n('2026-10-10'), n('2026-10-11'), n('2026-09-20')], '2026-10-12', '23:00')).toBeNull()
  })

  it('labels up to 30 stable, up to 60 ok and above irregular', () => {
    const spread = (d: number) => [n('2026-10-09', '23:00'), n('2026-10-10', '23:00'), n('2026-10-11', '23:00'), n('2026-10-12', '23:00')]
      .map((x, i) => ({ ...x, bed_time: i % 2 ? shift('23:00', d) : shift('23:00', -d) }))
    const shift = (hhmm: string, by: number) => {
      const m = ((Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + by) % 1440 + 1440) % 1440
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    }
    expect(regularity(spread(30), '2026-10-12', '23:00')).toEqual({ sd: 30, label: 'stable' })
    expect(regularity(spread(31), '2026-10-12', '23:00')?.label).toBe('ok')
    expect(regularity(spread(60), '2026-10-12', '23:00')).toEqual({ sd: 60, label: 'ok' })
    expect(regularity(spread(61), '2026-10-12', '23:00')?.label).toBe('irregular')
  })

  it('lets the target decide where midnight falls', () => {
    const nights = [n('2026-10-10', '23:30'), n('2026-10-11', '00:30'), n('2026-10-12', '01:30')]
    expect(regularity(nights, '2026-10-12', '00:30')?.sd).toBe(Math.round(Math.sqrt(2 * 3600 / 3)))
  })
})

describe('averageDuration', () => {
  const nights = [n('2026-10-12', '23:00', 420), n('2026-10-10', '23:00', 480), n('2026-10-06', '23:00', 540), n('2026-09-20', '23:00', 300)]
  it('averages only the logged nights in the window', () => {
    expect(averageDuration(nights, '2026-10-12', 7)).toBe(480)
    expect(averageDuration(nights, '2026-10-12', 30)).toBe(435)
  })
  it('is null with no night in the window', () => {
    expect(averageDuration([], '2026-10-12', 7)).toBeNull()
    expect(averageDuration([n('2026-10-05')], '2026-10-12', 7)).toBeNull()
  })
  it('includes the first day of the window and excludes the day before', () => {
    expect(averageDuration([n('2026-10-06', '23:00', 400)], '2026-10-12', 7)).toBe(400)
    expect(averageDuration([n('2026-10-05', '23:00', 400)], '2026-10-12', 7)).toBeNull()
  })
})

describe('weekDebt', () => {
  it('sums what each logged night fell short of its goal, without offsetting', () => {
    const nights = [n('2026-10-12', '23:00', 450), n('2026-10-13', '23:00', 500), n('2026-10-14', '23:00', 470)]
    expect(weekDebt(nights, '2026-10-14')).toBe(40)
  })
  it('is 0 with no nights', () => {
    expect(weekDebt([], '2026-10-14')).toBe(0)
  })
  it('leaves out last Sunday on a Monday', () => {
    expect(weekDebt([n('2026-10-11', '23:00', 300)], '2026-10-12')).toBe(0)
    expect(weekDebt([n('2026-10-11', '23:00', 300), n('2026-10-12', '23:00', 440)], '2026-10-12')).toBe(40)
  })
  it('skips nights without a goal and nights after today', () => {
    expect(weekDebt([n('2026-10-12', '23:00', 300, null), n('2026-10-15', '23:00', 300)], '2026-10-14')).toBe(0)
  })
})

describe('nightsOnTarget', () => {
  const on: NightClass = { logged: true, on_target: true, rested: false, bed_diff_min: 0 }
  const off: NightClass = { logged: true, on_target: false, rested: false, bed_diff_min: 60 }
  const closed = (night: string, cls: NightClass): SleepNight => ({
    ...cls, night, duration_min: 480, quality: null, target: { goal_min: 480, bed_target: '23:00' }, xp: 0,
    bed_time: '23:00', wake_time: '07:00', note: null,
  })
  it('counts the closed nights on target this week plus the preview of the open ones', () => {
    const c = [closed('2026-10-12', on), closed('2026-10-13', on), closed('2026-10-14', on), closed('2026-10-15', off), closed('2026-10-11', on)]
    expect(nightsOnTarget(c, [{ night: '2026-10-16', cls: on }, { night: '2026-10-17', cls: off }], '2026-10-17', 5))
      .toEqual({ closed: 3, preview: 1, target: 5 })
  })
  it('is empty with no nights', () => {
    expect(nightsOnTarget([], [], '2026-10-14', 3)).toEqual({ closed: 0, preview: 0, target: 3 })
  })
})
