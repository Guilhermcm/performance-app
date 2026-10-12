// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn(), fetchTargets: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./sleep-api', async orig => ({ ...(await orig<typeof import('./sleep-api')>()), fetchTargets: h.fetchTargets }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import SleepSetup from './SleepSetup'
import { useSleep } from './useSleep'
import { useProfile } from '../profile/useProfile'
import { targetOf } from './test-sleep'
import type { Profile } from '../profile/types'

const BASE = { id: 'u1', display_name: 'Ana', timezone: 'America/Sao_Paulo', unit: 'kg', sleep_enabled: false, sleep_nights_per_week: 5 }
const realProfile = useProfile.getState()
const realSleep = useSleep.getState()
const save = vi.fn(), setTarget = vi.fn(), refresh = vi.fn(), onOpenChange = vi.fn()

const withProfile = (over: Record<string, unknown> = {}) => {
  useProfile.setState({ status: 'ready', profile: { ...BASE, ...over } as unknown as Profile, save })
}
const show = () => render(<SleepSetup open onOpenChange={onOpenChange} />)
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const click = (name: string | RegExp) => fireEvent.click(button(name))
const choose = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  ;[save, setTarget, refresh, onOpenChange, h.toast, h.fetchTargets].forEach(f => f.mockReset())
  save.mockImplementation(async (patch: object) => ({ ...useProfile.getState().profile, ...patch }))
  setTarget.mockResolvedValue(undefined)
  refresh.mockResolvedValue(undefined)
  useSleep.setState({ setTarget, refresh, targets: [], status: 'ready', stale: false })
})
afterEach(() => { cleanup(); vi.useRealTimers(); useProfile.setState(realProfile); useSleep.setState(realSleep) })

describe('SleepSetup', () => {
  it('starts at 8h, 23:00 and 5 nights', () => {
    withProfile()
    show()
    expect(screen.getByText('8h')).toBeTruthy()
    expect(screen.getByText(/^23:00/)).toBeTruthy()
    expect(screen.getByRole('radio', { name: '5' }).getAttribute('aria-checked')).toBe('true')
    for (const n of ['3', '4', '5', '6', '7']) expect(screen.getByRole('radio', { name: n })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '2' })).toBeNull()
    expect(screen.queryByRole('radio', { name: '8' })).toBeNull()
  })

  it('moves the goal 15 minutes at a time between 6h and 10h', () => {
    withProfile()
    show()
    click('Sleep 15 minutes more')
    expect(screen.getByText('8h 15')).toBeTruthy()
    click('Sleep 15 minutes less')
    click('Sleep 15 minutes less')
    expect(screen.getByText('7h 45')).toBeTruthy()
    for (let i = 0; i < 20; i++) if (!button('Sleep 15 minutes less').disabled) click('Sleep 15 minutes less')
    expect(screen.getByText('6h')).toBeTruthy()
    expect(button('Sleep 15 minutes less').disabled).toBe(true)
    for (let i = 0; i < 20; i++) if (!button('Sleep 15 minutes more').disabled) click('Sleep 15 minutes more')
    expect(screen.getByText('10h')).toBeTruthy()
    expect(button('Sleep 15 minutes more').disabled).toBe(true)
  })

  it('moves the bedtime 15 minutes at a time, across midnight', () => {
    withProfile()
    show()
    click('Bedtime 15 minutes later')
    expect(screen.getByText(/^23:15/)).toBeTruthy()
    for (let i = 0; i < 3; i++) click('Bedtime 15 minutes later')
    expect(screen.getByText(/^00:00/)).toBeTruthy()
    click('Bedtime 15 minutes earlier')
    expect(screen.getByText(/^23:45/)).toBeTruthy()
  })

  it('never waits for the targets to load: the server decides today or tomorrow', async () => {
    for (const status of ['idle', 'loading', 'error'] as const) {
      withProfile()
      useSleep.setState({ status, targets: [] })
      h.fetchTargets.mockResolvedValue([])
      show()
      expect(screen.queryByRole('button', { name: 'Loading your targets' })).toBeNull()
      expect(button('Turn on Sleep').disabled).toBe(false)
      click('Turn on Sleep')
      await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
      // The server has no goal at all: the first one starts today.
      expect(setTarget.mock.calls[0][1]).toBe('2026-10-06')
      setTarget.mockClear(); save.mockClear()
      cleanup()
    }
    withProfile()
    useSleep.setState({ status: 'error', targets: [] })
    h.fetchTargets.mockResolvedValue([targetOf({ valid_from: '2026-09-01' })])
    show()
    click('Turn on Sleep')
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    // The server already has one: this one starts tomorrow.
    expect(setTarget.mock.calls[0][1]).toBe('2026-10-07')
  })

  it('asks the server when the store only holds a saved copy', async () => {
    withProfile()
    useSleep.setState({ status: 'ready', stale: true, targets: [] })
    h.fetchTargets.mockResolvedValue([targetOf({ valid_from: '2026-09-01' })])
    show()
    click('Turn on Sleep')
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(h.fetchTargets).toHaveBeenCalledTimes(1)
    expect(setTarget.mock.calls[0][1]).toBe('2026-10-07')
  })

  it('asks nothing of the server when the store is fresh', async () => {
    withProfile()
    show()
    click('Turn on Sleep')
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(h.fetchTargets).not.toHaveBeenCalled()
  })

  it('writes nothing and says so when the targets cannot be read', async () => {
    withProfile()
    useSleep.setState({ status: 'error', targets: [] })
    h.fetchTargets.mockRejectedValue(new Error('offline'))
    show()
    click('Turn on Sleep')
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save the target. Check your connection and try again.'))
    expect(save).not.toHaveBeenCalled()
    expect(setTarget).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(button('Turn on Sleep').disabled).toBe(false)
  })

  it('tries the pull again when the store has not loaded', () => {
    withProfile()
    useSleep.setState({ status: 'error' })
    show()
    expect(refresh).toHaveBeenCalled()
  })

  it('turns the pillar on with a first goal that starts today', async () => {
    withProfile()
    show()
    click('Sleep 15 minutes less')
    click('Bedtime 15 minutes earlier')
    choose('4')
    click('Turn on Sleep')
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith({ sleep_enabled: true, sleep_nights_per_week: 4 })
    expect(setTarget).toHaveBeenCalledWith({ goal_min: 465, bed_target: '22:45' }, '2026-10-06')
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(setTarget.mock.invocationCallOrder[0])
    expect(h.toast).toHaveBeenCalledWith('Sleep is on. Your goal starts today.')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('starts the goal tomorrow when one already exists, also when turning the pillar back on', async () => {
    withProfile()
    useSleep.setState({ targets: [targetOf({ valid_from: '2026-09-01', goal_min: 450, bed_target: '23:30' })] })
    show()
    // The form starts from the goal that was saved before.
    expect(screen.getByText('7h 30')).toBeTruthy()
    click('Turn on Sleep')
    await waitFor(() => expect(save).toHaveBeenCalledWith({ sleep_enabled: true, sleep_nights_per_week: 5 }))
    // The goal in force from tomorrow is the same one: nothing to write.
    expect(setTarget).not.toHaveBeenCalled()
  })

  it('says a changed goal starts tomorrow also when turning the pillar back on', async () => {
    withProfile()
    useSleep.setState({ targets: [targetOf({ valid_from: '2026-09-01', goal_min: 450, bed_target: '23:30' })] })
    show()
    expect(screen.queryByText('Starts tomorrow')).toBeNull()
    click('Sleep 15 minutes more')
    expect(screen.getByText('Starts tomorrow')).toBeTruthy()
    click('Turn on Sleep')
    await waitFor(() => expect(setTarget).toHaveBeenCalledWith({ goal_min: 465, bed_target: '23:30' }, '2026-10-07'))
  })

  it('keeps the form and says so when the goal could not be saved', async () => {
    withProfile()
    setTarget.mockRejectedValue(new Error('offline'))
    show()
    click('Turn on Sleep')
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save the target. Check your connection and try again.'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    // Trying again still writes the first goal for today.
    setTarget.mockResolvedValue(undefined)
    click('Turn on Sleep')
    await waitFor(() => expect(setTarget).toHaveBeenLastCalledWith({ goal_min: 480, bed_target: '23:00' }, '2026-10-06'))
  })

  it('does not write when the profile could not be saved', async () => {
    withProfile()
    save.mockRejectedValue(new Error('offline'))
    show()
    click('Turn on Sleep')
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save. Your previous values were kept.'))
    expect(setTarget).not.toHaveBeenCalled()
  })

  describe('with the pillar on', () => {
    beforeEach(() => {
      withProfile({ sleep_enabled: true, sleep_nights_per_week: 5 })
      useSleep.setState({ targets: [targetOf({ valid_from: '2026-10-01', goal_min: 480, bed_target: '23:00' })] })
    })

    it('shows the goal in force and saves a change for tomorrow', async () => {
      show()
      expect(screen.getByText('8h')).toBeTruthy()
      expect(screen.queryByText('Starts tomorrow')).toBeNull()
      click('Sleep 15 minutes more')
      expect(screen.getByText('Starts tomorrow')).toBeTruthy()
      click('Save')
      await waitFor(() => expect(setTarget).toHaveBeenCalledWith({ goal_min: 495, bed_target: '23:00' }, '2026-10-07'))
      // The nights per week did not change: the profile is left alone.
      expect(save).not.toHaveBeenCalled()
      expect(h.toast).toHaveBeenCalledWith('New goal saved. It starts tomorrow.')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('warns that a new nights per week count starts next week', async () => {
      show()
      expect(screen.queryByText('The new weekly count starts next week.')).toBeNull()
      choose('6')
      expect(screen.getByText('The new weekly count starts next week.')).toBeTruthy()
      click('Save')
      await waitFor(() => expect(save).toHaveBeenCalledWith({ sleep_nights_per_week: 6 }))
      expect(setTarget).not.toHaveBeenCalled()
    })

    it('goes back to a quiet form when the change is undone', () => {
      show()
      click('Bedtime 15 minutes later')
      expect(screen.getByText('Starts tomorrow')).toBeTruthy()
      click('Bedtime 15 minutes earlier')
      expect(screen.queryByText('Starts tomorrow')).toBeNull()
    })
  })
})
