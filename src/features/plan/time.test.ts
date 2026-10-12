import { describe, expect, it } from 'vitest'
import { estimateMinutes } from './time'

describe('estimateMinutes', () => {
  it('adds sets × (rest + 40 s) and 5 min of warm-up, rounded up to the minute', () => {
    const ex = ['a', 'b', 'c'].map(id => ({ id, sets: 3, restSec: 90 }))
    // 9 × 130 + 300 = 1470 s = 24.5 min
    expect(estimateMinutes({ ex })).toBe(25)
  })

  it('uses 90 s for an exercise with no rest of its own', () => {
    expect(estimateMinutes({ ex: [{ id: 'a', sets: 3 }, { id: 'b', sets: 2, restSec: 0 }] })).toBe(estimateMinutes({ ex: [{ id: 'a', sets: 5, restSec: 90 }] }))
    // 5 × 130 + 300 = 950 s = 15.8 min
    expect(estimateMinutes({ ex: [{ id: 'a', sets: 5 }] })).toBe(16)
  })

  it('uses the exercise rest when it has one', () => {
    // 4 × 220 + 300 = 1180 s = 19.7 min
    expect(estimateMinutes({ ex: [{ id: 'a', sets: 4, restSec: 180 }] })).toBe(20)
  })

  it('is the warm-up alone for an empty routine', () => {
    expect(estimateMinutes({ ex: [] })).toBe(5)
  })
})
