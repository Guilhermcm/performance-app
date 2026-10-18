import { describe, expect, it } from 'vitest'
import { entriesOf, isRunDetail, type CheckinDetail } from './types'

const STRENGTH: CheckinDetail = { unit: 'kg', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }
const RUN: CheckinDetail = { run: { status: 'unplanned', rpe: 5 } }

describe('the detail of a check-in', () => {
  it('tells a run detail from a strength one', () => {
    expect(isRunDetail(RUN)).toBe(true)
    expect(isRunDetail(STRENGTH)).toBe(false)
    expect(isRunDetail(null)).toBe(false)
    expect(isRunDetail(undefined)).toBe(false)
  })

  it('has the sets of a strength detail, and none for a run or no detail', () => {
    expect(entriesOf(STRENGTH)).toEqual(STRENGTH.entries)
    expect(entriesOf({ run: { status: 'unplanned', rpe: 5 } })).toEqual([])
    expect(entriesOf(null)).toEqual([])
    // A detail some other build wrote without entries reads as none, too.
    expect(entriesOf({} as never)).toEqual([])
  })
})
