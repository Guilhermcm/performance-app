// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
const api = vi.hoisted(() => ({ fetchMyRunCheckins: vi.fn() }))
vi.mock('../checkin/checkin-api', async orig => ({ ...(await orig<typeof import('../checkin/checkin-api')>()), ...api }))

import { useRunLogs, useRunLogStore, type RunLog } from './run-log'
import { useCheckins, type MyCheckin } from '../checkin/useCheckins'
import { SocialError } from '../social/social-api'
import type { RunPlan } from './types'

const ME = '00000000-0000-4000-8000-00000000000a'
const START = '2026-10-05'

const plan: RunPlan = {
  version: 1, goal: '10k', goalType: 'finish', startDate: START, weekStart: 1,
  answers: { goal: '10k', reference: { kind: 'none' }, days: 3, longDay: 0 },
  vdotSource: null, dismissed: {},
  weeks: [{ index: 1, phase: 'base', recovery: false, sessions: [{ id: 'w1-s1', type: 'easy', day: 1, blocks: [{ zone: 'easy', min: 30 }] }] }]
}

const mineRow = (id: string, over: Partial<MyCheckin> = {}): MyCheckin => ({
  id, user_id: ME, day: '2026-10-12', activity: 'run', routine_id: null, routine_name: null, title: 'Corrida', caption: null,
  note: null, duration_min: 40, visibility: 'friends', photo_path: `${ME}/${id}.jpg`, created_at: '2026-10-12T10:00:00.000Z',
  detail: { run: { status: 'unplanned', distance_km: 7 } }, ...over
})
const serverLog = (id: string, over: Partial<RunLog> = {}): RunLog =>
  ({ id, day: '2026-10-06', duration_min: 30, run: null, ...over })

beforeEach(() => {
  api.fetchMyRunCheckins.mockReset()
  useRunLogStore.getState().reset()
  useCheckins.setState({ userId: ME, mine: [] })
})
afterEach(() => { cleanup() })

describe('useRunLogs', () => {
  it('reads my run check-ins from the plan start and lays the ones on this phone over them by id', async () => {
    api.fetchMyRunCheckins.mockResolvedValue([
      serverLog('a'),
      serverLog('b', { day: '2026-10-12', duration_min: 20 })
    ])
    useCheckins.setState({
      mine: [
        // An edit not sent yet of a check-in that is up: this phone's copy wins.
        mineRow('b', { pending: true, duration_min: 45 }),
        // A check-in made offline.
        mineRow('c', { pending: true, day: '2026-10-13', detail: null }),
        // Not a run, and a run from before the plan: left out.
        mineRow('d', { activity: 'strength', detail: null }),
        mineRow('e', { day: '2026-10-04' })
      ]
    })
    const { result } = renderHook(() => useRunLogs(plan))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.fetchMyRunCheckins).toHaveBeenCalledTimes(1)
    expect(api.fetchMyRunCheckins).toHaveBeenCalledWith(START)
    expect(result.current.logs).toEqual([
      { id: 'a', day: '2026-10-06', duration_min: 30, run: null },
      { id: 'b', day: '2026-10-12', duration_min: 45, run: { status: 'unplanned', distance_km: 7 } },
      { id: 'c', day: '2026-10-13', duration_min: 40, run: null }
    ])
  })

  it('without a connection, keeps the check-ins on this phone', async () => {
    api.fetchMyRunCheckins.mockRejectedValue(new SocialError('network'))
    useCheckins.setState({ mine: [mineRow('c', { pending: true })] })
    const { result } = renderHook(() => useRunLogs(plan))
    await waitFor(() => expect(result.current.status).toBe('offline'))
    expect(result.current.logs.map(l => l.id)).toEqual(['c'])
  })

  it('a check-in made offline still counts once it is up and no longer pending', async () => {
    api.fetchMyRunCheckins.mockResolvedValue([serverLog('a')])
    useCheckins.setState({ mine: [mineRow('c', { pending: true })] })
    const { result } = renderHook(() => useRunLogs(plan))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    useCheckins.setState({ mine: [mineRow('c')] })
    await waitFor(() => expect(result.current.logs.map(l => l.id)).toEqual(['a', 'c']))
  })

  it('reads once per opening, and again on the next one', async () => {
    api.fetchMyRunCheckins.mockResolvedValue([serverLog('a')])
    const first = renderHook(() => useRunLogs(plan))
    renderHook(() => useRunLogs(plan))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    expect(api.fetchMyRunCheckins).toHaveBeenCalledTimes(1)
    cleanup()
    api.fetchMyRunCheckins.mockResolvedValue([serverLog('a'), serverLog('f')])
    const again = renderHook(() => useRunLogs(plan))
    await waitFor(() => expect(again.result.current.logs.map(l => l.id)).toEqual(['a', 'f']))
    expect(api.fetchMyRunCheckins).toHaveBeenCalledTimes(2)
  })

  it('is idle without a plan this build reads, or without an account', () => {
    expect(renderHook(() => useRunLogs(null)).result.current).toEqual({ logs: [], status: 'idle' })
    useCheckins.setState({ userId: null })
    expect(renderHook(() => useRunLogs(plan)).result.current).toEqual({ logs: [], status: 'idle' })
    expect(api.fetchMyRunCheckins).not.toHaveBeenCalled()
  })

  it('never shows the history of another account', async () => {
    api.fetchMyRunCheckins.mockResolvedValue([serverLog('a')])
    const { result, rerender } = renderHook(() => useRunLogs(plan))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    api.fetchMyRunCheckins.mockReturnValue(new Promise(() => {}))
    useCheckins.setState({ userId: '00000000-0000-4000-8000-00000000000b', mine: [] })
    rerender()
    expect(result.current.logs).toEqual([])
  })
})
