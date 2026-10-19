// @vitest-environment happy-dom
// The tracking part of /plan/corrida (spec §8.1, review focus 5): this week's workouts done against
// planned, its minutes and km, the weekly minutes chart and the milestones; without runs, zeros and
// the empty texts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 340, height: 184 })
}))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import { useStore } from '../../store/useStore.js'
import { setLang } from '../../lib/i18n.js'
import RunTracking from './RunTracking'
import type { RunLog } from './run-log'
import type { RunDetail } from './run-detail'
import type { RunPlan, Session, SessionType } from './types'

type AnyState = Record<string, any>
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))

// Wednesday 14 October 2026, Monday weeks: week 1 runs from the 12th to the 18th.
const easy = (min: number) => ({ zone: 'easy' as const, min })
const sessionsOf = (i: number): Session[] => [
  { id: `w${i}-s1`, type: 'long', day: 0, blocks: [easy(45)] },
  { id: `w${i}-s2`, type: 'tempo', day: 3, blocks: [easy(10), { zone: 'moderate', min: 20 }, easy(5)] },
  { id: `w${i}-s3`, type: 'easy', day: 5, blocks: [easy(30)] },
]
const plan = (over: Partial<RunPlan> = {}): RunPlan => ({
  version: 1, goal: '10k', goalType: 'finish', startDate: '2026-10-12', weekStart: 1,
  answers: { goal: '10k', reference: { kind: 'none' }, days: 3, longDay: 0 },
  vdotSource: null, dismissed: {},
  weeks: [1, 2, 3].map(i => ({ index: i, phase: 'base' as const, recovery: false, sessions: sessionsOf(i) })),
  ...over,
})
const linked = (session: string, type: SessionType, extra: Partial<RunDetail>): RunDetail =>
  ({ planned: { week: 1, session, type, blocks: [easy(30)] }, status: 'as_planned', ...extra })
// The long run done early on Monday and the easy run on Wednesday, both linked: 2 of 3.
const LOGS: RunLog[] = [
  { id: 'a', day: '2026-10-12', duration_min: 50, run: linked('w1-s1', 'long', { distance_km: 9.5 }) },
  { id: 'b', day: '2026-10-14', duration_min: 30, run: linked('w1-s3', 'easy', { distance_km: 5 }) },
]

// The chart loads on demand: load its chunk once up front so the lazy import settles at once.
beforeAll(async () => { await import('./RunProgress') }, 20000)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T15:00:00'))
  setS({ weekStart: 1 })
})
afterEach(async () => { cleanup(); vi.useRealTimers(); await setLang('en') })

describe('RunTracking', () => {
  it('shows this week done against planned, its minutes and km, the chart and the milestones', async () => {
    render(<RunTracking plan={plan()} logs={LOGS} />)
    const box = screen.getByRole('region', { name: 'Tracking' })
    expect(within(box).getByText('2 of 3 workouts')).toBeTruthy()
    expect(within(box).getByText('80 min · 14.5 km')).toBeTruthy()
    expect(await within(box).findByText('This week you ran 80 of 110 planned minutes')).toBeTruthy()
    const marks = within(box).getAllByRole('term').map(dt => dt.textContent)
    expect(marks).toEqual(['Longest long run', 'Longest distance', 'Average pace on easy runsLast 4 weeks'])
    expect(within(box).getAllByRole('definition').map(dd => dd.textContent)).toEqual(['50 min', '9.5 km', '6:00 /km'])
  })

  it('without runs keeps the zeros and says so in text, with no milestone (review focus 5)', async () => {
    render(<RunTracking plan={plan()} logs={[]} />)
    expect(screen.getByText('0 of 3 workouts')).toBeTruthy()
    expect(screen.getByText('0 min · 0 km')).toBeTruthy()
    expect(screen.getByText('No milestones yet. Log your runs with distance and time to see them here.')).toBeTruthy()
    expect(screen.queryAllByRole('term')).toHaveLength(0)
    expect(await screen.findByText(/You haven’t logged a run in this plan yet/)).toBeTruthy()
  })

  it('before the plan starts shows no week and an empty chart with its text', async () => {
    render(<RunTracking plan={plan({ startDate: '2026-11-02' })} logs={[]} />)
    expect(screen.queryByText(/of 3 workouts/)).toBeNull()
    expect(await screen.findByText(/You haven’t logged a run in this plan yet/)).toBeTruthy()
  })

  it('the chart text leaves this week, still going on, out of the sums (R3 M2)', async () => {
    // From Monday 5 October: week 1 is over, this is week 2. A 40 min run in week 1.
    const logs: RunLog[] = [...LOGS, { id: 'w1', day: '2026-10-07', duration_min: 40, run: null }]
    render(<RunTracking plan={plan({ startDate: '2026-10-05' })} logs={logs} />)
    expect(await screen.findByText('Last week you ran 40 of 110 planned minutes')).toBeTruthy()
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    render(<RunTracking plan={plan()} logs={LOGS} />)
    expect(screen.getByText('2 de 3 treinos')).toBeTruthy()
    expect(screen.getByText('80 min · 14,5 km')).toBeTruthy()
    expect(screen.getByText('Longão mais longo')).toBeTruthy()
    expect(screen.getByText('Maior distância')).toBeTruthy()
    expect(screen.getByText('Ritmo médio nos treinos leves')).toBeTruthy()
    await screen.findByText('Nesta semana você correu 80 de 110 minutos planejados')
  })

  it('a single planned workout reads in the singular', () => {
    const one = plan({ weeks: [{ index: 1, phase: 'base', recovery: false, sessions: sessionsOf(1).slice(0, 1) }] })
    render(<RunTracking plan={one} logs={[]} />)
    expect(screen.getByText('0 of 1 workout')).toBeTruthy()
  })
})
