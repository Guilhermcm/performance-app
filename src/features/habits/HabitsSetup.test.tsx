// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./HabitSheet', () => ({
  default: ({ open, habit, onOpenChange, onSaved }: { open: boolean; habit?: { id: string }; onOpenChange: (o: boolean) => void; onSaved?: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Habit sheet" data-habit={habit?.id ?? 'new'}>
        <button onClick={() => onOpenChange(false)}>Close sheet</button>
        <button onClick={() => { onSaved?.(); onOpenChange(false) }}>Save sheet</button>
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
  it('with no active habit opens the sheet for the first one without turning the pillar on yet', async () => {
    withProfile()
    withHabits([habitOf({ archived_at: '2026-10-01T00:00:00Z' })])
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    expect(screen.getByRole('dialog').getAttribute('data-habit')).toBe('new')
    expect(save).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closing the sheet without saving leaves the pillar off, and the next opening offers the setup again', async () => {
    withProfile()
    withHabits([])
    const { rerender } = render(<HabitsSetup open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(<HabitsSetup open={false} onOpenChange={onOpenChange} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<HabitsSetup open onOpenChange={onOpenChange} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    expect(save).not.toHaveBeenCalled()
    expect(useProfile.getState().profile?.habits_enabled).toBe(false)
  })

  it('turns the pillar on once the first habit is saved, then pulls so the periods know today began one', async () => {
    withProfile()
    withHabits([])
    refresh.mockImplementation(async () => {
      if (useProfile.getState().profile?.habits_enabled) useHabits.setState({ habits: [habitOf()] })
    })
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    refresh.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith({ habits_enabled: true })
    expect(save).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports closed only once the pillar is on, so a caller reading the profile on close sees it', async () => {
    withProfile()
    withHabits([])
    const seen: boolean[] = []
    onOpenChange.mockImplementation(() => { seen.push(!!useProfile.getState().profile?.habits_enabled) })
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(seen).toEqual([true])
  })

  it('keeps the habit when turning the pillar on fails after the save, and says how to finish', async () => {
    withProfile()
    withHabits([])
    save.mockRejectedValueOnce(new Error('offline'))
    show()
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Habit sheet' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet' }))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('The habit was saved, but Habits is still off. Tap again to turn it on.'))
    expect(useProfile.getState().profile?.habits_enabled).toBe(false)
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
    fireEvent.click(screen.getByRole('button', { name: 'Save sheet' }))
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
  })

  it('asks the server for the habits when the store has not loaded them', async () => {
    for (const status of ['idle', 'loading', 'error'] as const) {
      withProfile()
      withHabits([], status)
      refresh.mockImplementation(async () => { useHabits.setState({ habits: [habitOf()], status: 'ready' }) })
      show()
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      // Once to learn whether a habit is active, once after turning the pillar on.
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(save).toHaveBeenCalledWith({ habits_enabled: true })
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
    expect(save).not.toHaveBeenCalled()
  })

  it('says so and closes when turning it on fails', async () => {
    withProfile()
    withHabits([habitOf()])
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
