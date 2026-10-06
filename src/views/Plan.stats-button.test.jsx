// @vitest-environment happy-dom
// Stats left the tab bar for Nutrition (Phase 2a); the Plan header carries it now, next to Exercises.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({ S: state.S, user: null, update: () => {} })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(), confirmSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  mocks.nav = vi.fn()
  mocks.S = { unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {}, routines: [] }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Plan header', () => {
  it('opens Stats from its own button', () => {
    act(() => { root.render(<Plan />) })
    const btn = host.querySelector('.hdr button[aria-label="Stats"]')
    expect(btn).toBeTruthy()
    act(() => { btn.click() })
    expect(mocks.nav).toHaveBeenCalledWith('/stats')
  })
})
