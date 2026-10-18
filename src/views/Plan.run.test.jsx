// @vitest-environment happy-dom
// The running plan on /plan (phase 1e-a, spec §6.4): "Build a running plan" without one; with
// one, each day of this week shows its strength routines as before and the run card under them,
// on the right day whether the week starts on Sunday or Monday (review focus 1). After a new plan,
// the app offers to update the weekly days goal and saves it only on a tap (spec §6.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(), confirmSheet: vi.fn(), startFlow: vi.fn(), exitWorkoutEdit: vi.fn(),
}))
vi.mock('@/components/ui/drawer', () => import('../features/social/test-drawer'))
// The questionnaire has its own tests; here it stands in as a dialog that applies fixed answers.
vi.mock('../features/run/RunQuestionnaire', async () => {
  const { useStore } = await import('../store/useStore.js')
  const { applyRunPlan } = await import('../features/run/run-actions')
  return {
    default: ({ open, onOpenChange, onCreated }) => {
      if (!open) return null
      const create = () => {
        useStore.getState().update(S => {
          applyRunPlan(S, { goal: 'maintain', reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: 0 }, '2026-10-14')
        })
        onOpenChange(false)
        onCreated?.()
      }
      return <div role="dialog" aria-label="Questionnaire"><button onClick={create}>Stub create</button></div>
    },
  }
})

import Plan from './Plan.jsx'
import { useStore } from '../store/useStore.js'
import { useProfile } from '../features/profile/useProfile'
import { fmtDate } from '../lib/format.js'

const setS = patch => useStore.setState(s => ({ S: { ...s.S, ...patch }, user: null }))
const UPPER = { id: 'upper', name: 'Upper', emoji: null, ex: [{ id: 'x-bench', sets: 6, bp: 'chest' }] }
const easy = min => ({ zone: 'easy', min })
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Week 1 has a tempo run on Wednesday; week 2 a long run on Sunday and intervals on Wednesday.
// The plan starts on Sunday 11 October, so with either week start today (Sunday the 18th) is in
// week 2, and a row given the wrong date would show week 1's tempo run.
function plan(over = {}) {
  return {
    version: 1, goal: 'maintain', goalType: 'finish', startDate: '2026-10-11',
    answers: { goal: 'maintain', reference: { kind: 'continuous', minutes: 30 }, days: 2, longDay: 0 },
    vdotSource: null,
    weeks: [
      { index: 1, phase: 'base', recovery: false, sessions: [{ id: 'w1-s1', type: 'tempo', day: 3, blocks: [easy(10), { zone: 'moderate', min: 15 }, easy(5)] }] },
      { index: 2, phase: 'base', recovery: false, sessions: [
        { id: 'w2-s1', type: 'long', day: 0, blocks: [easy(45)] },
        { id: 'w2-s2', type: 'intervals', day: 3, blocks: [easy(10), { repeat: 4, blocks: [{ zone: 'hard', min: 4 }] }, easy(10)] },
      ] },
    ],
    dismissed: {},
    ...over,
  }
}

const save = vi.fn(async () => ({}))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-18T15:00:00'))
  h.nav.mockClear(); save.mockClear()
  setS({ unit: 'kg', workouts: [], routines: [UPPER], week: { 3: ['upper'] }, weekStart: 1, active: null, runPlan: plan() })
  useProfile.setState({ profile: { id: 'u1', days_per_week: 3 }, save })
})
afterEach(() => { cleanup(); vi.useRealTimers(); useProfile.setState({ profile: null }) })

const schedule = () => screen.getByRole('heading', { name: 'Week schedule' }).nextElementSibling
const rows = () => [...schedule().children]
const rowOf = name => rows().find(r => r.textContent.startsWith(name))

describe('Plan: running plan entry', () => {
  it('without a plan shows "Build a running plan", which opens the questionnaire', () => {
    setS({ runPlan: undefined })
    render(<Plan />)
    fireEvent.click(screen.getByRole('button', { name: /Build a running plan/ }))
    expect(screen.getByRole('dialog', { name: 'Questionnaire' })).toBeTruthy()
  })

  it('with a plan opens /plan/corrida from the entry', () => {
    render(<Plan />)
    const entry = screen.getByRole('button', { name: /Running plan/ })
    expect(entry.textContent).toContain('Week 2 of 2')
    fireEvent.click(entry)
    expect(h.nav).toHaveBeenCalledWith('/plan/corrida')
  })
})

describe('Plan: run cards in the week schedule', () => {
  for (const ws of [1, 0]) {
    it(`puts each run on its day with the week starting on ${ws ? 'Monday' : 'Sunday'}`, () => {
      setS({ weekStart: ws })
      render(<Plan />)
      expect(rows().map(r => DAY_NAMES.find(n => r.textContent.startsWith(n)))).toEqual(
        ws ? [...DAY_NAMES.slice(1), 'Sunday'] : DAY_NAMES)
      const wed = rowOf('Wednesday')
      // The strength routine stays as it is, and the run card comes under it.
      expect(within(wed).getByText('Upper')).toBeTruthy()
      expect(within(wed).getByRole('heading', { name: 'Interval run' })).toBeTruthy()
      expect(within(wed).getByText('10 easy + 4 × 4 hard + 10 easy')).toBeTruthy()
      expect(within(wed).getByText('Interval run on a strength day')).toBeTruthy()
      expect(within(wed).queryByText('Tempo run')).toBeNull()
      expect(within(rowOf('Sunday')).getByRole('heading', { name: 'Long run' })).toBeTruthy()
      // A day without a run is unchanged.
      expect(within(rowOf('Tuesday')).getByText('Rest')).toBeTruthy()
      expect(schedule().textContent.match(/Long run/g)).toHaveLength(1)
    })
  }

  it('during the maintain weeks before a race plan, the entry says when the race plan starts (R2 I6-1)', () => {
    const p = plan()
    setS({ runPlan: { ...p, goal: '10k', weeks: p.weeks.map(w => ({ ...w, phase: 'maintain' })).concat([{ index: 3, phase: 'base', recovery: false, sessions: [] }]) } })
    render(<Plan />)
    const entry = screen.getByRole('button', { name: /Running plan/ })
    expect(entry.textContent).toContain('Stay in shape · Race plan starts on ' + fmtDate('2026-10-19'))
  })

  it('says when the plan starts and shows no runs before it', () => {
    setS({ runPlan: plan({ startDate: '2026-12-07' }) })
    render(<Plan />)
    expect(screen.getByRole('button', { name: /Running plan/ }).textContent).toContain('Starts on ' + fmtDate('2026-12-07'))
    expect(schedule().textContent).not.toMatch(/Long run|Interval run|Tempo run/)
  })

  it('shows no run cards for a plan of an unknown version and points to the questionnaire', () => {
    setS({ runPlan: { ...plan(), version: 2 } })
    render(<Plan />)
    expect(screen.getByRole('button', { name: /Running plan/ }).textContent).toContain('This plan can’t be read in this version of the app.')
    expect(schedule().textContent).not.toMatch(/Long run|Interval run/)
  })
})

describe('Plan: weekly goal after a new plan', () => {
  it('offers to update the goal when the week has another number of training days, and saves only on a tap', () => {
    vi.setSystemTime(new Date('2026-10-14T15:00:00'))
    setS({ runPlan: undefined, week: { 1: ['upper'] } })
    render(<Plan />)
    fireEvent.click(screen.getByRole('button', { name: /Build a running plan/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Stub create' }))
    expect(screen.getByText('Training days in your week, strength and running together: 4. Your weekly goal: 3.')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText(/Training days in your week/)).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('does not offer when the count already matches the goal', () => {
    vi.setSystemTime(new Date('2026-10-14T15:00:00'))
    useProfile.setState({ profile: { id: 'u1', days_per_week: 4 }, save })
    setS({ runPlan: undefined, week: { 1: ['upper'] } })
    render(<Plan />)
    fireEvent.click(screen.getByRole('button', { name: /Build a running plan/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Stub create' }))
    expect(screen.queryByText(/Training days in your week/)).toBeNull()
  })
})
