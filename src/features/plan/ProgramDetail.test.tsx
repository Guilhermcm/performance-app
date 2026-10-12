// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { REFS } from './references'
import { PROGRAMS, applyProgram, undoProgram } from './programs'
import ProgramDetail from './ProgramDetail'

const h = vi.hoisted(() => ({ nav: vi.fn(), id: 'ppl' as string, toast: vi.fn() }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => h.nav,
  useParams: () => ({ id: h.id }),
  Navigate: ({ to }: { to: string }) => <p>redirect {to}</p>,
}))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
vi.mock('./programs', async importOriginal => {
  const real = await importOriginal<typeof import('./programs')>()
  return { ...real, applyProgram: vi.fn(real.applyProgram), undoProgram: vi.fn(real.undoProgram) }
})

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))

beforeEach(() => {
  h.nav.mockClear(); h.toast.mockClear(); vi.mocked(applyProgram).mockClear(); vi.mocked(undoProgram).mockClear()
  h.id = 'ppl'
  setS({ routines: [{ id: 'mine', name: 'Mine', emoji: 'star', ex: [] }], week: { 2: ['mine'] }, workouts: [], program: undefined, equipFilterOn: false, active: null })
  useProfile.setState({ profile: { id: 'u1', goal: 'hypertrophy', level: 'intermediate', days_per_week: 3 } as never })
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
})
afterEach(async () => { cleanup(); useProfile.setState({ profile: null }); localStorage.clear(); await setLang('en') })

const useButton = () => screen.getByRole('button', { name: 'Use this program' })
const openPreview = () => { fireEvent.click(useButton()); return screen.getByRole('dialog') }

describe('ProgramDetail', () => {
  it('shows the three texts and an ⓘ with the program sources on "why"', () => {
    h.id = 'strength-5x5'
    render(<ProgramDetail />)
    expect(screen.getByRole('heading', { level: 1, name: 'Strength 5×5' })).toBeTruthy()
    for (const title of ['Who it is for', 'What to expect', 'Why it is built this way']) expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    const why = screen.getByRole('region', { name: 'Why it is built this way' })
    fireEvent.click(within(why).getByRole('button', { name: 'See source' }))
    const pop = screen.getByRole('dialog')
    for (const ref of PROGRAMS['strength-5x5'].refs) expect(pop.textContent).toContain(REFS[ref].title)
  })

  it('explains the minutes of the program and of each routine with the time ⓘ (final review m3)', () => {
    h.id = 'ppl'
    render(<ProgramDetail />)
    const buttons = screen.getAllByRole('button', { name: 'How the time is estimated' })
    // one beside the program minutes on top, one on the routines heading
    expect(buttons).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: 'Routines' })).getByRole('button', { name: 'How the time is estimated' })).toBeTruthy()
    fireEvent.click(buttons[0])
    expect(screen.getByRole('dialog').textContent).toContain('40 s')
  })

  it('lists the routines with their exercises as sets × range', () => {
    h.id = 'full-body-beginner'
    render(<ProgramDetail />)
    const routines = screen.getByRole('region', { name: 'Routines' })
    expect(within(routines).getByRole('heading', { name: 'Full Body · A' })).toBeTruthy()
    expect(routines.textContent).toContain('3 × 8 to 12')
    h.id = 'strength-5x5'
    cleanup()
    render(<ProgramDetail />)
    expect(screen.getByRole('region', { name: 'Routines' }).textContent).toContain('5 × 5')
  })

  it('PPL has a 3 or 6 day choice, and the 3 day one says each muscle gets one day', () => {
    render(<ProgramDetail />)
    const three = screen.getByRole('radio', { name: '3 days a week' })
    expect(three.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/each muscle once a week/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '6 days a week' }))
    expect(screen.queryByText(/each muscle once a week/)).toBeNull()
    expect(openPreview().textContent).toContain('Sat PPL · Legs')
  })

  it('opens on the suggested variant: PPL 6x for 6 days', () => {
    useProfile.setState({ profile: { id: 'u1', goal: 'hypertrophy', level: 'advanced', days_per_week: 6 } as never })
    render(<ProgramDetail />)
    expect(screen.getByRole('radio', { name: '6 days a week' }).getAttribute('aria-checked')).toBe('true')
  })

  it('has no day choice for a program with one variant', () => {
    h.id = 'upper-lower'
    render(<ProgramDetail />)
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('previews what it does (spec §4.5) and applies on confirm', () => {
    render(<ProgramDetail />)
    const dialog = openPreview()
    expect(dialog.textContent).toContain('Adds 3 routines and replaces your schedule: Mon PPL · Push, Wed PPL · Pull, Fri PPL · Legs.')
    expect(dialog.textContent).toContain('Your current routines stay in the list.')
    expect(dialog.textContent).not.toContain('You already use this program.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this program' }))
    expect(applyProgram).toHaveBeenCalledWith(expect.anything(), 'ppl', 0)
    expect(S().program).toMatchObject({ id: 'ppl', variant: 0, dismissed: false })
    expect(S().routines.map((r: AnyState) => r.name)).toEqual(['Mine', 'PPL · Push', 'PPL · Pull', 'PPL · Legs'])
    expect(h.nav).toHaveBeenCalledWith('/plan', { replace: true })
    expect(h.toast).toHaveBeenCalledWith('Program applied', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
  })

  it('cancel leaves the plan as it was', () => {
    render(<ProgramDetail />)
    fireEvent.click(within(openPreview()).getByRole('button', { name: 'Cancel' }))
    expect(applyProgram).not.toHaveBeenCalled()
    expect(S().program).toBeUndefined()
  })

  it('the toast Undo calls undoProgram and brings the week back', () => {
    render(<ProgramDetail />)
    fireEvent.click(within(openPreview()).getByRole('button', { name: 'Use this program' }))
    const action = h.toast.mock.calls[0][1].action
    action.onClick()
    expect(undoProgram).toHaveBeenCalledTimes(1)
    expect(S().program).toBeUndefined()
    expect(S().week).toEqual({ 2: ['mine'] })
    expect(S().routines.map((r: AnyState) => r.id)).toEqual(['mine'])
    expect(h.toast).toHaveBeenLastCalledWith('Program undone', undefined)
  })

  it('after Undo, says how many routines with workouts stayed', () => {
    render(<ProgramDetail />)
    fireEvent.click(within(openPreview()).getByRole('button', { name: 'Use this program' }))
    const [push, pull] = S().program.routineIds
    useStore.getState().update((s: AnyState) => { s.workouts.push({ id: 'w1', routineIds: [push, pull], d: '2026-10-12', entries: [] }) })
    h.toast.mock.calls[0][1].action.onClick()
    expect(h.toast).toHaveBeenLastCalledWith('Program undone', { description: '2 routines with workouts stayed in the list.' })
    expect(S().routines.map((r: AnyState) => r.id)).toEqual(['mine', push, pull])
  })

  it('the toast Undo does nothing once the plan was edited (dismissed)', () => {
    render(<ProgramDetail />)
    fireEvent.click(within(openPreview()).getByRole('button', { name: 'Use this program' }))
    useStore.getState().update((s: AnyState) => { s.week[2] = [] })
    h.toast.mock.calls[0][1].action.onClick()
    expect(undoProgram).not.toHaveBeenCalled()
    expect(S().program.dismissed).toBe(true)
  })

  it('warns in the preview when the program is already in use', () => {
    setS({ program: { id: 'ppl', variant: 0, appliedAt: 1, routineIds: [], prevWeek: {}, dismissed: true } })
    render(<ProgramDetail />)
    expect(openPreview().textContent).toContain('You already use this program.')
  })

  it('warns when an exercise needs equipment the person did not mark', () => {
    h.id = 'upper-lower'
    setS({ equipFilterOn: true, activeEquipId: 'home', equipProfiles: [{ id: 'home', name: 'Home', equipment: ['dumbbell'] }] })
    render(<ProgramDetail />)
    expect(screen.getByText('Uses equipment you haven’t marked')).toBeTruthy()
  })

  it('does not warn when all the equipment is there', () => {
    h.id = 'upper-lower'
    render(<ProgramDetail />)
    expect(screen.queryByText('Uses equipment you haven’t marked')).toBeNull()
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    render(<ProgramDetail />)
    expect(screen.getByRole('heading', { name: 'Por que é assim' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Usar este programa' }))
    expect(screen.getByRole('dialog').textContent).toContain('Adiciona 3 rotinas e troca sua agenda: Seg PPL · Push, Qua PPL · Pull, Sex PPL · Legs. Suas rotinas atuais continuam na lista.')
  })

  it('an unknown id goes back to the list', () => {
    h.id = 'nope'
    render(<ProgramDetail />)
    expect(screen.getByText('redirect /plan/programas')).toBeTruthy()
  })
})
