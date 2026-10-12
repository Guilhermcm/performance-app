// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setLang } from '../../lib/i18n.js'
import { nextPrescription } from '../../lib/progression.js'
import { LoadUpBadge, loadUp } from './LoadUpBadge'

const BENCH = '0025'
type Set = { w: number; r: number; done: boolean }
const cfg = { id: BENCH, sets: 3, reps: 8, weight: 60, mode: 'reps' }
const routine = { id: 'r1', name: 'Push', ex: [cfg] }
const session = (sets: Set[], d = '2026-10-05') =>
  ({ id: 'w' + d, d, start: 1, end: 2, routineIds: ['r1'], name: 'Push', prs: [], entries: [{ id: BENCH, rid: 'r1', target: cfg, sets }] })
const all = (w: number, r: number, n = 3) => Array.from({ length: n }, () => ({ w, r, done: true }))
const state = (workouts: unknown[], over: Record<string, unknown> = {}) => ({ unit: 'kg', routines: [routine], workouts, ...over })

afterEach(async () => { cleanup(); await setLang('en') })

describe('loadUp', () => {
  it('is the weight nextPrescription raises to when every rep was done', () => {
    const S = state([session(all(60, 8))])
    expect(nextPrescription(S, cfg, routine).kind).toBe('up')
    expect(loadUp(S, cfg, routine)).toEqual({ weight: 62.5 })
  })

  it('is null when the prescription does not go up', () => {
    // missed reps: hold
    expect(loadUp(state([session([{ w: 60, r: 8, done: true }, { w: 60, r: 6, done: true }, { w: 60, r: 5, done: true }])]), cfg, routine)).toBeNull()
    // nothing logged yet: first
    expect(loadUp(state([]), cfg, routine)).toBeNull()
    // progression off
    expect(loadUp(state([session(all(60, 8))]), cfg, { ...routine, prog: 'off' })).toBeNull()
  })

  it('is null for bodyweight work, whose raise is reps and not load', () => {
    const pushUp = { id: '0662', sets: 3, reps: 10, mode: 'reps' }
    const bw = { id: 'w', d: '2026-10-05', start: 1, end: 2, routineIds: ['r1'], name: 'Push', prs: [], entries: [{ id: '0662', rid: 'r1', target: pushUp, sets: all(0, 10) }] }
    const S = state([bw], { routines: [{ ...routine, ex: [pushUp] }] })
    expect(nextPrescription(S, pushUp, { ...routine, ex: [pushUp] }).kind).toBe('up')
    expect(loadUp(S, pushUp, { ...routine, ex: [pushUp] })).toBeNull()
  })
})

describe('loadUp on an assistance machine and on a deload', () => {
  it('is null on an assistance machine, where up means less help (a lighter number)', () => {
    const assisted = { id: '1432', sets: 3, reps: 8, weight: 30, mode: 'reps' }
    const r = { ...routine, ex: [assisted] }
    const w = { id: 'w', d: '2026-10-05', start: 1, end: 2, routineIds: ['r1'], name: 'Push', prs: [], entries: [{ id: '1432', rid: 'r1', target: assisted, sets: all(30, 8) }] }
    const S = state([w], { routines: [r] })
    const p = nextPrescription(S, assisted, r)
    expect(p.kind).toBe('up')
    expect(p.weight).toBeLessThan(30)
    expect(loadUp(S, assisted, r)).toBeNull()
  })

  it('is null on a deload', () => {
    const missed = [{ w: 60, r: 8, done: true }, { w: 60, r: 6, done: true }, { w: 60, r: 5, done: true }]
    const S = state([session(missed, '2026-10-01'), session(missed, '2026-10-03'), session(missed, '2026-10-05')])
    expect(nextPrescription(S, cfg, routine).kind).toBe('deload')
    expect(loadUp(S, cfg, routine)).toBeNull()
  })
})

describe('LoadUpBadge', () => {
  it('shows the next workout load with the source of the advice', () => {
    render(<LoadUpBadge S={state([session(all(60, 8))])} cfg={cfg} routine={routine} />)
    expect(screen.getByText('Next workout: 62.5 kg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Why raise the load' }))
    expect(screen.getByText(/Progressive overload without progressing load/)).toBeTruthy()
    expect(screen.getByText('Adding repetitions or adding load both worked for progressing.')).toBeTruthy()
  })

  it('reads "Próximo treino: 62,5 kg" in pt-BR', async () => {
    await setLang('pt-BR')
    render(<LoadUpBadge S={state([session(all(60, 8))])} cfg={cfg} routine={routine} />)
    expect(screen.getByText('Próximo treino: 62,5 kg')).toBeTruthy()
  })

  it('shows nothing when the load does not go up', () => {
    const { container } = render(<LoadUpBadge S={state([])} cfg={cfg} routine={routine} />)
    expect(container.innerHTML).toBe('')
  })
})
