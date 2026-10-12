import { describe, it, expect } from 'vitest'
import { QUALITY_LABEL, nightStatus, nightSummary, confirmsOn } from './labels'
import { logOf, targetOf } from './test-sleep'

describe('QUALITY_LABEL', () => {
  it('names the five levels', () => {
    expect([1, 2, 3, 4, 5].map(q => QUALITY_LABEL[q as 1 | 2 | 3 | 4 | 5]())).toEqual(['Terrible', 'Poor', 'Okay', 'Good', 'Great'])
  })
})

describe('nightStatus', () => {
  const cls = { logged: true, on_target: false, rested: false, bed_diff_min: 10 }
  it('reads a night that hit the goal as on target', () => {
    expect(nightStatus({ ...cls, on_target: true }, targetOf())).toEqual({ text: 'On target', on: true })
  })
  it('reads a logged night that missed it as off target', () => {
    expect(nightStatus(cls, targetOf())).toEqual({ text: 'Off target', on: false })
  })
  it('only says logged when no goal was in force', () => {
    expect(nightStatus({ ...cls, bed_diff_min: null }, null)).toEqual({ text: 'Logged night', on: false })
  })
  it('says not logged without a record', () => {
    expect(nightStatus(null, targetOf())).toEqual({ text: 'Not logged', on: false })
    expect(nightStatus({ logged: false, on_target: false, rested: false, bed_diff_min: null }, targetOf())).toEqual({ text: 'Not logged', on: false })
  })
})

describe('nightSummary (plan decision 10)', () => {
  const target = targetOf({ goal_min: 480, bed_target: '23:00' })
  it('reads on target', () => {
    expect(nightSummary(logOf({ bed_time: '23:20', wake_time: '07:10', duration_min: 470 }), target)).toBe('on target')
    // The bounds are inclusive: 15 minutes short of the goal, 45 minutes off the bedtime.
    expect(nightSummary(logOf({ bed_time: '23:45', wake_time: '07:30', duration_min: 465 }), target)).toBe('on target')
  })
  it('only says logged with no goal in force', () => {
    expect(nightSummary(logOf({ bed_time: '01:00', wake_time: '05:00', duration_min: 240 }), null)).toBe('logged')
  })
  it('names the bedtime first when it is more than 45 minutes off, after or before', () => {
    expect(nightSummary(logOf({ bed_time: '00:10', wake_time: '08:10', duration_min: 480 }), target)).toBe('off target: went to bed 1h10 after the target')
    expect(nightSummary(logOf({ bed_time: '21:30', wake_time: '03:00', duration_min: 330 }), target)).toBe('off target: went to bed 1h30 before the target')
  })
  it('otherwise names how far under the goal the night was', () => {
    expect(nightSummary(logOf({ bed_time: '23:00', wake_time: '06:35', duration_min: 455 }), target)).toBe('off target: slept 25 min under the goal')
  })
})

describe('confirmsOn', () => {
  it('names the weekday of the date as a whole sentence', () => {
    expect(confirmsOn('2026-10-09')).toBe('Confirms on Friday')
    expect(confirmsOn('2026-10-10')).toBe('Confirms on Saturday')
    expect(confirmsOn('2026-10-11')).toBe('Confirms on Sunday')
  })
})
