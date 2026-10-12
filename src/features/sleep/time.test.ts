import { describe, it, expect } from 'vitest'
import {
  toMinutes, fromMinutes, shiftClock, durationMin, circularDiff, signedDeviation, bedDate, validDuration,
  fmtDuration, fmtClock, fmtGap,
} from './time'

describe('sleep time rules', () => {
  it('converts between HH:MM and minutes, wrapping at 24h', () => {
    expect(toMinutes('00:00')).toBe(0)
    expect(toMinutes('23:30')).toBe(1410)
    expect(fromMinutes(1410)).toBe('23:30')
    expect(fromMinutes(1440)).toBe('00:00')
    expect(fromMinutes(-10)).toBe('23:50')
    expect(fromMinutes(1500)).toBe('01:00')
  })

  it('shifts a clock across midnight', () => {
    expect(shiftClock('23:45', 30)).toBe('00:15')
    expect(shiftClock('00:10', -15)).toBe('23:55')
  })

  it('measures the sleep from bed to wake across midnight', () => {
    expect(durationMin('23:30', '07:10')).toBe(460)
    expect(durationMin('01:00', '08:00')).toBe(420)
    expect(durationMin('23:00', '23:00')).toBe(0)
  })

  it('measures the circular distance and the signed deviation', () => {
    expect(circularDiff('23:30', '00:10')).toBe(40)
    expect(circularDiff('11:00', '23:00')).toBe(720)
    expect(circularDiff('22:15', '23:00')).toBe(45)
    expect(signedDeviation('00:10', '23:00')).toBe(70)
    expect(signedDeviation('22:50', '23:00')).toBe(-10)
    expect(signedDeviation('11:00', '23:00')).toBe(720)
    expect(signedDeviation('11:01', '23:00')).toBe(-719)
  })

  it('dates the bedtime: before wake means the same day, otherwise the day before', () => {
    expect(bedDate('2026-10-07', '23:30', '07:10')).toBe('2026-10-06')
    expect(bedDate('2026-10-07', '01:00', '08:00')).toBe('2026-10-07')
    expect(bedDate('2026-10-01', '23:30', '07:10')).toBe('2026-09-30')
    expect(bedDate('2026-01-01', '22:00', '06:00')).toBe('2025-12-31')
  })

  it('accepts 60 to 960 minutes', () => {
    expect([59, 60, 960, 961].map(validDuration)).toEqual([false, true, true, false])
  })

  it('formats durations as 7h 05, 8h and 40 min', () => {
    expect(fmtDuration(460)).toBe('7h 40')
    expect(fmtDuration(425)).toBe('7h 05')
    expect(fmtDuration(480)).toBe('8h')
    expect(fmtDuration(40)).toBe('40 min')
    expect(fmtDuration(0)).toBe('0')
  })

  it('writes a gap compactly: "25 min", "1h", "1h10"', () => {
    expect(fmtGap(25)).toBe('25 min')
    expect(fmtGap(60)).toBe('1h')
    expect(fmtGap(70)).toBe('1h10')
    expect(fmtGap(125)).toBe('2h05')
    expect(fmtGap(-70)).toBe('1h10')
  })

  it('formats the clock in 12h or 24h by the locale', () => {
    expect(fmtClock('23:00', 'en-US')).toBe('11:00 PM')
    expect(fmtClock('23:00', 'pt-BR')).toBe('23:00')
    expect(fmtClock('00:05', 'pt-BR')).toBe('00:05')
    expect(fmtClock('09:05', 'en-US')).toBe('9:05 AM')
    expect(fmtClock('09:05', 'pt-BR')).toBe('09:05')
  })
})
