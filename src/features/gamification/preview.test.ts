import { describe, it, expect } from 'vitest'
import { displayStreak, linesFromProgress, previewWorkout } from './preview'
import { progressOf } from './test-progress'

const today = '2026-10-07'

describe('previewWorkout', () => {
  it('pays the next planned session', () => {
    expect(previewWorkout(progressOf(400), { occurredOn: today, prs: 0 }))
      .toEqual({ lines: [{ kind: 'workout', amount: 200, index: 2, of: 3 }], total: 200 })
  })

  it('adds the weekly goal on the T-th session', () => {
    const p = previewWorkout(progressOf(400, { workouts: 2 }), { occurredOn: today, prs: 0 })
    expect(p).toEqual({ lines: [{ kind: 'workout', amount: 200, index: 3, of: 3 }, { kind: 'goal', amount: 150 }], total: 350 })
  })

  it('pays extras until two and then nothing', () => {
    expect(previewWorkout(progressOf(400, { workouts: 3, extras: 1, target_hit: true }), { occurredOn: today, prs: 0 })?.lines)
      .toEqual([{ kind: 'extra', amount: 25 }])
    expect(previewWorkout(progressOf(400, { workouts: 3, extras: 2, target_hit: true }), { occurredOn: today, prs: 0 }))
      .toEqual({ lines: [], total: 0 })
  })

  it('pays only the PRs left in the weekly limit', () => {
    expect(previewWorkout(progressOf(400, { prs: 2 }), { occurredOn: today, prs: 3 })?.lines)
      .toContainEqual({ kind: 'pr', amount: 30, count: 1 })
  })

  it('gives up on another week or without progress', () => {
    expect(previewWorkout(progressOf(400), { occurredOn: '2026-10-02', prs: 0 })).toBeNull()
    expect(previewWorkout(null, { occurredOn: today, prs: 0 })).toBeNull()
  })
})

describe('linesFromProgress', () => {
  it('explains the server difference line by line', () => {
    const before = progressOf(400)
    const after = progressOf(400 + 200 + 200 + 150 + 30 + 75, { workouts: 3, prs: 1, target_hit: true },
      { achievements: [{ code: 'week_target_1', unlocked_at: '2026-10-07T20:00:00Z' }] })
    expect(linesFromProgress(before, after)).toEqual([
      { kind: 'workout', amount: 200, index: 2, of: 3 },
      { kind: 'workout', amount: 200, index: 3, of: 3 },
      { kind: 'goal', amount: 150 },
      { kind: 'pr', amount: 30, count: 1 },
      { kind: 'achievement', amount: 75, code: 'week_target_1' }
    ])
  })

  it('puts what it cannot name under other gains', () => {
    const before = progressOf(400)
    const after = progressOf(700, {}, { week: { ...progressOf(0).week, start: '2026-10-12' } })
    expect(linesFromProgress(before, after)).toEqual([{ kind: 'other', amount: 300 }])
  })
})

describe('displayStreak', () => {
  it('counts the running week once its goal is met', () => {
    expect(displayStreak(progressOf(0, {}, { streak: { current: 2, best: 4, shields: 0 } }))).toBe(2)
    expect(displayStreak(progressOf(0, { target_hit: true }, { streak: { current: 2, best: 4, shields: 0 } }))).toBe(3)
  })
})
