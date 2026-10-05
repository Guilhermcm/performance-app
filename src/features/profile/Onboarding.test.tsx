// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({
  create: vi.fn(async (input: any) => ({ id: 'u1', equipment: [], unit: 'kg', locale: 'pt-BR', weight_kg: null, ...input })),
  update: vi.fn((fn: (s: any) => void) => fn({})),
  loadStarterPlan: vi.fn(),
  emit: vi.fn(),
  finishOnboarding: vi.fn(),
  suggestion: null as string | null
}))
vi.mock('./useProfile', () => ({
  useProfile: (sel?: any) => {
    const s = { create: h.create, suggestion: h.suggestion, setSuggestion: (id: string) => { h.suggestion = id }, finishOnboarding: h.finishOnboarding }
    return sel ? sel(s) : s
  }
}))
vi.mock('../../store/useStore.js', () => ({
  useStore: Object.assign((sel: any) => sel({ user: { id: 'u1', name: 'Ana Souza' }, update: h.update, S: {} }), { getState: () => ({ update: h.update, S: {} }) })
}))
vi.mock('../../sheets.jsx', () => ({ loadStarterPlan: h.loadStarterPlan }))
vi.mock('../gamification/events', () => ({ emit: h.emit }))
vi.mock('../../lib/equipment.js', () => ({ ALL_EQUIPMENT: ['barbell', 'dumbbell', 'body weight'] }))

import Onboarding from './Onboarding'

const next = () => fireEvent.click(screen.getByRole('button', { name: /continue/i }))

beforeEach(() => {
  ;[h.create, h.update, h.loadStarterPlan, h.emit, h.finishOnboarding].forEach(f => f.mockClear())
  h.suggestion = null
})
afterEach(cleanup)

describe('Onboarding', () => {
  it('pre-fills the name from the Google account', () => {
    render(<Onboarding />)
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Ana Souza')
  })

  it('blocks the first step on an invalid height', () => {
    render(<Onboarding />)
    fireEvent.change(screen.getByLabelText(/height/i), { target: { value: '20' } })
    next()
    expect(screen.getByText(/between 50 and 260/i)).toBeTruthy()
  })

  it('keeps what was typed when going back', () => {
    render(<Onboarding />)
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: '72.5' } })
    next()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect((screen.getByLabelText(/weight/i) as HTMLInputElement).value).toBe('72.5')
  })

  it('walks the three steps, saves and stores the plan suggestion', async () => {
    render(<Onboarding />)
    fireEvent.change(screen.getByLabelText(/weight/i), { target: { value: '70' } })
    next()
    fireEvent.click(screen.getByRole('radio', { name: /strength/i }))
    fireEvent.click(screen.getByRole('radio', { name: /beginner/i }))
    fireEvent.click(screen.getByRole('radio', { name: '3' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: /barbell/i }))
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    await waitFor(() => expect(h.create).toHaveBeenCalled())
    expect(h.create.mock.calls[0][0]).toMatchObject({ display_name: 'Ana Souza', weight_kg: 70, goal: 'strength', level: 'beginner', days_per_week: 3, equipment: ['barbell'] })
    expect(h.update).toHaveBeenCalled()
    expect(h.emit).toHaveBeenCalledWith('weight_logged', expect.any(Object), expect.any(String), expect.any(String))
    await waitFor(() => expect(h.suggestion).toBe('5x5'))
  })

  it('shows an error and stays on the last step when saving fails', async () => {
    h.create.mockRejectedValueOnce(new Error('offline'))
    render(<Onboarding />)
    next()
    next()
    fireEvent.click(screen.getByRole('button', { name: /finish/i }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: /finish/i })).toBeTruthy()
    expect(h.suggestion).toBe(null)
  })

  it('shows the suggestion and loads the plan', () => {
    h.suggestion = '5x5'
    render(<Onboarding />)
    expect(screen.getByText('5×5')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /use this plan/i }))
    expect(h.loadStarterPlan).toHaveBeenCalledWith('5x5')
    expect(h.finishOnboarding).toHaveBeenCalled()
  })

  it('can skip the suggestion', () => {
    h.suggestion = 'ppl'
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(h.loadStarterPlan).not.toHaveBeenCalled()
    expect(h.finishOnboarding).toHaveBeenCalled()
  })
})
