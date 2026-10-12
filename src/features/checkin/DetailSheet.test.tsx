// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import DetailSheet from './DetailSheet'
import { DEF, useStore } from '../../store/useStore.js'
import { setLang } from '../../lib/i18n.js'

const BENCH = '0025', ROW = '0027'
const PUSH = { id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 8, mode: 'reps' }, { id: ROW, sets: 1, reps: 10, mode: 'reps' }] }
const last = { id: 'w1', d: '2026-10-03', start: 1, end: 2, routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: [],
  entries: [{ id: BENCH, rid: 'r1', target: PUSH.ex[0], sets: [{ w: 42.5, r: 8, done: true }, { w: 42.5, r: 6, done: true }] }] }
const onConfirm = vi.fn()
const onOpenChange = vi.fn()

const group = (name: RegExp) => screen.getByRole('group', { name })
const field = (g: HTMLElement, label: string) => within(g).getByLabelText(label) as HTMLInputElement

beforeEach(() => {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', routines: [PUSH], workouts: [last], exWeights: {} } })
  onConfirm.mockReset(); onOpenChange.mockReset()
})
afterEach(async () => { cleanup(); await setLang('en') })

describe('DetailSheet', () => {
  it('opens the routine exercises with last time’s load and reps', () => {
    render(<DetailSheet open routineId="r1" onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    const bench = group(/bench press/i)
    expect(field(bench, 'Set 1 · Weight (kg)').value).toBe('42.5')
    expect(field(bench, 'Set 1 · Reps').value).toBe('8')
    expect(field(bench, 'Set 2 · Reps').value).toBe('6')
    const row = group(/bent over row/i)
    expect(field(row, 'Set 1 · Reps').value).toBe('10')
  })

  it('confirms what changed, without the exercises turned off', () => {
    render(<DetailSheet open routineId="r1" onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    const bench = group(/bench press/i)
    fireEvent.change(field(bench, 'Set 2 · Weight (kg)'), { target: { value: '45,5' } })
    fireEvent.change(field(bench, 'Set 2 · Reps'), { target: { value: '7' } })
    fireEvent.click(within(bench).getByRole('button', { name: 'Add set' }))
    expect(field(bench, 'Set 3 · Reps').value).toBe('7')
    fireEvent.click(within(bench).getAllByRole('button', { name: 'Remove set' })[2])
    fireEvent.click(within(group(/bent over row/i)).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onConfirm).toHaveBeenCalledWith({ entries: [{ id: BENCH, sets: [{ w: 42.5, r: 8, done: true }, { w: 45.5, r: 7, done: true }] }], unit: 'kg' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reopens a detail already given', () => {
    render(<DetailSheet open routineId="r1" initial={{ entries: [{ id: ROW, sets: [{ w: 30, r: 12, done: true }] }] }} onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    expect(within(group(/bench press/i)).getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    expect(field(group(/bent over row/i), 'Set 1 · Weight (kg)').value).toBe('30')
  })

  // Spec §6: the fields keep last time's load, and the suggested one shows beside them.
  describe('suggested load', () => {
    const allReps = { ...last, entries: [{ ...last.entries[0], sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }] }
    const withLast = (w: unknown) => useStore.setState({ S: { ...useStore.getState().S, workouts: [w] } })

    it('shows "suggested" beside the field when the load goes up', () => {
      withLast(allReps)
      render(<DetailSheet open routineId="r1" onOpenChange={onOpenChange} onConfirm={onConfirm} />)
      const bench = group(/bench press/i)
      expect(field(bench, 'Set 1 · Weight (kg)').value).toBe('60')
      const hint = within(bench).getByText('suggested 62.5 kg')
      expect(field(bench, 'Set 1 · Weight (kg)').getAttribute('aria-describedby')).toBe(hint.id)
      expect(within(group(/bent over row/i)).queryByText(/suggested/)).toBeNull()
    })

    it('reads "sugerido 62,5 kg" in pt-BR', async () => {
      await setLang('pt-BR')
      withLast(allReps)
      render(<DetailSheet open routineId="r1" onOpenChange={onOpenChange} onConfirm={onConfirm} />)
      expect(screen.getByText('sugerido 62,5 kg')).toBeTruthy()
    })

    it('shows none when the load holds', () => {
      render(<DetailSheet open routineId="r1" onOpenChange={onOpenChange} onConfirm={onConfirm} />)
      expect(screen.queryByText(/suggested/)).toBeNull()
    })

    it('shows none on a detail already given, whose session may already be in the history', () => {
      withLast(allReps)
      render(<DetailSheet open routineId="r1" initial={{ entries: [{ id: BENCH, sets: [{ w: 60, r: 8, done: true }] }] }} onOpenChange={onOpenChange} onConfirm={onConfirm} />)
      expect(screen.queryByText(/suggested/)).toBeNull()
    })
  })

  it('says so when the routine has nothing to detail', () => {
    useStore.setState({ S: { ...useStore.getState().S, routines: [{ id: 'r2', name: 'Cardio', ex: [{ id: 'treadmill', mode: 'cardio', sets: 1 }] }] } })
    render(<DetailSheet open routineId="r2" onOpenChange={onOpenChange} onConfirm={onConfirm} />)
    expect(screen.getByText('This routine has no exercises with weight and reps.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
