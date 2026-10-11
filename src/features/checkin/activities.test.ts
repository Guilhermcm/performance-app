import { describe, it, expect } from 'vitest'
import { ACTIVITIES, activityLabel } from './activities'
import { CHECKIN_ACTIVITIES } from './types'

describe('activities', () => {
  it('lists every activity the database accepts, in the order of the chips', () => {
    expect([...ACTIVITIES]).toEqual(['strength', 'run', 'bike', 'swim', 'walk', 'sport', 'class', 'other'])
    expect([...ACTIVITIES].sort()).toEqual([...CHECKIN_ACTIVITIES].sort())
  })

  it('names each one, all different', () => {
    const names = ACTIVITIES.map(activityLabel)
    expect(names).toEqual(['Strength training', 'Running', 'Cycling', 'Swimming', 'Walking', 'Sport', 'Class', 'Other activity'])
    expect(new Set(names).size).toBe(names.length)
  })
})
