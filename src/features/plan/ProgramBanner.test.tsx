// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../../store/useStore.js'
import { setLang } from '../../lib/i18n.js'
import { applyProgram, undoProgram } from './programs'
import { ProgramBanner } from './ProgramBanner'
import { useUndoneRoutines } from './program-actions'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
vi.mock('./programs', async importOriginal => {
  const real = await importOriginal<typeof import('./programs')>()
  return { ...real, undoProgram: vi.fn(real.undoProgram) }
})

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const update = (fn: (s: AnyState) => void) => act(() => useStore.getState().update(fn))

beforeEach(() => {
  h.toast.mockClear(); vi.mocked(undoProgram).mockClear()
  useUndoneRoutines.setState({ ids: [] })
  useStore.setState((s: AnyState) => ({ S: { ...s.S, routines: [{ id: 'mine', name: 'Mine', emoji: 'star', ex: [] }], week: { 2: ['mine'] }, workouts: [], program: undefined, active: null }, user: null }))
})
afterEach(async () => { cleanup(); localStorage.clear(); await setLang('en') })

const banner = () => screen.queryByRole('region', { name: 'Your program' })

describe('ProgramBanner', () => {
  it('is not there without an applied program', () => {
    render(<ProgramBanner />)
    expect(banner()).toBeNull()
  })

  it('shows the program name with Undo once a program is applied', () => {
    update(s => applyProgram(s as never, 'ppl', 1))
    render(<ProgramBanner />)
    expect(banner()?.textContent).toContain('Push / Pull / Legs')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('goes away when closed, and stays away (dismissed)', () => {
    update(s => applyProgram(s as never, 'ppl', 0))
    render(<ProgramBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(banner()).toBeNull()
    expect(S().program.dismissed).toBe(true)
  })

  it('goes away after a routine is edited', () => {
    update(s => applyProgram(s as never, 'ppl', 0))
    render(<ProgramBanner />)
    expect(banner()).toBeTruthy()
    update(s => { s.routines[1].ex[0].sets = 5 })
    expect(banner()).toBeNull()
  })

  it('goes away after the week is edited', () => {
    update(s => applyProgram(s as never, 'ppl', 0))
    render(<ProgramBanner />)
    update(s => { delete s.week[1] })
    expect(banner()).toBeNull()
  })

  it('Undo calls undoProgram and says which routines with workouts stayed', () => {
    update(s => applyProgram(s as never, 'ppl', 0))
    const push = S().program.routineIds[0]
    update(s => { s.workouts.push({ id: 'w1', routineIds: [push], d: '2026-10-12', entries: [] }) })
    render(<ProgramBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undoProgram).toHaveBeenCalledTimes(1)
    expect(S().program).toBeUndefined()
    expect(h.toast).toHaveBeenLastCalledWith('Program undone', { description: '1 routine with workouts stayed in the list.' })
    expect(banner()).toBeNull()
  })

  it('says so plainly when a routine removed by Undo comes back through sync', () => {
    update(s => applyProgram(s as never, 'ppl', 0))
    const ids = [...S().program.routineIds]
    const copies = S().routines.filter((r: AnyState) => ids.includes(r.id))
    render(<ProgramBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByRole('status')).toBeNull()
    // The routine union of a sync with an older copy brings one back (no tombstones).
    act(() => useStore.setState((s: AnyState) => ({ S: { ...s.S, routines: [...s.S.routines, copies[0]] } })))
    expect(screen.getByRole('status').textContent).toContain('Routines removed by Undo came back from another device.')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    update(s => applyProgram(s as never, 'upper-lower', 0))
    render(<ProgramBanner />)
    expect(screen.getByRole('region', { name: 'Seu programa' }).textContent).toContain('Superior / Inferior')
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy()
  })
})
