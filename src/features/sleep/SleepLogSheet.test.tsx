// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import { SleepLogSheet } from './SleepLogSheet'
import { useSleep } from './useSleep'
import { useProfile } from '../profile/useProfile'
import { logOf, targetOf } from './test-sleep'
import type { Profile } from '../profile/types'
import type { SleepLog } from './types'

// 2026-10-07 10:30 UTC is 07:30 on a Wednesday in Sao Paulo.
const NOW = new Date('2026-10-07T10:30:00Z')
const TODAY = '2026-10-07', YESTERDAY = '2026-10-06', BEFORE = '2026-10-05'
const realProfile = useProfile.getState()
const realSleep = useSleep.getState()
const saveNight = vi.fn((input: Omit<SleepLog, 'duration_min' | 'updated_at'>) => logOf(input))
const removeNight = vi.fn()
const onOpenChange = vi.fn()

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const show = (night: string) => render(<SleepLogSheet night={night} open onOpenChange={onOpenChange} />)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  ;[saveNight, removeNight, onOpenChange, h.toast].forEach(f => f.mockClear())
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo', sleep_enabled: true } as unknown as Profile })
  useSleep.setState({
    saveNight, removeNight, targets: [targetOf()], closed: [], status: 'ready',
    logs: { [YESTERDAY]: logOf({ night: YESTERDAY, bed_time: '23:40', wake_time: '07:20', quality: 3 }) }
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); useProfile.setState(realProfile); useSleep.setState(realSleep) })

describe('SleepLogSheet', () => {
  it('opens last night as it was logged and saves the change', () => {
    show(YESTERDAY)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Edit night' })).toBeTruthy()
    expect(button(/Went to bed/).textContent).toContain('23:40')
    expect(button(/Woke up/).textContent).toContain('07:20')
    expect(screen.getByRole('radio', { name: 'Okay' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Great' }))
    fireEvent.click(button('Save'))
    expect(saveNight).toHaveBeenCalledTimes(1)
    expect(saveNight).toHaveBeenCalledWith({ night: YESTERDAY, bed_time: '23:40', wake_time: '07:20', quality: 5, note: null })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(h.toast).toHaveBeenCalledWith('Night saved')
  })

  it('deletes the night only after asking', () => {
    show(YESTERDAY)
    fireEvent.click(button('Delete this night'))
    const ask = screen.getByRole('alertdialog', { name: 'Delete this night?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(removeNight).not.toHaveBeenCalled()
    fireEvent.click(button('Delete this night'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    expect(removeNight).toHaveBeenCalledTimes(1)
    expect(removeNight).toHaveBeenCalledWith(YESTERDAY)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('logs a night of today or yesterday that has no record, with nothing to delete', () => {
    show(TODAY)
    expect(screen.getByRole('heading', { name: 'Log night' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete this night' })).toBeNull()
    fireEvent.click(button('Confirm'))
    expect(saveNight.mock.calls[0][0]).toMatchObject({ night: TODAY })
  })

  it('does not open the night before yesterday for editing', () => {
    useSleep.setState({ logs: { [BEFORE]: logOf({ night: BEFORE }) } })
    show(BEFORE)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete this night' })).toBeNull()
    expect(screen.getByText('This night has closed. Only today’s and yesterday’s nights can still change.')).toBeTruthy()
    fireEvent.click(button('Close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
