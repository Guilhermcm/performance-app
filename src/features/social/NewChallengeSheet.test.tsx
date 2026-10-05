// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), createChallenge: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('./social-api', async orig => ({ ...(await orig<typeof import('./social-api')>()), createChallenge: h.createChallenge }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('./test-drawer'))

import NewChallengeSheet from './NewChallengeSheet'
import { useSocial } from './useSocial'
import { useProgress } from '../gamification/useProgress'
import { SocialError } from './social-api'
import { addDays } from './templates'
import { todayISO } from '../../lib/format.js'
import { BIA, CAIO, ME, friendOf } from './test-social'

const realLoad = useSocial.getState().load
const load = vi.fn(async () => null)
const onClose = vi.fn()
const ready = <T,>(data: T) => ({ status: 'ready' as const, data, stale: false, error: null })
const create = () => screen.getByRole('button', { name: 'Create challenge' }) as HTMLButtonElement

beforeEach(() => {
  localStorage.clear()
  useProgress.getState().reset()
  useSocial.getState().reset()
  useSocial.setState({ userId: ME, load, friends: ready([friendOf(BIA, 'Bia'), friendOf(CAIO, 'Caio')]) })
  ;[load, onClose, h.nav, h.createChallenge, h.toast.success, h.toast.error].forEach(f => f.mockReset())
})
afterEach(() => { cleanup(); useSocial.setState({ load: realLoad }) })

describe('NewChallengeSheet', () => {
  it('suggests a goal and a name from what is picked', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    // 3 workouts a week (no progress yet) × 4 weeks, only me so far.
    expect(screen.getByText('12 workouts')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('12 workouts in 30 days')
    expect(screen.getByText('Pick at least one friend.')).toBeTruthy()
    expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('24 workouts')).toBeTruthy()
    expect(create().disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByText('25 workouts')).toBeTruthy()
    expect((screen.getByLabelText('Challenge name') as HTMLInputElement).value).toBe('25 workouts in 30 days')
  })

  it('keeps weeks on target solo', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /Weeks on target/ }))
    expect((screen.getByRole('radio', { name: 'Team' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only solo for this goal: each person has their own weekly goal.')).toBeTruthy()
  })

  it('asks for the volume opt-in before creating a volume challenge', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('radio', { name: /Total volume/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    expect(screen.getByText('Agree to share your volume to create this challenge.')).toBeTruthy()
    expect(create().disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('Agree to share your volume to create this challenge.')).toBeNull()
    expect(create().disabled).toBe(false)
  })

  it('asks for a name when it is cleared', () => {
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.change(screen.getByLabelText('Challenge name'), { target: { value: '   ' } })
    expect(screen.getByText('Give the challenge a name.')).toBeTruthy()
    expect(create().disabled).toBe(true)
  })

  it('offers an invite when there is nobody to pick', () => {
    useSocial.setState({ friends: ready([]) })
    render(<NewChallengeSheet open onClose={onClose} />)
    expect(screen.getByText('Add a friend to create challenges.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Invite a friend' })).toBeTruthy()
    expect(create().disabled).toBe(true)
  })

  it('creates the challenge, closes and opens it', async () => {
    h.createChallenge.mockResolvedValue('c9')
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.nav).toHaveBeenCalledWith('/social/desafios/c9'))
    const today = todayISO()
    expect(h.createChallenge).toHaveBeenCalledWith({
      template: 'workouts_count', title: '24 workouts in 30 days', mode: 'team', target: 24,
      starts_on: today, ends_on: addDays(today, 29), invitees: [BIA], share_volume: false
    })
    expect(onClose).toHaveBeenCalled()
    expect(load).toHaveBeenCalledWith('challenges')
    expect(h.toast.success).toHaveBeenCalledWith('Challenge created. Your friends got the invite.')
  })

  it('says why the server refused', async () => {
    h.createChallenge.mockRejectedValue(new SocialError('challenge_limit'))
    render(<NewChallengeSheet open onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Bia/ }))
    fireEvent.click(create())
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('You already have 10 challenges in progress.'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
