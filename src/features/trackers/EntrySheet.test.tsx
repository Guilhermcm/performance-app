// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import EntrySheet from './EntrySheet'
import { useTrackers } from './useTrackers'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { entryOf, trackerOf, T1 } from './test-trackers'
import type { Tracker, TrackerEntry } from './types'
import type { Profile } from '../profile/types'

const realProfile = useProfile.getState()
const realTrackers = useTrackers.getState()
const saveEntry = vi.fn(), deleteEntry = vi.fn(), onOpenChange = vi.fn()

type Mode = 'quick' | 'full'
const show = (tracker: Tracker, mode: Mode, entry?: TrackerEntry) =>
  render(<EntrySheet tracker={tracker} entry={entry} mode={mode} open onOpenChange={onOpenChange} />)
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })

const water = trackerOf() // number, 1 decimal, unit L
const sleepish = trackerOf({ kind: 'duration', unit: null, decimals: null, aggregate: 'sum' })
const mood = trackerOf({ kind: 'label', unit: null, decimals: null, aggregate: null, options: [
  { id: 'aaaa1111', text: 'Low' }, { id: 'bbbb2222', text: 'Fine' }, { id: 'cccc3333', text: 'Great' }
] })

// Friday 16 October 2026, 12:30 in Sao Paulo (UTC-3).
const NOW = '2026-10-16T15:30:00Z'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  ;[saveEntry, deleteEntry, onOpenChange, h.toast].forEach(f => f.mockReset())
  await setLang('en')
  useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'America/Sao_Paulo' } as unknown as Profile })
  useTrackers.setState({ entries: [], saveEntry, deleteEntry })
})
afterEach(async () => {
  cleanup(); vi.useRealTimers(); await setLang('en')
  useProfile.setState(realProfile); useTrackers.setState(realTrackers)
})

describe('EntrySheet: quick number', () => {
  it('starts on the last value, in the language notation, with the decimal keyboard', async () => {
    await setLang('pt-BR')
    useTrackers.setState({ entries: [entryOf('2026-10-15', { value: 1.8 })] })
    show(water, 'quick')
    const input = field('Valor')
    expect(input.value).toBe('1,8')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.className).toContain('tabular-nums')
  })

  it('saves today and the local time now, with the value rounded to the decimals', () => {
    show(water, 'quick')
    expect(button('Save').disabled).toBe(true)
    type('Value', '2.25')
    fireEvent.click(button('Save'))
    expect(saveEntry).toHaveBeenCalledWith({ tracker_id: T1, day: '2026-10-16', at: '12:30', value: 2.3, minutes: null, option: null, note: null })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('rounds to whole numbers when the tracker has no decimals', async () => {
    await setLang('pt-BR')
    show(trackerOf({ decimals: 0, unit: 'kg' }), 'quick')
    type('Valor', '72,6')
    fireEvent.click(button('Salvar'))
    expect(saveEntry.mock.calls[0][0].value).toBe(73)
  })

  it('refuses a thousands separator with a warning and keeps Save off', async () => {
    await setLang('pt-BR')
    show(water, 'quick')
    type('Valor', '1.234,5')
    expect(button('Salvar').disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('separador de milhar')
    fireEvent.click(button('Salvar'))
    expect(saveEntry).not.toHaveBeenCalled()
    type('Valor', 'abc')
    expect(button('Salvar').disabled).toBe(true)
    type('Valor', '1,2')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button('Salvar').disabled).toBe(false)
  })

  it('waits for the blur before warning about half-typed input', () => {
    show(water, 'quick')
    for (const text of ['-', '1.', '1,', '-2.']) {
      type('Value', text)
      expect(screen.queryByRole('alert'), text).toBeNull()
      expect(button('Save').disabled).toBe(true)
    }
    fireEvent.blur(field('Value'))
    expect(screen.getByRole('alert').textContent).toContain('decimal separator')
    type('Value', '2.5')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says a number past 10 integer digits is too big', () => {
    show(water, 'quick')
    type('Value', '12345678901')
    expect(screen.getByRole('alert').textContent).toBe('That number is too big.')
    expect(button('Save').disabled).toBe(true)
  })

  it('flips the sign with a 44 px button, since the decimal keypad has no minus', async () => {
    show(water, 'quick')
    const sign = button('Change sign')
    expect(sign.className).toContain('size-11')
    type('Value', '3.5')
    fireEvent.click(sign)
    expect(field('Value').value).toBe('-3.5')
    fireEvent.click(sign)
    expect(field('Value').value).toBe('3.5')
    fireEvent.click(sign)
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0].value).toBe(-3.5)
    cleanup()
    await setLang('pt-BR')
    show(water, 'quick')
    fireEvent.click(button('Trocar o sinal'))
    expect(field('Valor').value).toBe('-')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('queues one entry when Save is tapped twice fast', () => {
    show(water, 'quick')
    type('Value', '2')
    fireEvent.click(button('Save'))
    fireEvent.click(button('Save'))
    expect(saveEntry).toHaveBeenCalledTimes(1)
  })

  it('says the entry will take today and the time now, in pt-BR as what is to come', async () => {
    await setLang('pt-BR')
    show(water, 'quick')
    expect(screen.getByText('Fica com a data de hoje e a hora de agora.')).toBeTruthy()
  })

  it('writes the local day and time of the profile time zone (Tokyo, 00:30 on the 17th)', () => {
    useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'Asia/Tokyo' } as unknown as Profile })
    show(water, 'quick')
    type('Value', '1')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ day: '2026-10-17', at: '00:30' })
  })

  it('takes the time when Save is tapped, not when the sheet opened', () => {
    show(water, 'quick')
    type('Value', '1')
    vi.setSystemTime(new Date('2026-10-16T15:47:00Z'))
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0].at).toBe('12:47')
  })

  it('has no day, time or note fields', () => {
    show(water, 'quick')
    expect(screen.queryByLabelText('Time of day')).toBeNull()
    expect(screen.queryByLabelText('Note')).toBeNull()
  })
})

describe('EntrySheet: quick duration', () => {
  it('starts on the last duration as hours and minutes', () => {
    useTrackers.setState({ entries: [entryOf('2026-10-15', { value: null, minutes: 85 })] })
    show(sleepish, 'quick')
    expect(field('Hours').value).toBe('1')
    expect(field('Minutes').value).toBe('25')
  })

  it('saves the minutes', () => {
    show(sleepish, 'quick')
    expect(button('Save').disabled).toBe(true)
    type('Hours', '1'); type('Minutes', '30')
    fireEvent.click(button('Save'))
    expect(saveEntry).toHaveBeenCalledWith({ tracker_id: T1, day: '2026-10-16', at: '12:30', value: null, minutes: 90, option: null, note: null })
  })

  it('turns Save off for 0 h 0 min and for 24 h 1 min, and allows 24 h', () => {
    show(sleepish, 'quick')
    type('Hours', '0'); type('Minutes', '0')
    expect(button('Save').disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('between 1 minute and 24 hours')
    type('Hours', '24'); type('Minutes', '1')
    expect(button('Save').disabled).toBe(true)
    type('Minutes', '0')
    expect(button('Save').disabled).toBe(false)
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0].minutes).toBe(1440)
  })

  it('refuses minutes that are not whole numbers', () => {
    show(sleepish, 'quick')
    type('Hours', '1'); type('Minutes', '2.5')
    expect(button('Save').disabled).toBe(true)
  })
})

describe('EntrySheet: quick label', () => {
  it('shows one button per option, in order, and a tap saves and closes', () => {
    show(mood, 'quick')
    const names = screen.getAllByRole('button').map(b => b.textContent).filter(x => ['Low', 'Fine', 'Great'].includes(x ?? ''))
    expect(names).toEqual(['Low', 'Fine', 'Great'])
    fireEvent.click(button('Fine'))
    expect(saveEntry).toHaveBeenCalledWith({ tracker_id: T1, day: '2026-10-16', at: '12:30', value: null, minutes: null, option: 'bbbb2222', note: null })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('queues one entry when an option is tapped twice fast', () => {
    show(mood, 'quick')
    fireEvent.click(button('Fine'))
    fireEvent.click(button('Great'))
    expect(saveEntry).toHaveBeenCalledTimes(1)
  })
})

describe('EntrySheet: full', () => {
  it('offers today, yesterday and another day up to today and 89 days back', () => {
    show(water, 'full')
    expect(screen.getByRole('radio', { name: 'Today' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Yesterday' })).toBeTruthy()
    expect(screen.queryByLabelText('Date')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Another day' }))
    const date = field('Date')
    expect(date.max).toBe('2026-10-16')
    expect(date.min).toBe('2026-07-19')
  })

  it('saves the chosen day, time and note', () => {
    show(water, 'full')
    expect(field('Time of day').value).toBe('12:30')
    type('Value', '2')
    fireEvent.click(screen.getByRole('radio', { name: 'Yesterday' }))
    type('Time of day', '08:15')
    type('Note', 'After the run')
    fireEvent.click(button('Save'))
    expect(saveEntry).toHaveBeenCalledWith({ tracker_id: T1, day: '2026-10-15', at: '08:15', value: 2, minutes: null, option: null, note: 'After the run' })
  })

  it('saves another day and refuses one after today or before the window', () => {
    show(water, 'full')
    type('Value', '2')
    fireEvent.click(screen.getByRole('radio', { name: 'Another day' }))
    type('Date', '2026-10-17')
    expect(button('Save').disabled).toBe(true)
    type('Date', '2026-07-18')
    expect(button('Save').disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('last 90 days')
    type('Date', '2026-07-19')
    expect(button('Save').disabled).toBe(false)
    type('Date', '2026-10-01')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ day: '2026-10-01', at: '12:30' })
  })

  it('caps the note at 140 characters and counts them', () => {
    show(water, 'full')
    type('Note', 'x'.repeat(200))
    expect(field('Note').value.length).toBe(140)
    expect(screen.getByText('140/140')).toBeTruthy()
    type('Value', '1')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0].note).toHaveLength(140)
  })

  it('needs an option for a label tracker', () => {
    show(mood, 'full')
    expect(button('Save').disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'Great' }))
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ option: 'cccc3333', value: null, minutes: null })
  })

  it('says why Save is off when the time is cleared, and takes a time with seconds', () => {
    show(water, 'full')
    type('Value', '2')
    type('Time of day', '')
    expect(button('Save').disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('Choose a time.')
    expect(field('Time of day').getAttribute('aria-describedby')).toBeTruthy()
    type('Time of day', '08:15:00')
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ at: '08:15' })
  })

  it('starts the time of a new entry at the local time now (Tokyo)', () => {
    useProfile.setState({ status: 'ready', profile: { id: 'u1', timezone: 'Asia/Tokyo' } as unknown as Profile })
    show(water, 'full')
    expect(field('Time of day').value).toBe('00:30')
    type('Value', '1')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ day: '2026-10-17', at: '00:30' })
  })
})

describe('EntrySheet: editing', () => {
  const old = entryOf('2026-10-10', { id: 'e-old', at: '07:05', value: 3.5, note: 'Hot day' })

  it('fills everything from the entry and saves under the same id', () => {
    show(water, 'full', old)
    expect(screen.getByRole('heading', { name: 'Edit entry' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Another day' }).getAttribute('aria-checked')).toBe('true')
    expect(field('Date').value).toBe('2026-10-10')
    expect(field('Time of day').value).toBe('07:05')
    expect(field('Value').value).toBe('3.5')
    expect(field('Note').value).toBe('Hot day')
    type('Value', '4')
    fireEvent.click(button('Save'))
    expect(saveEntry).toHaveBeenCalledWith({ id: 'e-old', tracker_id: T1, day: '2026-10-10', at: '07:05', value: 4, minutes: null, option: null, note: 'Hot day' })
  })

  it('keeps the stored precision of a value the tracker now writes with fewer decimals, until it changes', () => {
    const precise = entryOf('2026-10-10', { id: 'e-precise', value: 1.85 })
    show(water, 'full', precise)
    expect(field('Value').value).toBe('1.85')
    type('Note', 'Late')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ id: 'e-precise', value: 1.85, note: 'Late' })
    cleanup(); saveEntry.mockReset()
    show(water, 'full', precise)
    type('Value', '1.84')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0].value).toBe(1.8)
  })

  it('reads today and yesterday as their own choices, and an empty note as null', () => {
    show(water, 'full', entryOf('2026-10-15', { id: 'e2' }))
    expect(screen.getByRole('radio', { name: 'Yesterday' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ id: 'e2', day: '2026-10-15', note: null })
  })

  it('asks before deleting, then deletes the entry and closes', () => {
    show(water, 'full', old)
    fireEvent.click(button('Delete entry'))
    expect(deleteEntry).not.toHaveBeenCalled()
    const ask = screen.getByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(button('Delete entry'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete entry' }))
    expect(deleteEntry).toHaveBeenCalledWith('e-old')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('has no delete button while adding', () => {
    show(water, 'full')
    expect(screen.queryByRole('button', { name: 'Delete entry' })).toBeNull()
  })

  it('edits and deletes an entry of an archived tracker', () => {
    const archived = trackerOf({ archived_at: '2026-10-01T10:00:00.000Z' })
    show(archived, 'full', old)
    type('Value', '5')
    fireEvent.click(button('Save'))
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ id: 'e-old', value: 5 })
    cleanup()
    show(archived, 'full', old)
    fireEvent.click(button('Delete entry'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete entry' }))
    expect(deleteEntry).toHaveBeenCalledWith('e-old')
  })

  it('edits a duration and a label entry', () => {
    show(sleepish, 'full', entryOf('2026-10-15', { id: 'd1', value: null, minutes: 45 }))
    expect(field('Hours').value).toBe('0')
    expect(field('Minutes').value).toBe('45')
    cleanup()
    show(mood, 'full', entryOf('2026-10-15', { id: 'l1', value: null, option: 'bbbb2222' }))
    expect(screen.getByRole('radio', { name: 'Fine' }).getAttribute('aria-checked')).toBe('true')
  })
})
