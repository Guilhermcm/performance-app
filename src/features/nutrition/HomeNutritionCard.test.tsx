// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), toast: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import HomeNutritionCard from './HomeNutritionCard'
import { useNutrition } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'
import { ME, logOf, targetOf } from './test-nutrition'

// 2026-10-06 (a Tuesday) 15:00 UTC is noon in Sao Paulo.
const TODAY = '2026-10-06'
const DISMISSED = 'perf_nutrition_invite_dismissed_v1'
const realNutrition = useNutrition.getState()
const realProfile = useProfile.getState()

const profile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: {
    id: 'u1', timezone: 'America/Sao_Paulo', unit: 'kg', nutrition_enabled: true, birth_date: '1996-10-06', sex: 'male',
    height_cm: 178, weight_kg: 80, goal: 'hypertrophy', activity_level: 'moderate', nutrition_pace: 'standard', nutrition_days_per_week: 5, ...over
  } as never })
const eat = (...kcal: [number, number][]) => useNutrition.setState({
  logs: { [TODAY]: kcal.map(([k, p], i) => logOf({ id: 'l' + i, day: TODAY, meal: i ? 'lunch' : 'breakfast', kcal: k, protein_g: p })) }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  localStorage.clear()
  h.nav.mockReset()
  profile()
  useNutrition.setState({ ...realNutrition, userId: ME, status: 'ready', targets: [targetOf()], logs: {} })
  useProgress.setState({ status: 'ready', progress: progressOf(700, {}, { nutrition: {
    target: 5, on_target: 1, logged: 2, streak: { current: 0, best: 0, shields: 0 }, confirms_on: '2026-10-08', last_closed: null, last_week: null
  } }) })
})
afterEach(() => {
  cleanup(); vi.useRealTimers()
  useNutrition.setState(realNutrition); useProfile.setState(realProfile); useProgress.getState().reset()
})

describe('HomeNutritionCard', () => {
  it('shows a compact ring with the kcal left and a way to log', () => {
    eat([600, 40], [700, 50])
    render(<HomeNutritionCard />)
    expect(screen.getByRole('heading', { name: 'Nutrition today' })).toBeTruthy()
    expect(screen.getByTestId('home-kcal-ring')).toBeTruthy()
    expect(screen.getByText('1,100 kcal left')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Log' }))
    expect(h.nav).toHaveBeenCalledWith('/nutricao')
  })

  it('says how far over the target the day is', () => {
    eat([1500, 80], [1100, 90])
    render(<HomeNutritionCard />)
    expect(screen.getByText('200 kcal over')).toBeTruthy()
  })

  it('previews a day on target so far and when it is confirmed', () => {
    eat([1200, 80], [1150, 85])
    render(<HomeNutritionCard />)
    expect(screen.getByText('On target so far, confirms on Thursday')).toBeTruthy()
  })

  it('has no preview before the day is on target', () => {
    eat([600, 40])
    render(<HomeNutritionCard />)
    expect(screen.queryByText(/On target so far/)).toBeNull()
  })

  it('invites to turn the pillar on, opens the setup and can be dismissed for good', () => {
    profile({ nutrition_enabled: false })
    const { unmount } = render(<HomeNutritionCard />)
    expect(screen.getByText('Track what you eat')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Nutrition' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Track what you eat')).toBeNull()
    expect(localStorage.getItem(DISMISSED)).toBe('1')
    unmount()
    render(<HomeNutritionCard />)
    expect(screen.queryByText('Track what you eat')).toBeNull()
  })
})
