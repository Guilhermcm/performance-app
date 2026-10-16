// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./HabitSheet', () => ({
  default: ({ open, habit, onOpenChange }: { open: boolean; habit?: { id: string }; onOpenChange: (o: boolean) => void }) =>
    open ? (
      <div role="dialog" aria-label="Habit sheet" data-habit={habit?.id ?? 'new'}>
        <button onClick={() => onOpenChange(false)}>Close sheet</button>
      </div>
    ) : null
}))

import HabitsSetup from './HabitsSetup'
import { useHabits } from './useHabits'
import { useProfile } from '../profile/useProfile'
import { habitOf } from './test-habits'
import type { Habit } from './types'
import type { Profile } from '../profile/types'

const realProfile = useProfile.getState()
const realHabits = useHabits.getState()
const save = vi.fn(), refresh = vi.fn(), onOpenChange = vi.fn()

const withProfile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo', habits_enabled: false, ...over } as unknown as Profile, save })
const withHabits = (habits: Habit[], status: 'idle' | 'loading' | 'ready' | 'error' = 'ready') =>
  useHabits.setState({ habits, status, refresh })
const show = () => render(<HabitsSetup open onOpenChange={onOpenChange} />)

beforeEach(() => {
  ;[save, refresh, onOpenChange, h.toast].forEach(f => f.mockReset())
  save.mockImplementation(async (patch: object) => {
    const profile = { ...useProfile.getState().profile, ...patch } as Profile
    useProfile.setState({ profile })
    return profile
  })
  refresh.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); useProfile.setState(realProfile); useHabits.setState(realHabits) })

describe('HabitsSetup', () => {
  it('turns the pillar on and, with no active habit, opens the sheet to create the first one', async () => {
    withProfile()
    withHabits([habitOf({ archived_at: '2026-10-01T00:00:00Z' })])
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    expect(save).toHaveBeenCalledWith({ habits_enabled: true })
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog').getAttribute('data-habit')).toBe('new')
    expect(onOpenChange).not.toHaveBeenCalled()
    // Closing the sheet closes the setup.
    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('only turns it on when there are active habits', async () => {
    withProfile()
    withHabits([habitOf()])
    show()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(save).toHaveBeenCalledWith({ habits_enabled: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.toast).toHaveBeenCalledWith('The Habits pillar is on.')
  })

  it('pulls the habits again once the pillar is on, so the periods know today began one', async () => {
    withProfile()
    withHabits([habitOf()])
    refresh.mockImplementation(async () => {
      // The pull runs after the profile was saved.
      expect(useProfile.getState().profile?.habits_enabled).toBe(true)
    })
    show()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not write the profile again when the pillar is already on', async () => {
    withProfile({ habits_enabled: true })
    withHabits([])
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    expect(save).not.toHaveBeenCalled()
  })

  it('asks the server for the habits when the store has not loaded them', async () => {
    for (const status of ['idle', 'loading', 'error'] as const) {
      withProfile()
      withHabits([], status)
      refresh.mockImplementation(async () => { useHabits.setState({ habits: [habitOf()], status: 'ready' }) })
      show()
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).toBeNull()
      cleanup(); refresh.mockReset(); onOpenChange.mockReset(); save.mockClear()
    }
  })

  it('still opens the creation when the pull fails: the server has the last word', async () => {
    withProfile()
    withHabits([], 'error')
    refresh.mockResolvedValue(undefined)
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    expect(save).toHaveBeenCalledWith({ habits_enabled: true })
  })

  it('says so and closes when turning it on fails', async () => {
    withProfile()
    withHabits([])
    save.mockRejectedValueOnce(new Error('offline'))
    show()
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save. Your previous values were kept.'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does nothing while closed', async () => {
    withProfile()
    withHabits([])
    render(<HabitsSetup open={false} onOpenChange={onOpenChange} />)
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
