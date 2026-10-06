// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

import AchievementsScreen from './AchievementsScreen'
import { useProgress } from './useProgress'
import { progressOf } from './test-progress'

const realRefresh = useProgress.getState().refresh
const card = (code: string) => screen.getByTestId('achievement-' + code)

beforeEach(() => { localStorage.clear(); useProgress.getState().reset(); h.nav.mockClear() })
afterEach(() => { cleanup(); useProgress.setState({ refresh: realRefresh }) })

describe('AchievementsScreen', () => {
  it('lists every badge, unlocked or on its way', () => {
    useProgress.setState({
      status: 'ready',
      progress: progressOf(900, {}, {
        achievements: [{ code: 'first_workout', unlocked_at: '2026-10-01T12:00:00Z' }, { code: 'week_target_1', unlocked_at: '2026-10-03T12:00:00Z' }],
        stats: { workouts: 7, prs: 0, week_targets: 1, best_streak: 0, weigh_in_run: 2, early_workouts: 0, level: 5 }
      })
    })
    render(<AchievementsScreen />)
    expect(screen.getByText('2 of 32 unlocked')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(32)
    expect(within(card('protein_7')).getByText('Protein week')).toBeTruthy()
    expect(card('first_workout').getAttribute('data-unlocked')).toBe('true')
    expect(within(card('first_workout')).getByText(/^Unlocked on /)).toBeTruthy()
    expect(card('workouts_10').getAttribute('data-unlocked')).toBe('false')
    expect(within(card('workouts_10')).getByText('7 of 10')).toBeTruthy()
    expect(within(card('first_friend')).getByText('Locked')).toBeTruthy()
    expect(within(card('level_10')).getByText('Badge only')).toBeTruthy()
    expect(within(card('streak_52')).getByText('+1,500 XP')).toBeTruthy()
  })

  it('goes back', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(0) })
    render(<AchievementsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith(-1)
  })

  it('shows placeholders while loading and a retry after a failure', () => {
    useProgress.setState({ status: 'loading' })
    const { container, unmount } = render(<AchievementsScreen />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    unmount()
    const refresh = vi.fn(async () => null)
    useProgress.setState({ status: 'error', refresh })
    render(<AchievementsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows how far along the social badges are once the server counts them', () => {
    useProgress.setState({ status: 'ready', progress: progressOf(0, {}, { stats: { friends: 0, challenges_won: 3 } }) })
    render(<AchievementsScreen />)
    expect(within(card('first_friend')).getByText('0 of 1')).toBeTruthy()
    expect(within(card('challenge_won_5')).getByText('3 of 5')).toBeTruthy()
  })
})
