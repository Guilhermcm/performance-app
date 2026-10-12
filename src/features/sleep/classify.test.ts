import { describe, it, expect } from 'vitest'
import { classifyNight } from './classify'

describe('classifyNight', () => {
  const target = { goal_min: 480, bed_target: '23:00' }

  it('counts nothing for a night without a log', () => {
    expect(classifyNight(null, target)).toEqual({ logged: false, on_target: false, rested: false, bed_diff_min: null })
  })

  it('only logs a night without a target in force', () => {
    expect(classifyNight({ bed_time: '23:00', duration_min: 480, quality: 5 }, null))
      .toEqual({ logged: true, on_target: false, rested: false, bed_diff_min: null })
  })

  it('takes 15 minutes under the goal and 45 from the bedtime, both inclusive', () => {
    const c = (bed_time: string, duration_min: number, quality: number | null = null) =>
      classifyNight({ bed_time, duration_min, quality }, target).on_target
    expect(c('23:00', 465)).toBe(true)
    expect(c('23:00', 464)).toBe(false)
    expect(c('23:45', 480)).toBe(true)
    expect(c('23:46', 480)).toBe(false)
    expect(c('22:15', 480)).toBe(true)
    expect(c('22:14', 480)).toBe(false)
  })

  it('rests on target with quality 4 or more', () => {
    expect(classifyNight({ bed_time: '23:00', duration_min: 480, quality: 4 }, target).rested).toBe(true)
    expect(classifyNight({ bed_time: '23:00', duration_min: 480, quality: 3 }, target).rested).toBe(false)
    expect(classifyNight({ bed_time: '23:00', duration_min: 400, quality: 5 }, target).rested).toBe(false)
  })
})
