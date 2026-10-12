// @vitest-environment happy-dom
// Phase 1d (spec 5.8): the Plan carries an "Analysis" card with a one-line summary of the week.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(), confirmSheet: vi.fn(), startFlow: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const card = () => host.querySelector('[data-testid="analysis-entry"]')

describe('Plan analysis card', () => {
  it('summarises the scheduled week and opens the analysis', () => {
    useStore.setState(s => ({ S: { ...s.S, active: null, program: undefined, customEx: [],
      routines: [{ id: 'push', name: 'Push', emoji: 'star', ex: [{ id: '0025', sets: 3 }] }], week: { 1: ['push'] } } }))
    act(() => root.render(<Plan />))
    expect(card().tagName).toBe('BUTTON')
    expect(card().textContent).toContain('Analysis')
    expect(card().textContent).toMatch(/alerts · back with no sets/)
    act(() => { card().click() })
    expect(nav).toHaveBeenCalledWith('/plan/analise')
  })

  it('with routines but nothing scheduled, takes the focus to the week schedule (review M6)', () => {
    useStore.setState(s => ({ S: { ...s.S, active: null, program: undefined, customEx: [],
      routines: [{ id: 'push', name: 'Push', emoji: 'star', ex: [{ id: '0025', sets: 3 }] }], week: {} } }))
    act(() => root.render(<Plan />))
    expect(card().textContent).toContain('Put a routine on a day of the week')
    const week = host.querySelector('#plan-week')
    expect(week.textContent).toBe('Week schedule')
    week.scrollIntoView = vi.fn()
    act(() => { card().click() })
    expect(nav).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(week)
  })

  it('on an empty plan asks for a program', () => {
    useStore.setState(s => ({ S: { ...s.S, active: null, program: undefined, routines: [], week: {} } }))
    act(() => root.render(<Plan />))
    expect(card().textContent).toContain('Pick a program to start')
    act(() => { card().click() })
    expect(nav).toHaveBeenCalledWith('/plan/programas')
  })
})
