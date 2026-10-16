// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { clearHabitsLocal } from './sign-out'

describe('clearHabitsLocal', () => {
  beforeEach(() => localStorage.clear())

  it('forgets the saved copy and the saved months, and keeps the unsent queue', () => {
    for (const k of ['perf_habits_outbox_v1', 'perf_habits_v1', 'perf_habits_history_v1', 'perf_other']) localStorage.setItem(k, '1')
    clearHabitsLocal()
    expect(localStorage.getItem('perf_habits_outbox_v1')).toBe('1')
    expect(localStorage.getItem('perf_habits_v1')).toBeNull()
    expect(localStorage.getItem('perf_habits_history_v1')).toBeNull()
    expect(localStorage.getItem('perf_other')).toBe('1')
  })
})
