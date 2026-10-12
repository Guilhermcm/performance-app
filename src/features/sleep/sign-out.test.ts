// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { clearSleepLocal } from './sign-out'

describe('clearSleepLocal', () => {
  beforeEach(() => localStorage.clear())

  it('forgets the night already told and the saved months, and keeps the unsent queue', () => {
    for (const k of ['perf_sleep_outbox_v1', 'perf_sleep_seen_v1', 'perf_sleep_history_v1', 'perf_other']) localStorage.setItem(k, '1')
    clearSleepLocal()
    expect(localStorage.getItem('perf_sleep_outbox_v1')).toBe('1')
    expect(localStorage.getItem('perf_sleep_seen_v1')).toBeNull()
    expect(localStorage.getItem('perf_sleep_history_v1')).toBeNull()
    expect(localStorage.getItem('perf_other')).toBe('1')
  })
})
