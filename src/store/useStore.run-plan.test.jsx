// @vitest-environment happy-dom
// Phase 1e-a, Review Focus 5: a saved state from an older client (or another device) has no
// runPlan, and one may hold a plan of a version this build does not know. Both must load.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentWeek, sessionsOn } from '../features/run/run-actions'

vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const saved = extra => ({ _ts: 1, unit: 'kg', lang: 'en', routines: [], week: { 1: ['a'] }, workouts: [], ...extra })

async function load(S) {
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  return useStore.getState().S
}

afterEach(() => localStorage.clear())

describe('runPlan in the saved state', () => {
  it('defaults to null', async () => {
    const { DEF } = await import('./useStore.js')
    expect(DEF.runPlan).toBeNull()
  })

  it('a state saved without runPlan loads with runPlan null', async () => {
    const S = await load(saved({}))
    expect(S.runPlan).toBeNull()
    expect(S.week).toEqual({ 1: ['a'] })
  })

  it('a plan of an unknown version loads and reads as no current week', async () => {
    const S = await load(saved({ runPlan: { version: 99, weeks: [{ index: 1, sessions: [{ id: 'x', day: 1 }] }], startDate: '2026-10-19' } }))
    expect(S.runPlan.version).toBe(99)
    expect(currentWeek(S.runPlan, '2026-10-19', 1)).toBeNull()
    expect(sessionsOn(S.runPlan, '2026-10-19', 1)).toEqual([])
  })
})
