// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import ProgramsScreen from './ProgramsScreen'
import { programMinutes } from './program-copy'

const nav = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

const setProfile = (p: Record<string, unknown> | null) => useProfile.setState({ profile: p as never })

beforeEach(() => {
  nav.mockClear()
  setProfile({ id: 'u1', goal: 'hypertrophy', level: 'intermediate', days_per_week: 4 })
})
afterEach(async () => { cleanup(); setProfile(null); await setLang('en') })

const cards = () => screen.getAllByRole('button').filter(b => b.dataset.program)
const cardOf = (id: string) => within(screen.getByRole('region', { name: 'All programs' })).getAllByRole('button').find(b => b.dataset.program === id)

describe('ProgramsScreen', () => {
  it('shows the suggested program with its reason on top', () => {
    render(<ProgramsScreen />)
    const top = screen.getByRole('region', { name: 'Suggested for you' })
    expect(within(top).getByText('For hypertrophy, 4 days')).toBeTruthy()
    expect(within(top).getByRole('button', { name: /Upper \/ Lower/ })).toBeTruthy()
  })

  it('follows the profile: PPL on 6 days for an intermediate', () => {
    setProfile({ id: 'u1', goal: 'hypertrophy', level: 'advanced', days_per_week: 6 })
    render(<ProgramsScreen />)
    const top = screen.getByRole('region', { name: 'Suggested for you' })
    expect(within(top).getByRole('button', { name: /Push \/ Pull \/ Legs/ })).toBeTruthy()
    expect(within(top).getByText('For hypertrophy, 6 days')).toBeTruthy()
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    render(<ProgramsScreen />)
    expect(screen.getByText('Sugerido para você')).toBeTruthy()
    expect(screen.getByText('Para hipertrofia, 4 dias')).toBeTruthy()
  })

  it('lists all 7 programs, each card with name, goal, level, days and time', () => {
    render(<ProgramsScreen />)
    const all = within(screen.getByRole('region', { name: 'All programs' })).getAllByRole('button').filter(b => b.dataset.program)
    expect(all).toHaveLength(7)
    const ppl = cardOf('ppl') as HTMLElement
    expect(ppl.textContent).toContain('Push / Pull / Legs')
    expect(ppl.textContent).toContain('Hypertrophy')
    expect(ppl.textContent).toContain('Intermediate')
    expect(ppl.textContent).toContain('3 or 6 days a week')
    expect(ppl.textContent).toContain(`About ${programMinutes('ppl')} min`)
    const fb = cardOf('full-body-beginner') as HTMLElement
    expect(fb.textContent).toContain('Health')
    expect(fb.textContent).toContain('Beginner')
  })

  it('explains the minutes on the cards with the time ⓘ, outside the cards (final review m3)', () => {
    render(<ProgramsScreen />)
    const all = screen.getByRole('region', { name: 'All programs' })
    const info = within(all).getByRole('button', { name: 'How the time is estimated' })
    expect(info.closest('[data-program]')).toBeNull()
    fireEvent.click(info)
    expect(screen.getByRole('dialog').textContent).toContain('40 s')
  })

  it('filters by goal and by days', () => {
    render(<ProgramsScreen />)
    const list = screen.getByRole('region', { name: 'All programs' })
    fireEvent.click(within(list).getByRole('radio', { name: 'Strength' }))
    expect(within(list).getAllByRole('button').filter(b => b.dataset.program).map(b => b.dataset.program)).toEqual(['strength-5x5', 'power-hypertrophy'])
    fireEvent.click(within(list).getByRole('radio', { name: '4 days a week' }))
    expect(within(list).getAllByRole('button').filter(b => b.dataset.program).map(b => b.dataset.program)).toEqual(['power-hypertrophy'])
    fireEvent.click(within(list).getByRole('radio', { name: 'Health' }))
    expect(within(list).queryAllByRole('button').filter(b => b.dataset.program)).toHaveLength(0)
    expect(within(list).getByText('No program matches these filters.')).toBeTruthy()
    fireEvent.click(within(list).getByRole('radio', { name: '6 days a week' }))
    fireEvent.click(within(list).getAllByRole('radio', { name: 'All' })[0])
    expect(within(list).getAllByRole('button').filter(b => b.dataset.program).map(b => b.dataset.program)).toEqual(['ppl'])
  })

  it('opens a program', () => {
    render(<ProgramsScreen />)
    fireEvent.click(cardOf('short-2x') as HTMLElement)
    expect(nav).toHaveBeenCalledWith('/plan/programas/short-2x')
    expect(cards().length).toBeGreaterThan(7)
  })

  it('without a goal, invites to set one in Profile', () => {
    setProfile({ id: 'u1', goal: null, level: null, days_per_week: 3 })
    render(<ProgramsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Set your goal in Profile' }))
    expect(nav).toHaveBeenCalledWith('/perfil')
    expect(screen.getByText('For hypertrophy, 3 days')).toBeTruthy()
  })

  it('goes back in history when there is some', () => {
    window.history.replaceState({ idx: 2 }, '')
    render(<ProgramsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(nav).toHaveBeenCalledWith(-1)
  })

  it('falls back to the Plan when the screen is the first entry', () => {
    window.history.replaceState({ idx: 0 }, '')
    render(<ProgramsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(nav).toHaveBeenCalledWith('/plan')
  })

  it('announces an empty filter result', () => {
    render(<ProgramsScreen />)
    fireEvent.click(screen.getByRole('radio', { name: '2 days a week' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Strength' }))
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('No program matches these filters.')
  })
})
