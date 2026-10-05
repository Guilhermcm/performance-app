// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ flush: vi.fn(), fetchProgress: vi.fn() }))
vi.mock('./events', () => ({ flush: h.flush }))
vi.mock('./progress-api', () => ({ fetchProgress: h.fetchProgress }))

import { syncProgress, weighInXp } from './after-event'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  useProgress.setState({ userId: 'u1' })
  h.flush.mockReset()
  h.fetchProgress.mockReset()
})

describe('syncProgress', () => {
  it('is confirmed when the queue emptied and the server answered', async () => {
    h.flush.mockResolvedValue({ sent: 2, left: 0 })
    h.fetchProgress.mockResolvedValue(progressOf(600))
    await expect(syncProgress()).resolves.toEqual({ progress: progressOf(600), confirmed: true })
  })

  it('is not confirmed while events wait in the queue', async () => {
    h.flush.mockResolvedValue({ sent: 0, left: 2 })
    h.fetchProgress.mockResolvedValue(progressOf(400))
    expect((await syncProgress()).confirmed).toBe(false)
  })

  it('is not confirmed when the server does not answer', async () => {
    h.flush.mockResolvedValue({ sent: 0, left: 0 })
    h.fetchProgress.mockRejectedValue(new Error('offline'))
    await expect(syncProgress()).resolves.toEqual({ progress: null, confirmed: false })
  })
})

describe('weighInXp', () => {
  it('is 10 for the first weigh-in of today and 0 otherwise', () => {
    useProgress.setState({ progress: progressOf(400) })
    expect(weighInXp('2026-10-07')).toBe(10)
    expect(weighInXp('2026-10-06')).toBe(0)
    useProgress.setState({ progress: progressOf(400, { weighed_today: true }) })
    expect(weighInXp('2026-10-07')).toBe(0)
    useProgress.setState({ progress: null })
    expect(weighInXp('2026-10-07')).toBe(0)
  })
})
