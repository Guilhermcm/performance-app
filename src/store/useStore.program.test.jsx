// @vitest-environment happy-dom
// Plan decision 4 of phase 1d: editing a routine or the week after a program was applied hides the
// program banner and its Undo (S.program.dismissed). The store's update is the one place every plan
// edit goes through (Plan, the routine editor, the day sheets), so it marks it there.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore.js'
import { applyProgram, undoProgram } from '../features/plan/programs'

vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const S = () => useStore.getState().S
const update = fn => useStore.getState().update(fn)

beforeEach(() => {
  useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'mine', name: 'Mine', emoji: 'star', ex: [] }], week: { 2: ['mine'] }, workouts: [], program: undefined }, user: null }))
})
afterEach(() => localStorage.clear())

describe('store update and the applied program', () => {
  it('applying a program leaves it on show', () => {
    update(s => applyProgram(s, 'ppl', 0))
    expect(S().program).toMatchObject({ id: 'ppl', dismissed: false })
  })

  it('a routine edit afterwards dismisses it', () => {
    update(s => applyProgram(s, 'ppl', 0))
    update(s => { s.routines.find(r => r.id === S().program.routineIds[0]).name = 'Push heavy' })
    expect(S().program.dismissed).toBe(true)
  })

  it('a week edit afterwards dismisses it', () => {
    update(s => applyProgram(s, 'ppl', 0))
    update(s => { s.week[6] = ['mine'] })
    expect(S().program.dismissed).toBe(true)
  })

  it('a change outside the plan does not', () => {
    update(s => applyProgram(s, 'ppl', 0))
    update(s => { s.restSec = 60 })
    expect(S().program.dismissed).toBe(false)
  })

  it('undo clears it without tripping over the routines it removes', () => {
    update(s => applyProgram(s, 'ppl', 0))
    update(s => { undoProgram(s) })
    expect(S().program).toBeUndefined()
    expect(S().week).toEqual({ 2: ['mine'] })
  })
})
