// @vitest-environment happy-dom
// The suggestion card (spec §8.2, plan Decisions 9 to 11): one suggestion at a time; "Apply" runs
// its action inside update, "Not now" puts its key away and the next rule shows; after the race,
// the race time (h:mm:ss or m:ss) records the result, shows the new paces and offers the next goal;
// a tight week says the goal becomes finishing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./run-adjust', async importOriginal => {
  const real = await importOriginal<typeof import('./run-adjust')>()
  return {
    ...real,
    repeatPreviousWeek: vi.fn(real.repeatPreviousWeek),
    updateVdot: vi.fn(real.updateVdot),
    recordRaceResult: vi.fn(real.recordRaceResult),
    dismissSuggestion: vi.fn(real.dismissSuggestion),
  }
})
vi.mock('./RunQuestionnaire', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Questionnaire" /> : null),
}))

import { useStore } from '../../store/useStore.js'
import { setLang } from '../../lib/i18n.js'
import { fmtDate } from '../../lib/format.js'
import { recordRaceResult, repeatPreviousWeek, updateVdot } from './run-adjust'
import RunSuggestionCard from './RunSuggestionCard'
import { formatPaceRange, vdotFrom, zonePaces } from './vdot'
import type { RunLog, RunLogStatus } from './run-log'
import type { Phase, RunPlan, Session } from './types'

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))

// Wednesday 14 October 2026, Monday weeks. The plan starts on Monday 5 October: this is week 2.
const TODAY = '2026-10-14'
const easy = (min: number) => ({ zone: 'easy' as const, min })
const sessionsOf = (i: number): Session[] => [
  { id: `w${i}-s1`, type: 'long', day: 0, blocks: [easy(45)] },
  { id: `w${i}-s2`, type: 'tempo', day: 3, blocks: [easy(10), { zone: 'moderate', min: 20 }, easy(5)] },
  { id: `w${i}-s3`, type: 'easy', day: 5, blocks: [easy(30)] },
]
const plan = (phases: Phase[], over: Partial<RunPlan> = {}): RunPlan => ({
  version: 1, goal: '10k', goalType: 'time', targetTime: 50, startDate: '2026-10-05', weekStart: 1,
  answers: { goal: '10k', goalType: 'time', targetMinutes: 50, weeks: phases.length, reference: { kind: 'none' }, days: 3, longDay: 0 },
  vdot: 38.3, vdotSource: 'race', vdotDate: '2026-09-20', dismissed: {},
  weeks: phases.map((phase, i) => ({ index: i + 1, phase, recovery: false, sessions: sessionsOf(i + 1) })),
  ...over,
})
// Week 1 had one of its three workouts done (the long run on Sunday 11th).
const ONE_DONE: RunLog[] = [{ id: 'l1', day: '2026-10-11', duration_min: 45, run: { status: 'unplanned' } }]
// A hard 5 km in 22 minutes on Tuesday 6th, a day without a workout.
const FAST: RunLog = { id: 'f1', day: '2026-10-06', duration_min: 22, run: { status: 'unplanned', distance_km: 5, rpe: 9 } }

function Host({ logs, status = 'ready' }: { logs: RunLog[]; status?: RunLogStatus }) {
  const p = useStore((s: AnyState) => s.S.runPlan) as RunPlan | null
  return <RunSuggestionCard plan={p} logs={logs} status={status} />
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T15:00:00'))
  h.toast.mockClear()
  vi.mocked(repeatPreviousWeek).mockClear(); vi.mocked(updateVdot).mockClear(); vi.mocked(recordRaceResult).mockClear()
  setS({ week: {}, routines: [], weekStart: 1, runPlan: plan(['base', 'base', 'build', 'taper']) })
})
afterEach(async () => { cleanup(); vi.useRealTimers(); await setLang('en') })

const card = () => screen.queryByRole('region')

describe('RunSuggestionCard', () => {
  it('weak week: "Apply" repeats the week inside update', () => {
    render(<Host logs={ONE_DONE} />)
    expect(screen.getByRole('region', { name: 'Repeat the week' })).toBeTruthy()
    expect(screen.getByText('Last week you did 1 of 3 workouts.')).toBeTruthy()
    expect(screen.getByText('This week gets last week’s workouts again, on the days you have left.')).toBeTruthy()
    expect(screen.queryByText(/goal becomes finishing/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(repeatPreviousWeek).toHaveBeenCalledTimes(1)
    // The draft of update, not the state itself.
    expect(vi.mocked(repeatPreviousWeek).mock.calls[0][1]).toBe(TODAY)
    expect(S().runPlan.weeks).toHaveLength(5)
    expect(h.toast).toHaveBeenCalledWith('Week updated.')
    // The suggestion it answered is put away, so the card goes.
    expect(card()).toBeNull()
  })

  it('"Not now" puts the key away with the date, and the next rule shows', () => {
    render(<Host logs={[...ONE_DONE, FAST]} />)
    expect(screen.getByRole('region', { name: 'Repeat the week' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(S().runPlan.dismissed).toEqual({ 'weak:2': TODAY })
    expect(repeatPreviousWeek).not.toHaveBeenCalled()
    // One at a time: the faster run comes next.
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Update your paces' })).toBeTruthy()
    const vdot = vdotFrom(5000, 22)
    expect(screen.getByText('Your run on ' + fmtDate('2026-10-06') + ' shows you are faster than the plan’s paces.')).toBeTruthy()
    expect(screen.getByText('New easy pace: ' + formatPaceRange(zonePaces(vdot).easy))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(updateVdot).toHaveBeenCalledWith(expect.anything(), vdot, 'run', '2026-10-06')
    expect(S().runPlan.vdot).toBe(vdot)
    expect(S().runPlan.vdotSource).toBe('run')
    expect(h.toast).toHaveBeenCalledWith('Paces updated.')
    expect(card()).toBeNull()
  })

  it('a tight week says the deadline got tight and the goal becomes finishing', () => {
    setS({ runPlan: plan(['base', 'build', 'build', 'taper'], { raceDate: '2026-11-01' }) })
    render(<Host logs={[]} />)
    expect(screen.getByRole('region', { name: 'Repeat the week' })).toBeTruthy()
    expect(screen.getByText('The time to the race got tight, so the goal becomes finishing it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(S().runPlan.goalType).toBe('finish')
    expect(S().runPlan.targetTime).toBeUndefined()
  })

  it('a tight week with the goal already finishing says nothing about changing it (R3 M3)', () => {
    setS({ runPlan: plan(['base', 'build', 'build', 'taper'], { raceDate: '2026-11-01', goalType: 'finish', targetTime: undefined }) })
    render(<Host logs={[]} />)
    expect(screen.getByRole('region', { name: 'Repeat the week' })).toBeTruthy()
    expect(screen.queryByText(/goal becomes finishing/)).toBeNull()
  })

  it('high effort: "Step back a week"', () => {
    vi.setSystemTime(new Date('2026-10-21T15:00:00'))
    const hard = (id: string, day: string, week: number, k: number, type: 'easy' | 'long'): RunLog =>
      ({ id, day, duration_min: 40, run: { planned: { week, session: `w${week}-s${k}`, type, blocks: [easy(30)] }, status: 'as_planned', rpe: 8 } })
    // Weeks 1 and 2 done in full, the easy and long runs at rpe 8.
    const logs = [
      hard('a', '2026-10-09', 1, 3, 'easy'), hard('b', '2026-10-11', 1, 1, 'long'),
      { id: 'c', day: '2026-10-07', duration_min: 35, run: null },
      hard('d', '2026-10-16', 2, 3, 'easy'), hard('e', '2026-10-18', 2, 1, 'long'),
      { id: 'f', day: '2026-10-14', duration_min: 35, run: null },
    ]
    render(<Host logs={logs} />)
    expect(screen.getByRole('region', { name: 'Step back a week' })).toBeTruthy()
    expect(screen.getByText('Over the last two weeks your easy and long runs felt hard.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(vi.mocked(repeatPreviousWeek).mock.calls[0][1]).toBe('2026-10-21')
  })

  describe('race passed', () => {
    // A 10 km on Sunday 11 October, the plan's last week behind it.
    const race = () => setS({ runPlan: plan(['base', 'build', 'build', 'taper'], { startDate: '2026-09-14', raceDate: '2026-10-11' }) })
    const type = (text: string) => {
      fireEvent.change(screen.getByLabelText('Race time'), { target: { value: text } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    }

    it('refuses a time that is not one, and says how to type it', () => {
      race()
      render(<Host logs={[]} />)
      expect(screen.getByRole('region', { name: 'How did the race go?' })).toBeTruthy()
      type('abc')
      expect(screen.getByRole('alert').textContent).toBe('Enter the time as h:mm:ss or m:ss.')
      expect(screen.getByLabelText('Race time').getAttribute('aria-invalid')).toBe('true')
      expect(recordRaceResult).not.toHaveBeenCalled()
      expect(S().runPlan.raceResult).toBeUndefined()
    })

    it('takes 52:30, shows the new paces and "Choose your next goal", which opens the questionnaire', () => {
      race()
      render(<Host logs={[]} />)
      type('52:30')
      expect(recordRaceResult).toHaveBeenCalledWith(expect.anything(), 52.5)
      expect(S().runPlan.raceResult).toEqual({ minutes: 52.5 })
      const vdot = vdotFrom(10000, 52.5)
      expect(S().runPlan.vdot).toBe(vdot)
      expect(screen.getByRole('region', { name: 'Your new paces' })).toBeTruthy()
      expect(screen.getByText(formatPaceRange(zonePaces(vdot).easy))).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Choose your next goal' }))
      expect(screen.getByRole('dialog', { name: 'Questionnaire' })).toBeTruthy()
    })

    it('takes 1:52:30 too', () => {
      race()
      setS({ runPlan: { ...S().runPlan, goal: 'half' } })
      render(<Host logs={[]} />)
      type('1:52:30')
      expect(recordRaceResult).toHaveBeenCalledWith(expect.anything(), 112.5)
      expect(S().runPlan.raceResult).toEqual({ minutes: 112.5 })
    })

    it('refuses "1:52" on a half (read as m:ss), says why and keeps the card open (R3 I1)', () => {
      race()
      setS({ runPlan: { ...S().runPlan, goal: 'half' } })
      render(<Host logs={[]} />)
      type('1:52')
      expect(screen.getByRole('alert').textContent).toBe('That time doesn’t fit this race. Type hours as h:mm:ss, like 1:52:30.')
      expect(screen.getByLabelText('Race time').getAttribute('aria-invalid')).toBe('true')
      expect(S().runPlan.raceResult).toBeUndefined()
      expect(S().runPlan.vdot).toBe(38.3)
      expect(screen.getByRole('region', { name: 'How did the race go?' })).toBeTruthy()
      // As h:mm:ss it goes in.
      type('1:52:00')
      expect(S().runPlan.raceResult).toEqual({ minutes: 112 })
      expect(S().runPlan.vdot).toBe(vdotFrom(21097.5, 112))
      expect(screen.getByRole('region', { name: 'Your new paces' })).toBeTruthy()
    })

    it('keeps "55:00" on a 5 km with the paces as they were, and says so (final review I3)', () => {
      setS({ runPlan: plan(['base', 'build', 'build', 'taper'], { goal: '5k', startDate: '2026-09-14', raceDate: '2026-10-11' }) })
      expect(vdotFrom(5000, 55)).toBeLessThan(15)
      render(<Host logs={[]} />)
      type('55:00')
      expect(recordRaceResult).toHaveBeenCalledWith(expect.anything(), 55)
      expect(S().runPlan.raceResult).toEqual({ minutes: 55 })
      expect(S().runPlan).toMatchObject({ vdot: 38.3, vdotSource: 'race', vdotDate: '2026-09-20' })
      const done = screen.getByRole('region', { name: 'Race time saved' })
      expect(done.textContent).toContain('Your paces stay as they were.')
      expect(screen.queryByRole('region', { name: 'Your new paces' })).toBeNull()
      expect(screen.queryByText(formatPaceRange(zonePaces(38.3).easy))).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Choose your next goal' }))
      expect(screen.getByRole('dialog', { name: 'Questionnaire' })).toBeTruthy()
    })

    it('on a plan by feel, a slow race keeps it by feel (final review I3)', async () => {
      const byFeel = plan(['base', 'build', 'build', 'taper'], { goal: '5k', startDate: '2026-09-14', raceDate: '2026-10-11', vdotSource: null })
      delete byFeel.vdot
      delete byFeel.vdotDate
      setS({ runPlan: byFeel })
      render(<Host logs={[]} />)
      type('55:00')
      expect(S().runPlan.raceResult).toEqual({ minutes: 55 })
      expect(S().runPlan.vdot).toBeUndefined()
      expect(screen.getByRole('region', { name: 'Race time saved' }).textContent).toContain('Paces kept: the plan goes by feel.')
      cleanup()
      await setLang('pt-BR')
      setS({ runPlan: byFeel })
      render(<Host logs={[]} />)
      fireEvent.change(screen.getByLabelText('Tempo da prova'), { target: { value: '55:00' } })
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByRole('region', { name: 'Tempo da prova salvo' }).textContent).toContain('Ritmos mantidos: o plano segue pela sensação.')
    })

    it('the field shows an example and opens a text keyboard with ":" (R3 M5)', () => {
      race()
      render(<Host logs={[]} />)
      const field = screen.getByLabelText('Race time')
      expect(field.getAttribute('inputmode')).toBe('text')
      expect(field.getAttribute('placeholder')).toBe('1:52:30')
      const hint = screen.getByText('For example, 52:30 or 1:52:30.')
      expect(field.getAttribute('aria-describedby')).toContain(hint.id)
    })

    it('"Not now" puts the race away', () => {
      race()
      render(<Host logs={[]} />)
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
      expect(S().runPlan.dismissed).toEqual({ 'race:2026-10-11': TODAY })
      expect(card()).toBeNull()
    })
  })

  it('waits for the run history: no weak week, effort or faster card until it is read (final review I1, I2)', () => {
    // Without an account (idle), while it loads, or after a failed read, last week looks empty.
    for (const status of ['idle', 'loading', 'offline'] as const) {
      const { unmount } = render(<Host logs={[FAST]} status={status} />)
      expect(card()).toBeNull()
      unmount()
    }
    render(<Host logs={ONE_DONE} status="ready" />)
    expect(screen.getByRole('region', { name: 'Repeat the week' })).toBeTruthy()
  })

  it('asks for the race time even before the history is read', () => {
    setS({ runPlan: plan(['base', 'build', 'build', 'taper'], { startDate: '2026-09-14', raceDate: '2026-10-11' }) })
    render(<Host logs={[]} status="idle" />)
    expect(screen.getByRole('region', { name: 'How did the race go?' })).toBeTruthy()
  })

  it('shows nothing for a new plan, a maintain plan or no plan (review focus 5)', () => {
    setS({ runPlan: plan(['base', 'base'], { startDate: '2026-10-12' }) })
    const { rerender } = render(<Host logs={[]} />)
    expect(card()).toBeNull()
    setS({ runPlan: plan(['maintain', 'maintain'], { goal: 'maintain' }) })
    rerender(<Host logs={[]} />)
    expect(card()).toBeNull()
    setS({ runPlan: null })
    rerender(<Host logs={[]} />)
    expect(card()).toBeNull()
  })

  it('in pt-BR: "Aplicar", "Agora não" and "Escolher a próxima meta"', async () => {
    await setLang('pt-BR')
    render(<Host logs={ONE_DONE} />)
    expect(screen.getByRole('region', { name: 'Repetir a semana' })).toBeTruthy()
    expect(screen.getByText('Na semana passada você fez 1 de 3 treinos.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeTruthy()
    cleanup()
    setS({ runPlan: plan(['base', 'build', 'build', 'taper'], { startDate: '2026-09-14', raceDate: '2026-10-11' }) })
    render(<Host logs={[]} />)
    fireEvent.change(screen.getByLabelText('Tempo da prova'), { target: { value: '52:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('button', { name: 'Escolher a próxima meta' })).toBeTruthy()
  })
})
