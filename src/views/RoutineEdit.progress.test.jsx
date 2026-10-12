// @vitest-environment happy-dom
// Phase 1d (spec §6): the routine list opens an exercise's progress, and says when the next
// workout goes up in load. Tapping the row itself still edits the exercise.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exConfigSheet } from '../sheets.jsx'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ glyphPicker: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

const BENCH = '0025', ROW = '0027'
const bench = { id: BENCH, sets: 3, reps: 8, weight: 60, mode: 'reps' }
const row = { id: ROW, sets: 3, reps: 10, weight: 40, mode: 'reps' }
const session = sets => ({ id: 'w1', d: '2026-10-05', start: 1, end: 2, routineIds: ['r1'], name: 'Push', prs: [],
  entries: [{ id: BENCH, rid: 'r1', target: bench, sets }] })
const all = (w, r) => [1, 2, 3].map(() => ({ w, r, done: true }))

let root
let container

function renderRoutine(workouts) {
  const S = clone(DEF)
  S.unit = 'kg'
  S.routines = [{ id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [bench, row] }]
  S.workouts = workouts
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(
    <MemoryRouter initialEntries={['/routine/r1']}>
      <Routes><Route path="/routine/:id" element={<RoutineEdit />} /></Routes>
    </MemoryRouter>
  ))
}

const rows = () => [...container.querySelectorAll('[data-routine-row]')]
const progressButton = r => r.querySelector('button[aria-label="Progress"]')

beforeEach(() => { localStorage.clear(); useUI.setState({ sheets: [] }); vi.mocked(exConfigSheet).mockClear() })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = null
  container = null
})

describe('routine list progress and load up hint', () => {
  it('opens the progress of an exercise with a load logged, and not of one never trained', () => {
    renderRoutine([session(all(60, 8))])
    const [benchRow, rowRow] = rows()
    expect(progressButton(rowRow)).toBeNull()
    act(() => progressButton(benchRow).click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(exConfigSheet).not.toHaveBeenCalled()
  })

  it('shows no shortcut and no hint without sessions', () => {
    renderRoutine([])
    for (const r of rows()) expect(progressButton(r)).toBeNull()
    expect(container.textContent).not.toContain('Next workout')
  })

  it('shows "Next workout" on the exercise whose load goes up, and drops it when it does not', () => {
    renderRoutine([session(all(60, 8))])
    const [benchRow, rowRow] = rows()
    expect(benchRow.textContent).toContain('Next workout: 62.5 kg')
    expect(rowRow.textContent).not.toContain('Next workout')
    act(() => useStore.getState().update(s => { s.workouts = [session([{ w: 60, r: 8, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }])] }))
    expect(rows()[0].textContent).not.toContain('Next workout')
  })

  it('keeps tapping the row for editing, and the source button off it', () => {
    renderRoutine([session(all(60, 8))])
    const benchRow = rows()[0]
    act(() => benchRow.querySelector('button[aria-label="Why raise the load"]').click())
    expect(exConfigSheet).not.toHaveBeenCalled()
    act(() => benchRow.querySelector('.tt').click())
    expect(exConfigSheet).toHaveBeenCalledTimes(1)
  })
})
