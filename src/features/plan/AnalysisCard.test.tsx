// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import type { Alert, PlanAnalysis } from './analysis'
import { AnalysisCard, analysisSummary } from './AnalysisCard'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

type AnyState = Record<string, any>
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))

// A push day: chest 6 sets (low), the back and the legs at 0 (missing).
const pushDay = () => setS({
  routines: [{ id: 'push', name: 'Push', emoji: 'star', ex: [{ id: '0025', sets: 3 }, { id: '1278', sets: 3 }] }],
  week: { 1: ['push'] }, customEx: [], program: undefined,
})

// Only the fields the summary reads; the rest of a PlanAnalysis does not change it.
const analysisWith = (alerts: Alert[], balance = { push: 0, pull: 0, quads: 0, hamstrings: 0 }) =>
  ({ empty: false, alerts, balance, unknown: [], minutes: [], groups: {} } as unknown as PlanAnalysis)

beforeEach(() => {
  h.nav.mockClear()
  useProfile.setState({ profile: { id: 'u1', goal: 'hypertrophy', level: 'intermediate', days_per_week: 3 } as never })
})
afterEach(async () => { cleanup(); useProfile.setState({ profile: null }); await setLang('en') })

describe('analysisSummary', () => {
  it('counts the alerts and names the first one', () => {
    const a = analysisWith([{ kind: 'low', group: 'chest' }, { kind: 'long', routineId: 'r' }])
    expect(analysisSummary(a, 'hypertrophy')).toBe('2 alerts · chest below ideal')
  })

  it('says one alert in the singular', () => {
    expect(analysisSummary(analysisWith([{ kind: 'missing', group: 'back' }]), 'hypertrophy')).toBe('1 alert · back with no sets')
  })

  it.each([
    [{ kind: 'missing', group: 'hamstrings' }, 'hamstring with no sets'],
    [{ kind: 'low', group: 'biceps' }, 'biceps below ideal'],
    [{ kind: 'high', group: 'triceps' }, 'triceps with little extra gain'],
    [{ kind: 'frequency', group: 'quads' }, 'quads with low frequency'],
    [{ kind: 'long', routineId: 'r' }, 'long workout'],
    [{ kind: 'repeated', exId: '0025' }, 'repeated exercise'],
  ] as [Alert, string][])('names %o as "%s"', (alert, text) => {
    expect(analysisSummary(analysisWith([alert]), 'hypertrophy')).toBe(`1 alert · ${text}`)
  })

  it('says which side of a balance alert is bigger', () => {
    const pushPull = (push: number, pull: number) => analysisWith([{ kind: 'balance-push-pull' }], { push, pull, quads: 0, hamstrings: 0 })
    expect(analysisSummary(pushPull(12, 4), 'hypertrophy')).toBe('1 alert · more push than pull')
    expect(analysisSummary(pushPull(4, 12), 'hypertrophy')).toBe('1 alert · more pull than push')
    const legs = (quads: number, hamstrings: number) => analysisWith([{ kind: 'balance-quad-ham' }], { push: 0, pull: 0, quads, hamstrings })
    expect(analysisSummary(legs(12, 4), 'hypertrophy')).toBe('1 alert · more quads than hamstrings')
    expect(analysisSummary(legs(4, 12), 'hypertrophy')).toBe('1 alert · more hamstrings than quads')
  })

  it('calls a plan with no alerts balanced, for the profile', () => {
    expect(analysisSummary(analysisWith([]), 'hypertrophy')).toBe('Balanced plan for hypertrophy')
    expect(analysisSummary(analysisWith([]), 'strength')).toBe('Balanced plan for strength')
    expect(analysisSummary(analysisWith([]), 'health')).toBe('Balanced plan for general health')
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    const a = analysisWith([{ kind: 'low', group: 'chest' }, { kind: 'long', routineId: 'r' }])
    expect(analysisSummary(a, 'hypertrophy')).toBe('2 alertas · peito abaixo do ideal')
    expect(analysisSummary(analysisWith([]), 'hypertrophy')).toBe('Plano equilibrado para hipertrofia')
  })
})

describe('AnalysisCard', () => {
  it('summarises the plan in order (missing before low) and opens the analysis', () => {
    pushDay()
    render(<AnalysisCard />)
    const card = screen.getByRole('button', { name: /^Analysis/ })
    expect(card.textContent).toMatch(/\d+ alerts · back with no sets/)
    fireEvent.click(card)
    expect(h.nav).toHaveBeenCalledWith('/plan/analise')
  })

  it('on an empty plan asks for a program and leads to the programs', () => {
    setS({ routines: [], week: {}, customEx: [], program: undefined })
    render(<AnalysisCard />)
    const card = screen.getByRole('button', { name: /Pick a program to start/ })
    expect(screen.queryByText(/alert/)).toBeNull()
    fireEvent.click(card)
    expect(h.nav).toHaveBeenCalledWith('/plan/programas')
  })

  it('with routines but nothing scheduled, points to the week schedule (review M6)', () => {
    pushDay()
    setS({ week: {} })
    const week = document.createElement('h4')
    week.id = 'plan-week'
    week.tabIndex = -1
    const scrolled = vi.fn()
    week.scrollIntoView = scrolled
    document.body.appendChild(week)
    render(<AnalysisCard />)
    const card = screen.getByRole('button', { name: /^Analysis/ })
    expect(card.textContent).toContain('Put a routine on a day of the week')
    fireEvent.click(card)
    expect(h.nav).not.toHaveBeenCalled()
    expect(scrolled).toHaveBeenCalled()
    expect(document.activeElement).toBe(week)
    week.remove()
  })

  it('reads the profile from the profile goal', () => {
    pushDay()
    useProfile.setState({ profile: { id: 'u1', goal: 'strength', level: 'intermediate', days_per_week: 3 } as never })
    render(<AnalysisCard />)
    // strength has no frequency alert, so the count drops but the first alert is the same
    expect(screen.getByRole('button', { name: /^Analysis/ }).textContent).toContain('back with no sets')
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    setS({ routines: [], week: {}, customEx: [], program: undefined })
    render(<AnalysisCard />)
    expect(screen.getByRole('button', { name: /Análise/ }).textContent).toContain('Escolha um programa para começar')
  })
})
