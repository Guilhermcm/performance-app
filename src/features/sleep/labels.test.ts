import { describe, it, expect } from 'vitest'
import { QUALITY_LABEL, nightStatus } from './labels'
import { targetOf } from './test-sleep'

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
    expect(nightStatus({ ...cls, bed_diff_min: null }, null)).toEqual({ text: 'Logged', on: false })
  })
  it('says not logged without a record', () => {
    expect(nightStatus(null, targetOf())).toEqual({ text: 'Not logged', on: false })
    expect(nightStatus({ logged: false, on_target: false, rested: false, bed_diff_min: null }, targetOf())).toEqual({ text: 'Not logged', on: false })
  })
})
