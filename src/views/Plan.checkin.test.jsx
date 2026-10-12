// @vitest-environment happy-dom
// The Plan is where training is planned and started (phase 1c, spec 3.6 and 5.3): each routine has
// "Post a check-in" (with that routine) and "Train with the app" (the live workout), and "My
// workouts" in the header opens the calendar of check-ins.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null, user: null }
  state.snapshot = () => ({ S: state.S, user: state.user, update: () => {} })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
const sheets = vi.hoisted(() => ({
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(), confirmSheet: vi.fn(), startFlow: vi.fn(),
}))
vi.mock('../sheets.jsx', () => sheets)
const flow = vi.hoisted(() => ({ openCheckinCamera: vi.fn() }))
vi.mock('../features/checkin/open-checkin', () => flow)

import Plan from './Plan.jsx'
import { useCheckins } from '../features/checkin/useCheckins'
import { useProfile } from '../features/profile/useProfile'

const PUSH = { id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }
const LEGS = { id: 'r2', name: 'Legs', emoji: null, ex: [{ id: '0032' }] }
// Saturday 10/10/2026, noon in Sao Paulo; the week runs from Monday 05/10.
const NOW = new Date('2026-10-10T15:00:00Z')
const checkin = (id, day) => ({
  id, day, activity: 'strength', routine_id: null, routine_name: null, title: 'Gym', caption: null, note: null,
  duration_min: null, visibility: 'friends', photo_path: `u1/${id}.jpg`, detail: null, created_at: day + 'T15:00:00Z'
})

let host, root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  mocks.nav = vi.fn()
  mocks.user = { id: 'u1' }
  mocks.S = { unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {}, routines: [PUSH, LEGS], active: null, weekStart: 1 }
  Object.values(sheets).forEach(f => f.mockClear())
  flow.openCheckinCamera.mockClear()
  useProfile.setState({ profile: { id: 'u1', timezone: 'America/Sao_Paulo', days_per_week: 3 } })
  useCheckins.setState({ userId: 'u1', mine: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers()
  useCheckins.setState({ userId: null, mine: [] })
  useProfile.setState({ profile: null })
})

const mount = () => act(() => { root.render(<Plan />) })
const buttons = name => [...host.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === name || b.textContent === name)
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('Plan: each routine checks in or trains with the app', () => {
  it('opens the check-in with the routine, without opening the routine', () => {
    mount()
    const checks = buttons('Post a check-in: Legs')
    expect(checks).toHaveLength(1)
    click(checks[0])
    expect(flow.openCheckinCamera).toHaveBeenCalledWith({ routineId: 'r2' })
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('starts the live workout of the routine', () => {
    mount()
    click(buttons('Train with the app: Push')[0])
    expect(sheets.startFlow).toHaveBeenCalledWith(['r1'])
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('offers no second live workout while one is in progress, and no check-in without an account', () => {
    mocks.S.active = { id: 'a', name: 'Push', entries: [], cur: 0 }
    mount()
    expect(buttons('Train with the app: Push')).toHaveLength(0)
    expect(buttons('Post a check-in: Push')).toHaveLength(1)
    act(() => root.unmount())
    root = createRoot(host)
    mocks.S.active = null
    mocks.user = null
    useCheckins.setState({ userId: null })
    mount()
    expect(buttons('Post a check-in: Push')).toHaveLength(0)
    expect(buttons('Train with the app: Push')).toHaveLength(1)
  })

  it('keeps the way to a freestyle workout or another routine', () => {
    mount()
    click(buttons('Choose a different workout')[0])
    expect(mocks.nav).toHaveBeenCalledWith('/workout')
  })
})

describe('Plan: My workouts', () => {
  it("opens the calendar from the header, with the week's training days", () => {
    // Two days with a check-in this week (two posts on Friday count once), one last week.
    useCheckins.setState({ mine: [checkin('a', '2026-10-09'), checkin('b', '2026-10-09'), checkin('c', '2026-10-06'), checkin('d', '2026-10-02')] })
    mount()
    const open = host.querySelector('[data-testid="my-workouts"]')
    expect(open.textContent).toContain('My workouts')
    expect(open.textContent).toContain('2 of 3 days this week')
    click(open)
    expect(mocks.nav).toHaveBeenCalledWith('/plan/treinos')
  })

  it('is not there without an account', () => {
    mocks.user = null
    useCheckins.setState({ userId: null })
    mount()
    expect(host.querySelector('[data-testid="my-workouts"]')).toBeNull()
  })
})
