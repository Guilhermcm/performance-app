// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import { ProgressHero } from './ProgressHero'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'

const realRefresh = useProgress.getState().refresh
const ready = (p = progressOf(400, { xp: 400, workouts: 2 }, { streak: { current: 3, best: 5, shields: 1 } }), over = {}) =>
  useProgress.setState({ status: 'ready', progress: p, userId: 'u1', ...over })

beforeEach(() => { localStorage.clear(); useProgress.getState().reset(); h.nav.mockClear() })
afterEach(() => { cleanup(); useProgress.setState({ refresh: realRefresh }) })

describe('ProgressHero', () => {
  it('shows a skeleton until the first answer', () => {
    useProgress.setState({ status: 'loading' })
    const { container } = render(<ProgressHero />)
    expect(container.querySelector('[data-slot="progress-hero"][aria-busy="true"]')).toBeTruthy()
  })

  it('offers a retry when the first load failed', () => {
    const refresh = vi.fn(async () => null)
    useProgress.setState({ status: 'error', refresh })
    render(<ProgressHero />)
    expect(screen.getByText('Could not load your progress.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the level, what is left to the next one, the streak and the week', () => {
    ready()
    render(<ProgressHero />)
    expect(screen.getByRole('heading', { name: 'Level 3' })).toBeTruthy()
    expect(screen.getByText('50 XP to level 4')).toBeTruthy()
    expect(screen.getByText('400 of 960 XP')).toBeTruthy()
    expect(screen.getByText('2 of 3 workouts')).toBeTruthy()
    expect(screen.getByRole('button', { name: '3 week streak. Shields: 1 of 2' })).toBeTruthy()
  })

  it('counts the running week in the streak once its goal is met', () => {
    ready(progressOf(950, { xp: 750, workouts: 3, target_hit: true }, { streak: { current: 3, best: 5, shields: 1 } }))
    render(<ProgressHero />)
    expect(screen.getByText('Weekly goal met')).toBeTruthy()
    expect(screen.getByRole('button', { name: '4 week streak. Shields: 1 of 2' })).toBeTruthy()
  })

  it('explains shields on demand', () => {
    ready()
    render(<ProgressHero />)
    fireEvent.click(screen.getByRole('button', { name: /week streak/ }))
    expect(screen.getByText('Streak shields')).toBeTruthy()
    expect(screen.getByText('Best: 5')).toBeTruthy()
  })

  it('invites the first workout when there is no XP yet', () => {
    ready(progressOf(0, { workouts: 0 }))
    render(<ProgressHero />)
    expect(screen.getByText('Finish a workout to earn your first XP.')).toBeTruthy()
  })

  it('opens the achievements', () => {
    ready()
    render(<ProgressHero />)
    expect(screen.getByText('0 of 22 unlocked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Achievements/ }))
    expect(h.nav).toHaveBeenCalledWith('/conquistas')
  })

  it('says so when it shows the saved copy offline', () => {
    // An own property shadows the prototype getter; deleting it brings the real one back.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      ready(undefined, { stale: true })
      render(<ProgressHero />)
      expect(screen.getByText('Offline. Showing your last saved progress.')).toBeTruthy()
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine
    }
  })
})
