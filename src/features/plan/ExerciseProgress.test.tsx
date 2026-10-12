// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DEF, useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { setLang } from '../../lib/i18n.js'
import { ExerciseProgress, hasProgress, openExerciseProgress } from './ExerciseProgress'

const BENCH = '0025'
const cfg = { id: BENCH, sets: 2, reps: 8, mode: 'reps' }
const session = (d: string, sets: { w: number; r: number; done: boolean }[]) =>
  ({ id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), end: new Date(d + 'T11:00:00').getTime(), routineIds: ['r1'], name: 'Push', prs: [],
    entries: [{ id: BENCH, rid: 'r1', target: cfg, sets }] })
const WORKOUTS = [
  session('2026-09-28', [{ w: 57.5, r: 8, done: true }, { w: 57.5, r: 8, done: true }]),
  session('2026-10-01', [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: true }]),
  session('2026-10-05', [{ w: 62.5, r: 6, done: true }, { w: 60, r: 8, done: true }]),
]
const setS = (patch: Record<string, unknown>) =>
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', ...patch }, user: null })

beforeEach(() => { setS({ workouts: WORKOUTS }); useUI.setState({ sheets: [] }) })
afterEach(async () => { cleanup(); await setLang('en') })

describe('hasProgress', () => {
  it('is true only for an exercise with a load logged', () => {
    const S = useStore.getState().S
    expect(hasProgress(S, BENCH)).toBe(true)
    expect(hasProgress(S, '0027')).toBe(false)
    expect(hasProgress({ workouts: [] }, BENCH)).toBe(false)
    // logged with no weight: nothing to chart as load
    expect(hasProgress({ workouts: [session('2026-10-05', [{ w: 0, r: 8, done: true }])] }, BENCH)).toBe(false)
  })
})

describe('ExerciseProgress', () => {
  it('renders nothing without sessions', () => {
    setS({ workouts: [] })
    const { container } = render(<ExerciseProgress exId={BENCH} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the heaviest load and the estimated 1RM per session, the record and the last sessions', () => {
    render(<ExerciseProgress exId={BENCH} />)
    expect(screen.getByRole('heading', { name: /bench press/i })).toBeTruthy()
    const heaviest = screen.getByRole('region', { name: 'Heaviest load' })
    expect(heaviest.querySelectorAll('svg polyline').length).toBeGreaterThan(0)
    const e1rm = screen.getByRole('region', { name: 'Estimated 1RM' })
    expect(e1rm.querySelectorAll('svg polyline').length).toBeGreaterThan(0)
    expect(screen.getByText('Best: 62.5 kg')).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Sessions' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    // newest first, with the sets of that day
    expect(items[0].textContent).toContain('62.5')
    expect(items[2].textContent).toContain('57.5')
  })

  it('reads in pt-BR', async () => {
    await setLang('pt-BR')
    render(<ExerciseProgress exId={BENCH} />)
    expect(screen.getByRole('region', { name: 'Maior carga' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '1RM estimado' })).toBeTruthy()
    expect(screen.getByText('Recorde: 62,5 kg')).toBeTruthy()
  })
})

describe('openExerciseProgress', () => {
  it('opens a sheet with the progress of the exercise', () => {
    openExerciseProgress(BENCH)
    const sheets = useUI.getState().sheets as { render: (close: () => void) => React.ReactNode }[]
    expect(sheets).toHaveLength(1)
    render(<>{sheets[0].render(() => {})}</>)
    expect(screen.getByText('Best: 62.5 kg')).toBeTruthy()
  })
})
