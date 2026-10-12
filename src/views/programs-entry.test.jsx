// @vitest-environment happy-dom
// Phase 1d: the program catalog replaces the old ready-made plan chooser. Home (no routines yet) and Plan both
// lead to /plan/programas; Plan keeps the entry once there are routines too.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'
import Plan from './Plan.jsx'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
  dayAssignSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  useStore.setState(s => ({ S: { ...s.S, routines: [], week: {}, active: null, program: undefined }, user: null }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

describe.each([['Home', Home], ['Plan', Plan]])('%s empty state', (_name, View) => {
  it('leads to the programs', () => {
    act(() => root.render(<View />))
    const see = button('See programs')
    expect(see).toBeTruthy()
    act(() => { see.click() })
    expect(nav).toHaveBeenCalledWith('/plan/programas')
  })

  it('drops the empty-state offer once the user has routines', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'r', name: 'Mine', emoji: 'star', ex: [] }] } }))
    act(() => root.render(<View />))
    expect(button('See programs')).toBeFalsy()
  })
})

describe('Plan', () => {
  it('keeps a Programs entry with routines in the list', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'r', name: 'Mine', emoji: 'star', ex: [] }] } }))
    act(() => root.render(<Plan />))
    const entry = host.querySelector('[data-testid="programs-entry"]')
    expect(entry.textContent).toContain('Programs')
    act(() => { entry.click() })
    expect(nav).toHaveBeenCalledWith('/plan/programas')
  })

  it('shows the program banner once a program is applied', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'p', name: 'PPL · Push', emoji: 'barbell', ex: [] }], program: { id: 'ppl', variant: 0, appliedAt: 1, routineIds: ['p'], prevWeek: {}, dismissed: false } } }))
    act(() => root.render(<Plan />))
    expect(host.querySelector('[aria-label="Your program"]')?.textContent).toContain('Push / Pull / Legs')
  })
})
