// @vitest-environment happy-dom
// /plan/corrida (spec §6.4): goal and deadline, the phases, the weeks with this one marked, the
// paces by zone with the reference date, the race prediction, and refit, redo and end (with a
// confirmation). An unknown plan version offers only to redo the questionnaire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), toast: vi.fn(), initial: undefined as unknown }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./run-actions', async importOriginal => {
  const real = await importOriginal<typeof import('./run-actions')>()
  return { ...real, refitFuture: vi.fn(real.refitFuture) }
})
// The questionnaire has its own tests; here it stands in as a dialog that applies fixed answers.
vi.mock('./RunQuestionnaire', async () => {
  const { useStore } = await import('../../store/useStore.js')
  const { applyRunPlan } = await import('./run-actions')
  type P = { open: boolean; onOpenChange: (o: boolean) => void; initial?: unknown; onCreated?: () => void }
  return {
    default: ({ open, onOpenChange, initial, onCreated }: P) => {
      if (!open) return null
      h.initial = initial
      const create = () => {
        useStore.getState().update((S: never) => {
          applyRunPlan(S, { goal: 'maintain', reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: 0 }, '2026-10-14')
        })
        onOpenChange(false)
        onCreated?.()
      }
      return <div role="dialog" aria-label="Questionnaire"><button onClick={create}>Stub create</button></div>
    },
  }
})

import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { fmtDate } from '../../lib/format.js'
import { refitFuture } from './run-actions'
import { formatClock } from './clock'
import { formatPaceRange, predictMinutes, zonePaces } from './vdot'
import RunPlanScreen from './RunPlanScreen'
import type { Phase, RunPlan, Session, Week } from './types'

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))

// Wednesday 14 October 2026; the week starts on Monday, so week 1 (from the 12th) is this week.
const UPPER = { id: 'upper', name: 'Upper', emoji: null, ex: [{ id: 'x-bench', sets: 6, bp: 'chest' }] }
const easy = (min: number) => ({ zone: 'easy' as const, min })
const sessionsOf = (i: number): Session[] => [
  { id: `w${i}-s1`, type: 'long', day: 0, blocks: [easy(45)] },
  { id: `w${i}-s2`, type: 'tempo', day: 3, blocks: [easy(10), { repeat: 2, blocks: [{ zone: 'moderate', min: 8 }, easy(2)] }, easy(5)] },
  { id: `w${i}-s3`, type: 'easy', day: 5, blocks: [easy(30)] },
]
const PHASES: Phase[] = ['base', 'base', 'build', 'build', 'specific', 'specific', 'taper', 'taper']
const weeks = (): Week[] => PHASES.map((phase, i) => ({ index: i + 1, phase, recovery: i === 3, sessions: sessionsOf(i + 1) }))

function plan(over: Partial<RunPlan> = {}): RunPlan {
  return {
    version: 1, goal: '10k', goalType: 'finish', startDate: '2026-10-12', raceDate: '2026-12-06',
    answers: { goal: '10k', goalType: 'finish', raceDate: '2026-12-06', reference: { kind: 'race', distanceM: 5000, minutes: 25, date: '2026-10-01' }, days: 3, longDay: 0 },
    vdot: 38.3, vdotSource: 'race', vdotDate: '2026-10-01',
    weeks: weeks(), dismissed: {}, ...over,
  }
}

const save = vi.fn(async () => ({}))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T15:00:00'))
  h.nav.mockClear(); h.toast.mockClear(); h.initial = undefined; save.mockClear(); vi.mocked(refitFuture).mockClear()
  setS({ week: { 1: ['upper'] }, routines: [UPPER], weekStart: 1, runPlan: plan() })
  useProfile.setState({ profile: { id: 'u1', days_per_week: 3 } as never, save } as never)
})
afterEach(() => { cleanup(); vi.useRealTimers(); useProfile.setState({ profile: null }) })

const region = (name: string) => screen.getByRole('region', { name })

describe('RunPlanScreen', () => {
  it('shows the goal and the deadline, and the phases in order with their weeks', () => {
    render(<RunPlanScreen />)
    expect(screen.getByRole('heading', { level: 1, name: 'Running plan' })).toBeTruthy()
    expect(screen.getByText('10 km')).toBeTruthy()
    expect(screen.getByText('Race on ' + fmtDate('2026-12-06'))).toBeTruthy()
    const phases = within(region('Phases')).getAllByRole('listitem').map(li => li.textContent)
    expect(phases).toEqual(['Base2 weeks', 'Build2 weeks', 'Specific2 weeks', 'Taper2 weeks'])
  })

  it('lists the weeks with this one marked, its runs and the recovery week', () => {
    render(<RunPlanScreen />)
    const items = within(region('Weeks')).getAllByRole('listitem').filter(li => li.dataset.week)
    expect(items).toHaveLength(8)
    const current = items.filter(li => li.getAttribute('aria-current') === 'true')
    expect(current.map(li => li.dataset.week)).toEqual(['1'])
    expect(within(current[0]).getByText('This week')).toBeTruthy()
    // This week opens up its runs with the blocks; the others keep a summary.
    expect(within(current[0]).getByText('10 easy + 2 × (8 moderate, 2 easy) + 5 easy')).toBeTruthy()
    expect(within(items[3]).getByText('Recovery')).toBeTruthy()
    // In the order the week is shown (Monday first): Wednesday, Friday, Sunday.
    expect(within(items[1]).getByText('Tempo run, Easy run, Long run')).toBeTruthy()
    expect(within(items[1]).getByText('110 min')).toBeTruthy()
  })

  it('shows the paces by zone with the date of the reference, and the race prediction', () => {
    render(<RunPlanScreen />)
    const paces = zonePaces(38.3)
    const box = region('Paces')
    // The zones the plan uses: easy and moderate here, no hard.
    for (const z of ['easy', 'moderate'] as const) expect(within(box).getByText(formatPaceRange(paces[z]))).toBeTruthy()
    expect(within(box).queryByText(formatPaceRange(paces.hard))).toBeNull()
    expect(within(box).getByText('From your race on ' + fmtDate('2026-10-01') + '.')).toBeTruthy()
    expect(within(region('Race prediction')).getByText(`Your pace today gives about ${formatClock(predictMinutes(38.3, 10000))} for 10 km.`)).toBeTruthy()
  })

  it('without a VDOT says the plan goes by feel and has no prediction', () => {
    setS({ runPlan: plan({ vdot: undefined, vdotSource: null, vdotDate: undefined }) })
    render(<RunPlanScreen />)
    expect(within(region('Paces')).getByText('No pace: the plan goes by feel.')).toBeTruthy()
    expect(within(region('Paces')).getByText('you can hold a conversation')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Race prediction' })).toBeNull()
  })

  it('refits the coming weeks with the strength week of now', () => {
    render(<RunPlanScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Refit next weeks' }))
    expect(refitFuture).toHaveBeenCalledWith(expect.anything(), '2026-10-14')
    expect(h.toast).toHaveBeenCalledWith('Coming weeks refitted.')
  })

  it('redoes the questionnaire with the current answers', () => {
    render(<RunPlanScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Redo questionnaire' }))
    expect(screen.getByRole('dialog', { name: 'Questionnaire' })).toBeTruthy()
    expect(h.initial).toEqual(plan().answers)
  })

  it('ends the plan only after the confirmation', () => {
    render(<RunPlanScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'End plan' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('End your running plan?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(S().runPlan).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'End plan' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End plan' }))
    expect(S().runPlan).toBeNull()
    expect(S().week).toEqual({ 1: ['upper'] })
    expect(h.nav).toHaveBeenCalledWith('/plan')
  })

  it('says when a plan that waits for its race starts', () => {
    setS({ runPlan: plan({ startDate: '2026-12-07', raceDate: '2027-01-31' }) })
    render(<RunPlanScreen />)
    expect(screen.getByText('Starts on ' + fmtDate('2026-12-07'))).toBeTruthy()
    expect(within(region('Weeks')).getAllByRole('listitem').filter(li => li.getAttribute('aria-current') === 'true')).toHaveLength(0)
  })

  it('offers only to redo the questionnaire for a plan of an unknown version', () => {
    setS({ runPlan: { ...plan(), version: 2 } })
    render(<RunPlanScreen />)
    expect(screen.getByText('This plan can’t be read in this version of the app.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Redo questionnaire' })).toBeTruthy()
    for (const name of ['Refit next weeks', 'End plan']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Paces' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Redo questionnaire' }))
    expect(h.initial).toBeUndefined()
  })

  it('without a plan offers to build one', () => {
    setS({ runPlan: undefined })
    render(<RunPlanScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Build a running plan' }))
    expect(screen.getByRole('dialog', { name: 'Questionnaire' })).toBeTruthy()
  })

  it('after a new plan, offers to update the weekly goal and saves it only on a tap', async () => {
    render(<RunPlanScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Redo questionnaire' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stub create' }))
    // Strength on Monday; the maintain plan's 3 runs land on other days: 4 different days.
    expect(screen.getByText('Training days in your week, strength and running together: 4. Your weekly goal: 3.')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Update goal to 4' }))
    expect(save).toHaveBeenCalledWith({ days_per_week: 4 })
  })

  it('sorts the runs by the week start the plan was made with (final review M2)', () => {
    // Made with Monday weeks; the person now starts weeks on Sunday. Sunday stays the last day.
    setS({ weekStart: 0, runPlan: plan({ weekStart: 1 }) })
    render(<RunPlanScreen />)
    const items = within(region('Weeks')).getAllByRole('listitem').filter(li => li.dataset.week)
    expect(within(items[1]).getByText('Tempo run, Easy run, Long run')).toBeTruthy()
    const current = items.find(li => li.getAttribute('aria-current') === 'true')!
    expect(within(current).getAllByText(/ · /).map(e => e.textContent)).toEqual(['Wednesday · Tempo run', 'Friday · Easy run', 'Sunday · Long run'])
  })

  it('marks the race after the last week, with its distance and date (final review I1)', () => {
    render(<RunPlanScreen />)
    const race = within(region('Weeks')).getAllByRole('listitem').filter(li => li.dataset.race)
    expect(race).toHaveLength(1)
    expect(within(race[0]).getByText('Race day · 10 km')).toBeTruthy()
    expect(within(race[0]).getByText(fmtDate('2026-12-06'))).toBeTruthy()
    cleanup()
    setS({ runPlan: { ...plan({ goal: 'maintain', raceDate: undefined }) } })
    render(<RunPlanScreen />)
    expect(within(region('Weeks')).getAllByRole('listitem').filter(li => li.dataset.race)).toHaveLength(0)
  })

  it('on the eve and on race day past the last week, shows the race, not "Plan finished" (final review fix 1)', () => {
    // The race on Tuesday 8 December, Monday weeks: the plan ends on Sunday the 6th.
    setS({ runPlan: plan({ raceDate: '2026-12-08' }) })
    vi.setSystemTime(new Date('2026-12-07T15:00:00'))
    render(<RunPlanScreen />)
    expect(screen.getByText('Race on ' + fmtDate('2026-12-08'))).toBeTruthy()
    expect(screen.queryByText('Plan finished')).toBeNull()
    cleanup()
    vi.setSystemTime(new Date('2026-12-08T15:00:00'))
    render(<RunPlanScreen />)
    expect(within(screen.getByRole('banner')).getByText('Race day')).toBeTruthy()
    expect(screen.queryByText('Plan finished')).toBeNull()
    cleanup()
    vi.setSystemTime(new Date('2026-12-09T15:00:00'))
    render(<RunPlanScreen />)
    expect(screen.getByText('Plan finished')).toBeTruthy()
  })

  it('with maintain weeks before the race plan, names them and says when the race plan starts (R2 I6-1)', () => {
    const bridged = plan({ weeks: weeks().map((w, i) => (i < 2 ? { ...w, phase: 'maintain' as Phase, recovery: false } : w)) })
    setS({ runPlan: bridged })
    render(<RunPlanScreen />)
    expect(screen.getByText('Race plan starts on ' + fmtDate('2026-10-26'))).toBeTruthy()
    const phases = within(region('Phases')).getAllByRole('listitem').map(li => li.textContent)
    expect(phases[0]).toBe('Stay in shape2 weeks')
  })
})

