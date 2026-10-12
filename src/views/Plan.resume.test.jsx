// @vitest-environment happy-dom
// The tab bar's center button is the check-in now (phase 1c), so a workout in progress is
// resumed from the Plan.
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
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(), confirmSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  mocks.nav = vi.fn()
  mocks.S = { unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {}, routines: [], active: null }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = name => [...host.querySelectorAll('button')].find(b => b.textContent === name)

describe('Plan with a workout in progress', () => {
  it('offers to resume it', () => {
    mocks.S.active = { id: 'a', name: 'Push', entries: [], cur: 0 }
    act(() => { root.render(<Plan />) })
    expect(host.textContent).toContain('Workout in progress')
    expect(host.textContent).toContain('Push')
    act(() => { button('Resume workout').click() })
    expect(mocks.nav).toHaveBeenCalledWith('/workout')
  })

  it('goes back to an edit of a saved workout the same way', () => {
    mocks.S.active = { id: 'a', name: 'Push', entries: [], cur: 0, editingWorkoutId: 'w1' }
    act(() => { root.render(<Plan />) })
    expect(host.textContent).toContain('Editing a saved workout')
    act(() => { button('Edit workout').click() })
    expect(mocks.nav).toHaveBeenCalledWith('/workout')
  })

  it('shows nothing of the kind without one', () => {
    act(() => { root.render(<Plan />) })
    expect(button('Resume workout')).toBeUndefined()
    expect(host.textContent).not.toContain('Workout in progress')
  })
})
