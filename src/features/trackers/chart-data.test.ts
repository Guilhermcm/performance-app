// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { lineDescription, labelDescription, mostFrequent, periodDays, valueTicks, tickText } from './chart-data'
import { setLang } from '../../lib/i18n.js'
import { trackerOf } from './test-trackers'

const WATER = trackerOf()
const READING = trackerOf({ kind: 'duration', unit: null, decimals: null, aggregate: 'sum' })
const MOOD_ROWS = [
  { option: { id: 'ruim0001', text: 'ruim' }, count: 3 },
  { option: { id: 'bom00001', text: 'bom' }, count: 12 },
  { option: { id: 'otimo001', text: 'ótimo' }, count: 5 },
]

afterEach(async () => { await setLang('en') })

describe('periodDays', () => {
  it('lists the days of the period, oldest first and ending today', () => {
    const days = periodDays('2026-10-14', 30)
    expect(days).toHaveLength(30)
    expect(days[0]).toBe('2026-09-15')
    expect(days[29]).toBe('2026-10-14')
  })
})

describe('lineDescription', () => {
  it('gives the average of the period stats and how many days had an entry', async () => {
    const stats = { average: 2, daysWithEntries: 3 }
    expect(lineDescription(WATER, 30, stats)).toBe('Average of 2.0 L over the last 30 days, 3 days with entries')
    await setLang('pt-BR')
    expect(lineDescription(WATER, 30, stats)).toBe('Média de 2,0 L nos últimos 30 dias, 3 dias com registro')
  })

  it('says one day, and the duration in hours and minutes', () => {
    expect(lineDescription(READING, 90, { average: 85, daysWithEntries: 1 })).toBe('Average of 1 h 25 min over the last 90 days, 1 day with entries')
  })

  it('keeps hours past a day for a duration over 24 h', () => {
    expect(lineDescription(READING, 30, { average: 1570, daysWithEntries: 2 })).toBe('Average of 26 h 10 min over the last 30 days, 2 days with entries')
  })

  it('names the average of an avg tracker the same way', () => {
    const weight = trackerOf({ unit: 'kg', aggregate: 'avg' })
    expect(lineDescription(weight, 30, { average: 72.44, daysWithEntries: 5 })).toBe('Average of 72.4 kg over the last 30 days, 5 days with entries')
  })

  it('says there is nothing in the period', async () => {
    expect(lineDescription(WATER, 30, { average: null, daysWithEntries: 0 })).toBe('No entries in the last 30 days')
    await setLang('pt-BR')
    expect(lineDescription(WATER, 90, { average: null, daysWithEntries: 0 })).toBe('Nenhum registro nos últimos 90 dias')
  })
})

describe('mostFrequent and labelDescription', () => {
  it('names the option picked most, and the first one in option order on a tie', () => {
    expect(mostFrequent(MOOD_ROWS)?.option.text).toBe('bom')
    expect(mostFrequent([{ ...MOOD_ROWS[0], count: 4 }, { ...MOOD_ROWS[1], count: 4 }])?.option.text).toBe('ruim')
    expect(mostFrequent(MOOD_ROWS.map(r => ({ ...r, count: 0 })))).toBeNull()
  })

  it('describes the period in words', async () => {
    expect(labelDescription(MOOD_ROWS, 30)).toBe('Most frequent: bom, 12 of 20 entries')
    expect(labelDescription([{ ...MOOD_ROWS[0], count: 1 }, { ...MOOD_ROWS[1], count: 0 }], 30)).toBe('Most frequent: ruim, 1 of 1 entry')
    expect(labelDescription(MOOD_ROWS.map(r => ({ ...r, count: 0 })), 90)).toBe('No entries in the last 90 days')
    await setLang('pt-BR')
    expect(labelDescription(MOOD_ROWS, 30)).toBe('Mais frequente: bom, 12 de 20 registros')
  })
})

describe('valueTicks and tickText', () => {
  it('steps a duration in whole hours past one hour, from zero', () => {
    const ticks = valueTicks(READING, [90, 150])
    expect(ticks).toEqual([0, 60, 120, 180])
    expect(ticks.map(v => tickText(READING, v, ticks))).toEqual(['0 min', '1 h', '2 h', '3 h'])
  })

  it('steps a short duration in minutes, and a day past 24 hours stays in hours', () => {
    expect(valueTicks(READING, [20, 45])).toEqual([0, 15, 30, 45])
    expect(valueTicks(READING, [1500]).map(v => tickText(READING, v, valueTicks(READING, [1500])))).toContain('32 h')
  })

  it('steps a number in round values that cover every point, in the language notation', async () => {
    const ticks = valueTicks(WATER, [1.5, 2.5])
    expect(ticks[0]).toBeLessThanOrEqual(1.5)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(2.5)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    await setLang('pt-BR')
    expect(tickText(WATER, 2.5, [2, 2.5, 3])).toBe('2,5')
  })

  it('never steps below the tracker decimals, and keeps one value apart from its neighbours', () => {
    const steps = trackerOf({ unit: 'passos', decimals: 0 })
    const one = valueTicks(steps, [8000])
    expect(one.length).toBeGreaterThanOrEqual(2)
    expect(one.every(Number.isInteger)).toBe(true)
    expect(valueTicks(trackerOf({ decimals: 0 }), [3, 4]).every(Number.isInteger)).toBe(true)
  })
})
