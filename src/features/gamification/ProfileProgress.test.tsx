// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import ProfileProgress from './ProfileProgress'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

beforeEach(() => { localStorage.clear(); useProgress.getState().reset(); h.nav.mockClear() })
afterEach(cleanup)

describe('ProfileProgress', () => {
  it('stays out of the way until there is progress', () => {
    const { container } = render(<ProfileProgress />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the overall level, the strength pillar with its icon and name, and the badges', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(1110, {}, { pillars: { strength: { level: 5, into: 260, need: 300, xp: 960 } } }) })
    render(<ProfileProgress />)
    expect(screen.getByRole('heading', { name: 'Overall level' })).toBeTruthy()
    // Overall: 1110 XP is level 6 (110/350); the strength pillar is level 5.
    expect(screen.getByText('Level 6')).toBeTruthy()
    expect(screen.getByText('Level 5')).toBeTruthy()
    expect(screen.getByText('Total XP: 1,110')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Strength' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Achievements/ }))
    expect(h.nav).toHaveBeenCalledWith('/conquistas')
  })

  it('adds the nutrition pillar once it has a level', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(1110, {}, { pillars: {
      strength: { level: 5, into: 260, need: 300, xp: 960 }, nutrition: { level: 2, into: 20, need: 150, xp: 120 }
    } }) })
    render(<ProfileProgress />)
    expect(screen.getByRole('progressbar', { name: 'Nutrition' })).toBeTruthy()
    expect(screen.getByText('Level 2')).toBeTruthy()
  })
})
