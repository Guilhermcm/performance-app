// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

import { SleepLogForm } from './SleepLogForm'
import { useSleep } from './useSleep'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { logOf, targetOf } from './test-sleep'
import type { Profile } from '../profile/types'
import type { SleepLog } from './types'

// 2026-10-07 10:30 UTC is 07:30 on a Wednesday in Sao Paulo.
const NOW = new Date('2026-10-07T10:30:00Z')
const TODAY = '2026-10-07', YESTERDAY = '2026-10-06'
const realProfile = useProfile.getState()
const realSleep = useSleep.getState()
const saveNight = vi.fn((input: Omit<SleepLog, 'duration_min' | 'updated_at'>) => logOf({ ...input, duration_min: 0 }))

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  saveNight.mockClear()
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo', sleep_enabled: true } as unknown as Profile })
  useSleep.setState({ saveNight, targets: [targetOf()], logs: {}, closed: [], status: 'ready' })
})
afterEach(async () => {
  cleanup(); vi.useRealTimers()
  useProfile.setState(realProfile); useSleep.setState(realSleep)
  await setLang('en')
})

describe('SleepLogForm', () => {
  it('saves the times as they are, with no quality or note', () => {
    const onSaved = vi.fn()
    render(<SleepLogForm night={YESTERDAY} initial={logOf({ night: '2026-10-04', bed_time: '23:20', wake_time: '07:00', quality: 5, note: 'old' })} onSaved={onSaved} />)
    // Times from another night are a starting point; its quality and note are not.
    expect(screen.getByRole('button', { name: /Went to bed/ }).textContent).toContain('23:20')
    expect(screen.getByRole('button', { name: /Woke up/ }).textContent).toContain('07:00')
    fireEvent.click(button('Confirm'))
    expect(saveNight).toHaveBeenCalledTimes(1)
    expect(saveNight).toHaveBeenCalledWith({ night: YESTERDAY, bed_time: '23:20', wake_time: '07:00', quality: null, note: null })
    expect(onSaved).toHaveBeenCalledWith(saveNight.mock.results[0].value)
  })

  it('edits the night it was given, keeping its quality and note', () => {
    render(<SleepLogForm night={YESTERDAY} initial={logOf({ night: YESTERDAY, bed_time: '23:20', wake_time: '07:00', quality: 4, note: 'ok' })} />)
    expect(screen.getByRole('radio', { name: 'Good' }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('ok')
    fireEvent.click(button('Save'))
    expect(saveNight).toHaveBeenCalledWith({ night: YESTERDAY, bed_time: '23:20', wake_time: '07:00', quality: 4, note: 'ok' })
  })

  it('starts from the bedtime target and the goal when there is nothing to go on', () => {
    useSleep.setState({ targets: [targetOf({ bed_target: '22:30', goal_min: 450 })] })
    render(<SleepLogForm night={TODAY} />)
    expect(screen.getByRole('button', { name: /Went to bed/ }).textContent).toContain('22:30')
    expect(screen.getByRole('button', { name: /Woke up/ }).textContent).toContain('06:00')
  })

  it('opens the wheel for a time and moves it', () => {
    render(<SleepLogForm night={YESTERDAY} initial={logOf({ bed_time: '23:00', wake_time: '07:00' })} />)
    const bed = screen.getByRole('button', { name: /Went to bed/ })
    expect(bed.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(bed)
    expect(bed.getAttribute('aria-expanded')).toBe('true')
    const wheel = screen.getByRole('group', { name: 'Went to bed' })
    fireEvent.click(within(wheel).getByRole('button', { name: '+15' }))
    expect(bed.textContent).toContain('23:15')
    fireEvent.click(button('Confirm'))
    expect(saveNight.mock.calls[0][0]).toMatchObject({ bed_time: '23:15', wake_time: '07:00' })
  })

  it('blocks a night shorter than 1 hour or longer than 16', async () => {
    await setLang('pt-BR')
    render(<SleepLogForm night={YESTERDAY} initial={logOf({ bed_time: '23:00', wake_time: '23:30' })} />)
    expect(screen.getByRole('alert').textContent).toBe('A noite precisa ter entre 1 e 16 horas')
    expect(button('Confirmar').disabled).toBe(true)
    fireEvent.submit(button('Confirmar').closest('form')!)
    expect(saveNight).not.toHaveBeenCalled()
  })

  it('does not take a wake-up time later than now for last night', () => {
    // 07:30 now: waking at 08:00 today has not happened yet.
    render(<SleepLogForm night={TODAY} initial={logOf({ bed_time: '23:00', wake_time: '08:00' })} />)
    expect(screen.getByRole('alert').textContent).toBe('The wake-up time can’t be later than now')
    expect(button('Confirm').disabled).toBe(true)
    cleanup()
    // The same times on yesterday's night are fine.
    render(<SleepLogForm night={YESTERDAY} initial={logOf({ bed_time: '23:00', wake_time: '08:00' })} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button('Confirm').disabled).toBe(false)
  })

  it('names each quality in words and lets it go again', async () => {
    await setLang('pt-BR')
    render(<SleepLogForm night={YESTERDAY} initial={logOf()} />)
    const names = screen.getAllByRole('radio').map(r => r.textContent)
    expect(names).toEqual(['Péssima', 'Ruim', 'Ok', 'Boa', 'Ótima'])
    const good = screen.getByRole('radio', { name: 'Boa' })
    fireEvent.click(good)
    expect(good.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(good)
    expect(good.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(good)
    fireEvent.click(button('Confirmar'))
    expect(saveNight.mock.calls[0][0]).toMatchObject({ quality: 4 })
  })

  it('adds a note of up to 140 characters, with a counter', () => {
    render(<SleepLogForm night={YESTERDAY} initial={logOf()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(button('Add note'))
    const note = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
    expect(note.maxLength).toBe(140)
    fireEvent.change(note, { target: { value: 'x'.repeat(150) } })
    expect(note.value).toHaveLength(140)
    expect(screen.getByText('140/140')).toBeTruthy()
    fireEvent.change(note, { target: { value: '  woke up once  ' } })
    expect(screen.getByText('16/140')).toBeTruthy()
    fireEvent.click(button('Confirm'))
    expect(saveNight.mock.calls[0][0]).toMatchObject({ note: 'woke up once' })
  })
})
