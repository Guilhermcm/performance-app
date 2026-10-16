import { describe, it, expect } from 'vitest'
import { daySummaries, labelCounts, movingAverage, periodStats } from './stats'
import { entryOf, trackerOf } from './test-trackers'

const WATER = trackerOf({ aggregate: 'sum' })
const WEIGHT = trackerOf({ name: 'Weight', unit: 'kg', aggregate: 'avg' })
const SLEEP = trackerOf({ name: 'Nap', kind: 'duration', unit: null, decimals: null, aggregate: 'sum' })

describe('daySummaries', () => {
  it('sums the entries of a day', () => {
    const s = daySummaries(WATER, [entryOf('2026-10-10', { value: 0.5 }), entryOf('2026-10-10', { value: 0.25 }), entryOf('2026-10-10', { value: 1 })])
    expect(s.get('2026-10-10')).toEqual({ value: 1.75, count: 3 })
  })

  it('averages the entries of a day', () => {
    const s = daySummaries(WEIGHT, [entryOf('2026-10-10', { value: 72 }), entryOf('2026-10-10', { value: 73 })])
    expect(s.get('2026-10-10')).toEqual({ value: 72.5, count: 2 })
  })

  it('leaves a day with no entry out of the map', () => {
    const s = daySummaries(WATER, [entryOf('2026-10-10')])
    expect(s.has('2026-10-11')).toBe(false)
    expect([...s.keys()]).toEqual(['2026-10-10'])
  })

  it('reads minutes for a duration', () => {
    const s = daySummaries(SLEEP, [entryOf('2026-10-10', { value: null, minutes: 30 }), entryOf('2026-10-10', { value: null, minutes: 45 })])
    expect(s.get('2026-10-10')).toEqual({ value: 75, count: 2 })
  })

  it('has no summaries for a label tracker', () => {
    const label = trackerOf({ kind: 'label', aggregate: null, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] })
    expect(daySummaries(label, [entryOf('2026-10-10', { value: null, option: 'a' })]).size).toBe(0)
  })
})

describe('movingAverage', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']

  it('averages only the days with an entry, across a gap', () => {
    const summaries = new Map([['2026-10-01', { value: 2 }], ['2026-10-03', { value: 4 }], ['2026-10-04', { value: 6 }]])
    const out = movingAverage(summaries, days)
    expect(out.slice(0, 5)).toEqual([2, 2, 3, 4, 4])
  })

  it('is null when the window of 7 days is empty', () => {
    const summaries = new Map([['2026-10-01', { value: 2 }]])
    const out = movingAverage(summaries, days)
    expect(out[6]).toBe(2) // 10-07 still has 10-01 in [d - 6, d]
    expect(out[7]).toBeNull() // 10-08: the window starts 10-02
    expect(out[9]).toBeNull()
  })

  it('slides by calendar days, not by position in the list', () => {
    const summaries = new Map([['2026-10-01', { value: 10 }], ['2026-10-09', { value: 2 }]])
    expect(movingAverage(summaries, ['2026-10-09', '2026-10-10'])).toEqual([2, 2])
  })
})

describe('periodStats', () => {
  const today = '2026-10-16'
  const entries = [
    entryOf('2026-10-02', { value: 2 }),
    entryOf('2026-10-05', { value: 4 }),
    entryOf('2026-10-05', { value: 1 }),
    entryOf('2026-10-12', { value: 6 }),
    entryOf('2026-10-15', { value: 3 }),
    entryOf('2026-09-01', { value: 100 }), // before the period
  ]

  it('reads average, min, max and days with entries over the period', () => {
    const s = periodStats(WATER, entries, '2026-09-17', '2026-10-16', today)
    expect(s).toMatchObject({ average: 4, min: 2, max: 6, daysWithEntries: 4 })
    expect(s.average).toBe((2 + 5 + 6 + 3) / 4)
  })

  it('has nothing to say about an empty period', () => {
    const s = periodStats(WATER, [], '2026-09-17', '2026-10-16', today)
    expect(s).toEqual({ average: null, min: null, max: null, daysWithEntries: 0, daysSinceLast: null })
  })

  it('counts the days since the last entry', () => {
    const at = (day: string) => periodStats(WATER, [entryOf(day)], '2026-09-17', '2026-10-16', today).daysSinceLast
    expect(at('2026-10-16')).toBe(0)
    expect(at('2026-10-15')).toBe(1)
    expect(at('2026-10-11')).toBe(5)
    expect(periodStats(WATER, [], '2026-09-17', '2026-10-16', today).daysSinceLast).toBeNull()
  })

  it('takes the last entry from the whole window, not only the period', () => {
    const s = periodStats(WATER, [entryOf('2026-10-15')], '2026-09-01', '2026-09-30', today)
    expect(s.daysWithEntries).toBe(0)
    expect(s.daysSinceLast).toBe(1)
  })

  it('uses minutes for a duration', () => {
    const s = periodStats(SLEEP, [entryOf('2026-10-14', { value: null, minutes: 30 }), entryOf('2026-10-15', { value: null, minutes: 90 })], '2026-10-01', today, today)
    expect(s).toMatchObject({ average: 60, min: 30, max: 90, daysWithEntries: 2, daysSinceLast: 1 })
  })

  it('counts days for a label tracker without numbers', () => {
    const label = trackerOf({ kind: 'label', aggregate: null, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] })
    const s = periodStats(label, [entryOf('2026-10-15', { value: null, option: 'a' }), entryOf('2026-10-15', { value: null, option: 'b' })], '2026-10-01', today, today)
    expect(s).toEqual({ average: null, min: null, max: null, daysWithEntries: 1, daysSinceLast: 1 })
  })
})

describe('labelCounts', () => {
  const MOOD = trackerOf({ kind: 'label', aggregate: null, unit: null, decimals: null, options: [{ id: 'o1', text: 'Calm' }, { id: 'o2', text: 'Tense' }, { id: 'o3', text: 'Great' }] })

  it('counts per option in the order of the options, zeros included', () => {
    const out = labelCounts(MOOD, [entryOf('2026-10-10', { value: null, option: 'o3' }), entryOf('2026-10-11', { value: null, option: 'o1' }), entryOf('2026-10-12', { value: null, option: 'o3' })])
    expect(out.map(c => [c.option.id, c.count])).toEqual([['o1', 1], ['o2', 0], ['o3', 2]])
  })

  it('counts an entry of a renamed option under its id', () => {
    const renamed = { ...MOOD, options: [{ id: 'o1', text: 'Peaceful' }, ...MOOD.options!.slice(1)] }
    const out = labelCounts(renamed, [entryOf('2026-10-10', { value: null, option: 'o1' })])
    expect(out[0]).toEqual({ option: { id: 'o1', text: 'Peaceful' }, count: 1 })
  })

  it('ignores an entry whose option is gone', () => {
    expect(labelCounts(MOOD, [entryOf('2026-10-10', { value: null, option: 'zz' })]).every(c => c.count === 0)).toBe(true)
  })

  it('is empty for a tracker with no options', () => {
    expect(labelCounts(WATER, [])).toEqual([])
  })
})
