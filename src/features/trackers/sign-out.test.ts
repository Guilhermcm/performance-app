// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { clearTrackersLocal } from './sign-out'

describe('clearTrackersLocal', () => {
  beforeEach(() => localStorage.clear())

  it('forgets the saved copy and keeps the unsent queue', () => {
    for (const k of ['perf_trackers_outbox_v1', 'perf_trackers_v1', 'perf_habits_v1']) localStorage.setItem(k, '1')
    clearTrackersLocal()
    expect(localStorage.getItem('perf_trackers_outbox_v1')).toBe('1')
    expect(localStorage.getItem('perf_trackers_v1')).toBeNull()
    expect(localStorage.getItem('perf_habits_v1')).toBe('1')
  })
})
