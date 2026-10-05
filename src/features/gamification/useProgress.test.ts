// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({ fetchProgress: vi.fn() }))
vi.mock('./progress-api', () => api)

import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

const badge = (code: string) => ({ code, unlocked_at: '2026-10-07T20:00:00Z' })
const P1 = progressOf(400)
const P2 = progressOf(800, { workouts: 3, target_hit: true }, { achievements: [badge('week_target_1')] })

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  api.fetchProgress.mockReset()
})

describe('useProgress', () => {
  it('loads, caches and gets ready', async () => {
    api.fetchProgress.mockResolvedValue(P1)
    const loading = useProgress.getState().load('u1')
    expect(useProgress.getState().status).toBe('loading')
    await loading
    expect(useProgress.getState()).toMatchObject({ status: 'ready', progress: P1, stale: false, pending: [] })
    expect(JSON.parse(localStorage.getItem('perf_progress_v1')!)).toEqual({ userId: 'u1', value: P1 })
  })

  it('shows the cached copy at once and marks it stale until the server answers', async () => {
    localStorage.setItem('perf_progress_v1', JSON.stringify({ userId: 'u1', value: P1 }))
    let answer!: (p: unknown) => void
    api.fetchProgress.mockReturnValue(new Promise(r => { answer = r }))
    const loading = useProgress.getState().load('u1')
    expect(useProgress.getState()).toMatchObject({ status: 'ready', progress: P1, stale: true })
    answer(P2)
    await loading
    expect(useProgress.getState()).toMatchObject({ progress: P2, stale: false })
  })

  it('keeps the cache when offline and errors without one', async () => {
    api.fetchProgress.mockRejectedValue(new Error('offline'))
    await useProgress.getState().load('u1')
    expect(useProgress.getState()).toMatchObject({ status: 'error', progress: null })
    localStorage.setItem('perf_progress_v1', JSON.stringify({ userId: 'u1', value: P1 }))
    await useProgress.getState().load('u1')
    expect(useProgress.getState()).toMatchObject({ status: 'ready', progress: P1, stale: true })
  })

  it('celebrates only what is new since the first load, once', async () => {
    api.fetchProgress.mockResolvedValue(P1)
    await useProgress.getState().load('u1')
    expect(useProgress.getState().pending).toEqual([])
    api.fetchProgress.mockResolvedValue(P2)
    await useProgress.getState().refresh()
    expect(useProgress.getState().pending).toEqual([{ kind: 'level', level: 5 }, { kind: 'achievement', code: 'week_target_1' }])
    expect(useProgress.getState().takePending()).toHaveLength(2)
    expect(useProgress.getState().pending).toEqual([])
    await useProgress.getState().refresh()
    expect(useProgress.getState().pending).toEqual([])
  })

  it('runs one follow-up when asked during a refresh', async () => {
    api.fetchProgress.mockResolvedValue(P1)
    useProgress.setState({ userId: 'u1' })
    await Promise.all([useProgress.getState().refresh(), useProgress.getState().refresh(), useProgress.getState().refresh()])
    expect(api.fetchProgress).toHaveBeenCalledTimes(2)
  })

  it('drops an answer that arrives after a sign-out', async () => {
    let answer!: (p: unknown) => void
    api.fetchProgress.mockReturnValue(new Promise(r => { answer = r }))
    const loading = useProgress.getState().load('u1')
    useProgress.getState().reset()
    answer(P1)
    await loading
    expect(useProgress.getState()).toMatchObject({ status: 'idle', progress: null, userId: null })
    expect(localStorage.getItem('perf_progress_v1')).toBeNull()
  })

  it('holds celebrations on request', () => {
    useProgress.getState().hold(true)
    expect(useProgress.getState().held).toBe(true)
    useProgress.getState().hold(false)
    expect(useProgress.getState().held).toBe(false)
  })
})
