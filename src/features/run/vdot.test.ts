// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import { formatPace, formatPaceRange, predictMinutes, requiredVdot, velocityAt, vdotFrom, zonePaces } from './vdot'

const sec = (m: number, s: number) => m * 60 + s
afterEach(async () => { await setLang('en') })

describe('vdotFrom', () => {
  it('matches the Daniels and Gilbert reference values', () => {
    expect(vdotFrom(5000, 20)).toBeCloseTo(49.8, 0)
    expect(Math.abs(vdotFrom(5000, 20) - 49.8)).toBeLessThanOrEqual(0.2)
    expect(Math.abs(vdotFrom(5000, 25) - 38.3)).toBeLessThanOrEqual(0.2)
    expect(Math.abs(vdotFrom(5000, 30) - 30.8)).toBeLessThanOrEqual(0.2)
  })
  it('keeps one decimal', () => {
    for (const [d, m] of [[5000, 21.37], [10000, 47.9], [21097.5, 111]]) {
      const v = vdotFrom(d, m)
      expect(Math.round(v * 10) / 10).toBe(v)
    }
  })
  it('requiredVdot is the same function', () => {
    expect(requiredVdot(10000, 50)).toBe(vdotFrom(10000, 50))
  })
})

describe('velocityAt', () => {
  it('solves the oxygen cost equation for the positive root', () => {
    const v = velocityAt(50, 0.8)
    expect(v).toBeGreaterThan(0)
    expect(-4.6 + 0.182258 * v + 0.000104 * v * v).toBeCloseTo(40, 6)
  })
})

describe('predictMinutes', () => {
  it('predicts race times from a VDOT', () => {
    expect(Math.abs(predictMinutes(50, 5000) * 60 - sec(19, 57))).toBeLessThanOrEqual(3)
    expect(Math.abs(predictMinutes(40, 10000) * 60 - sec(50, 3))).toBeLessThanOrEqual(10)
    expect(Math.abs(predictMinutes(60, 5000) * 60 - sec(17, 3))).toBeLessThanOrEqual(3)
  })
  it('round-trips with vdotFrom', () => {
    expect(vdotFrom(10000, predictMinutes(45, 10000))).toBeCloseTo(45, 0)
  })
})

describe('zonePaces', () => {
  it('asserts the spec §4.2 fraction-model values for VDOT 50, not the Daniels table, rounded to 5 s', () => {
    const z = zonePaces(50)
    expect(z.easy.slow).toBeGreaterThanOrEqual(sec(5, 45))
    expect(z.easy.slow).toBeLessThanOrEqual(sec(5, 55))
    expect(z.easy.fast).toBeGreaterThanOrEqual(sec(4, 50))
    expect(z.easy.fast).toBeLessThanOrEqual(sec(5, 0))
    expect(z.hard.fast).toBeGreaterThanOrEqual(sec(3, 45))
    expect(z.hard.fast).toBeLessThanOrEqual(sec(3, 55))
    for (const zone of [z.easy, z.moderate, z.hard]) {
      expect(zone.fast % 5).toBe(0)
      expect(zone.slow % 5).toBe(0)
    }
  })
  it('orders the zones from easy (slowest) to hard (fastest)', () => {
    const z = zonePaces(40)
    expect(z.easy.fast).toBeGreaterThan(z.moderate.slow - 1)
    expect(z.moderate.fast).toBeGreaterThan(z.hard.slow - 1)
    expect(z.hard.fast).toBeLessThan(z.moderate.fast)
  })
  it('stays valid for out of range references', () => {
    for (const [d, m] of [[1000, 3], [42195, 360], [5000, 15]]) {
      const v = vdotFrom(d, m)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
      const z = zonePaces(v)
      for (const zone of [z.easy, z.moderate, z.hard]) {
        expect(Number.isNaN(zone.fast) || Number.isNaN(zone.slow)).toBe(false)
        expect(zone.fast).toBeGreaterThan(0)
        expect(zone.fast).toBeLessThan(zone.slow)
      }
    }
  })
})

describe('formatPace', () => {
  it('writes m:ss', () => {
    expect(formatPace(340)).toBe('5:40')
    expect(formatPace(365)).toBe('6:05')
  })
  it('writes the range in English with to', () => {
    expect(formatPaceRange({ fast: 340, slow: 355 })).toBe('5:40 to 5:55 /km')
  })
  it('writes a range with the unit', async () => {
    await setLang('pt-BR')
    expect(formatPaceRange({ fast: 340, slow: 355 })).toBe('5:40 a 5:55 /km')
  })
})
