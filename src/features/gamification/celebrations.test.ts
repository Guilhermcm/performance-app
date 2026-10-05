import { describe, it, expect } from 'vitest'
import { celebrationsSince, markerOf } from './celebrations'
import { progressOf } from './test-progress'

const badge = (code: string) => ({ code, unlocked_at: '2026-10-07T20:00:00Z' })

describe('celebrations', () => {
  it('celebrates a level-up first, then new badges in catalogue order', () => {
    const seen = markerOf(progressOf(90, {}, { achievements: [badge('first_workout')] }))
    const now = progressOf(700, {}, { achievements: [badge('first_workout'), badge('early_bird'), badge('first_pr')] })
    expect(celebrationsSince(seen, now)).toEqual([
      { kind: 'level', level: 5 },
      { kind: 'achievement', code: 'first_pr' },
      { kind: 'achievement', code: 'early_bird' }
    ])
  })

  it('has nothing to say when nothing changed', () => {
    const p = progressOf(700, {}, { achievements: [badge('first_workout')] })
    expect(celebrationsSince(markerOf(p), p)).toEqual([])
  })
})
