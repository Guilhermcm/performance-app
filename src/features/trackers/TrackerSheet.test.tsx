// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import TrackerSheet from './TrackerSheet'
import { useTrackers } from './useTrackers'
import { classify } from '@/lib/supabase-errors'
import { trackerOf, entryOf, T1 } from './test-trackers'
import type { Tracker, TrackerOption } from './types'

const realTrackers = useTrackers.getState()
const saveTracker = vi.fn(), archiveTracker = vi.fn(), reactivateTracker = vi.fn(), onOpenChange = vi.fn()

const show = (tracker?: Tracker, onSaved?: (t: Tracker) => void) =>
  render(<TrackerSheet tracker={tracker} open onOpenChange={onOpenChange} onSaved={onSaved} />)
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const nameField = () => screen.getByLabelText('Name') as HTMLInputElement
const type = (value: string) => fireEvent.change(nameField(), { target: { value } })
const radio = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))
const optionFields = () => screen.getAllByRole('textbox').filter(e => /^Name of option/.test(e.getAttribute('aria-label') ?? '')) as HTMLInputElement[]
const setOption = (i: number, value: string) => fireEvent.change(optionFields()[i], { target: { value } })
const manyActive = (n: number) => Array.from({ length: n }, (_, i) => trackerOf({ id: `t${i}`, sort: i }))

const MOOD: TrackerOption[] = [{ id: 'good1234', text: 'Good' }, { id: 'bad56789', text: 'Bad' }, { id: 'meh00000', text: 'Meh' }]
const mood = (over: Partial<Tracker> = {}) => trackerOf({ name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, options: MOOD, ...over })

beforeEach(() => {
  ;[saveTracker, archiveTracker, reactivateTracker, onOpenChange, h.toast].forEach(f => f.mockReset())
  saveTracker.mockImplementation((input: object) => trackerOf(input as Partial<Tracker>))
  useTrackers.setState({ trackers: [], entries: [], status: 'ready', saveTracker, archiveTracker, reactivateTracker })
})
afterEach(() => { cleanup(); useTrackers.setState(realTrackers) })

describe('TrackerSheet: creating', () => {
  it('creates a number tracker with its unit, decimals and sum', () => {
    show()
    expect(screen.getByRole('heading', { name: 'New tracker' })).toBeTruthy()
    expect(button('Create tracker').disabled).toBe(true)
    type('  Water ')
    fireEvent.click(screen.getByRole('button', { name: 'Water drop' }))
    fireEvent.change(screen.getByLabelText('Unit (optional)'), { target: { value: 'L' } })
    radio('1')
    radio('Sum')
    expect(button('Create tracker').disabled).toBe(false)
    fireEvent.click(button('Create tracker'))
    expect(saveTracker).toHaveBeenCalledWith({ name: 'Water', icon: 'droplet', kind: 'number', unit: 'L', decimals: 1, aggregate: 'sum', options: null })
    expect(h.toast).toHaveBeenCalledWith('Tracker created')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('starts as a number with no unit, no decimals and a sum, and cuts the unit at 12 characters', () => {
    show()
    expect(screen.getByRole('radio', { name: 'Number' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '0' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Sum' }).getAttribute('aria-checked')).toBe('true')
    const unit = screen.getByLabelText('Unit (optional)') as HTMLInputElement
    fireEvent.change(unit, { target: { value: 'x'.repeat(14) } })
    expect(unit.value).toBe('x'.repeat(12))
    fireEvent.change(unit, { target: { value: '' } })
    type('Steps')
    fireEvent.click(button('Create tracker'))
    expect(saveTracker).toHaveBeenCalledWith({ name: 'Steps', icon: 'check', kind: 'number', unit: null, decimals: 0, aggregate: 'sum', options: null })
  })

  it('creates a duration tracker with no unit or decimals, and the average when asked', () => {
    show()
    radio('Duration')
    expect(screen.queryByLabelText('Unit (optional)')).toBeNull()
    expect(screen.queryByRole('radio', { name: '2' })).toBeNull()
    type('Reading')
    radio('Average')
    fireEvent.click(button('Create tracker'))
    expect(saveTracker).toHaveBeenCalledWith({ name: 'Reading', icon: 'check', kind: 'duration', unit: null, decimals: null, aggregate: 'avg', options: null })
  })

  it('switching the type back and forth keeps what was typed for the type shown', () => {
    show()
    fireEvent.change(screen.getByLabelText('Unit (optional)'), { target: { value: 'kg' } })
    radio('Choice')
    radio('Number')
    expect((screen.getByLabelText('Unit (optional)') as HTMLInputElement).value).toBe('kg')
  })

  it('cuts the name at 40 characters and shows the count', () => {
    show()
    type('a'.repeat(41))
    expect(nameField().value).toBe('a'.repeat(40))
    expect(screen.getByText('40/40')).toBeTruthy()
    type('Run')
    expect(screen.getByText('3/40')).toBeTruthy()
  })

  it('offers the 24 icons as named buttons', () => {
    show()
    const icons = within(screen.getByRole('group', { name: 'Icon' })).getAllByRole('button')
    expect(icons).toHaveLength(24)
    expect(icons.every(b => b.getAttribute('aria-label'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Check mark' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('tells the caller which tracker was saved, and only then', () => {
    const onSaved = vi.fn()
    show(undefined, onSaved)
    type('Water')
    saveTracker.mockImplementationOnce(() => { throw classify({ code: 'P0001', message: 'too_many_trackers' }) })
    fireEvent.click(button('Create tracker'))
    expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(button('Create tracker'))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved.mock.calls[0][0].name).toBe('Water')
  })

  it('has nothing to archive', () => {
    show()
    expect(screen.queryByRole('button', { name: 'Archive tracker' })).toBeNull()
  })
})

describe('TrackerSheet: label options', () => {
  it('starts with two empty options and saves only when both have text', () => {
    show()
    radio('Choice')
    type('Mood')
    expect(optionFields()).toHaveLength(2)
    expect(optionFields().every(f => f.value === '')).toBe(true)
    expect(button('Create tracker').disabled).toBe(true)
    setOption(0, 'Good')
    expect(button('Create tracker').disabled).toBe(true)
    setOption(1, '   ')
    expect(button('Create tracker').disabled).toBe(true)
    expect(screen.getByText('Write a name for every option.')).toBeTruthy()
    setOption(1, ' Bad ')
    expect(button('Create tracker').disabled).toBe(false)
    fireEvent.click(button('Create tracker'))
    const input = saveTracker.mock.calls[0][0]
    expect(input).toMatchObject({ name: 'Mood', icon: 'check', kind: 'label', unit: null, decimals: null, aggregate: null })
    expect(input.options.map((o: TrackerOption) => o.text)).toEqual(['Good', 'Bad'])
    // Ids the server accepts: 1 to 16 of a-z0-9, one apiece.
    for (const o of input.options) expect(o.id).toMatch(/^[a-z0-9]{1,16}$/)
    expect(new Set(input.options.map((o: TrackerOption) => o.id)).size).toBe(2)
  })

  it('adds up to 8 options and the add button goes away on the 8th', () => {
    show()
    radio('Choice')
    for (let n = 3; n <= 8; n++) {
      fireEvent.click(button('Add option'))
      expect(optionFields()).toHaveLength(n)
    }
    expect(screen.queryByRole('button', { name: 'Add option' })).toBeNull()
  })

  it('removes an option while more than two are left', () => {
    show()
    radio('Choice')
    fireEvent.click(button('Add option'))
    setOption(0, 'A'); setOption(1, 'B'); setOption(2, 'C')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove option' })[1])
    expect(optionFields().map(f => f.value)).toEqual(['A', 'C'])
    expect(screen.getAllByRole('button', { name: 'Remove option' }).every(b => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getByText('Between 2 and 8 options.')).toBeTruthy()
  })

  it('reorders with the arrows, and the first cannot go up nor the last down', () => {
    show()
    radio('Choice')
    fireEvent.click(button('Add option'))
    setOption(0, 'A'); setOption(1, 'B'); setOption(2, 'C')
    const up = () => screen.getAllByRole('button', { name: 'Move up' }) as HTMLButtonElement[]
    const down = () => screen.getAllByRole('button', { name: 'Move down' }) as HTMLButtonElement[]
    expect(up()[0].disabled).toBe(true)
    expect(down()[2].disabled).toBe(true)
    fireEvent.click(up()[2])
    expect(optionFields().map(f => f.value)).toEqual(['A', 'C', 'B'])
    fireEvent.click(down()[0])
    expect(optionFields().map(f => f.value)).toEqual(['C', 'A', 'B'])
    type('Mood')
    fireEvent.click(button('Create tracker'))
    expect(saveTracker.mock.calls[0][0].options.map((o: TrackerOption) => o.text)).toEqual(['C', 'A', 'B'])
  })

  it('cuts an option at 24 characters', () => {
    show()
    radio('Choice')
    setOption(0, 'a'.repeat(30))
    expect(optionFields()[0].value).toBe('a'.repeat(24))
  })

  it('has the option controls at 44 px', () => {
    show()
    radio('Choice')
    for (const b of [...screen.getAllByRole('button', { name: 'Move up' }), ...screen.getAllByRole('button', { name: 'Remove option' }), button('Add option')]) {
      expect(b.className).toMatch(/\b(size-11|h-11|h-12)\b/)
    }
  })
})

describe('TrackerSheet: editing', () => {
  it('starts from the tracker, shows the type as text and saves the changes', () => {
    const water = trackerOf({ name: 'Water', icon: 'droplet', unit: 'L', decimals: 1, aggregate: 'sum' })
    useTrackers.setState({ trackers: [water] })
    show(water)
    expect(screen.getByRole('heading', { name: 'Edit tracker' })).toBeTruthy()
    expect(nameField().value).toBe('Water')
    expect(screen.getByRole('button', { name: 'Water drop' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Unit (optional)') as HTMLInputElement).value).toBe('L')
    expect(screen.getByRole('radio', { name: '1' }).getAttribute('aria-checked')).toBe('true')
    // The type is shown and cannot change.
    expect(screen.queryByRole('radio', { name: 'Number' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Duration' })).toBeNull()
    expect(screen.getByText('Number')).toBeTruthy()
    expect(screen.getByText('The type cannot change after the tracker is created.')).toBeTruthy()
    type(' Water drunk ')
    radio('Average')
    fireEvent.click(button('Save'))
    expect(saveTracker).toHaveBeenCalledWith({ id: T1, name: 'Water drunk', icon: 'droplet', kind: 'number', unit: 'L', decimals: 1, aggregate: 'avg', options: null })
    expect(h.toast).toHaveBeenCalledWith('Saved')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes without saving when nothing changed', () => {
    const water = trackerOf()
    useTrackers.setState({ trackers: [water] })
    show(water)
    fireEvent.click(button('Save'))
    expect(saveTracker).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renames and reorders the options of a label tracker, keeping their ids', () => {
    const t = mood()
    useTrackers.setState({ trackers: [t] })
    show(t)
    expect(optionFields().map(f => f.value)).toEqual(['Good', 'Bad', 'Meh'])
    setOption(0, 'Great')
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
    fireEvent.click(button('Add option'))
    setOption(3, 'Awful')
    fireEvent.click(button('Save'))
    const input = saveTracker.mock.calls[0][0]
    expect(input).toMatchObject({ id: T1, kind: 'label', unit: null, decimals: null, aggregate: null })
    expect(input.options.slice(0, 3)).toEqual([{ id: 'bad56789', text: 'Bad' }, { id: 'good1234', text: 'Great' }, { id: 'meh00000', text: 'Meh' }])
    expect(input.options[3].text).toBe('Awful')
    expect(input.options[3].id).toMatch(/^[a-z0-9]{1,16}$/)
  })

  it('does not let an option with entries in the window go, and says why', () => {
    const t = mood()
    useTrackers.setState({ trackers: [t], entries: [entryOf('2026-10-10', { tracker_id: T1, value: null, option: 'bad56789' })] })
    show(t)
    const remove = screen.getAllByRole('button', { name: 'Remove option' }) as HTMLButtonElement[]
    expect(remove.map(b => b.disabled)).toEqual([false, true, false])
    expect(screen.getAllByText('This option has entries in the last 90 days, so it cannot be removed.')).toHaveLength(1)
    fireEvent.click(remove[0])
    expect(optionFields().map(f => f.value)).toEqual(['Bad', 'Meh'])
  })

  it('ignores the entries of other trackers when deciding what can be removed', () => {
    const t = mood()
    useTrackers.setState({ trackers: [t], entries: [entryOf('2026-10-10', { tracker_id: 'other', value: null, option: 'bad56789' })] })
    show(t)
    expect((screen.getAllByRole('button', { name: 'Remove option' }) as HTMLButtonElement[]).every(b => !b.disabled)).toBe(true)
  })

  it('says the previous values were kept for any other failure', () => {
    const t = trackerOf()
    useTrackers.setState({ trackers: [t] })
    saveTracker.mockImplementation(() => { throw new Error('boom') })
    show(t)
    type('Other')
    fireEvent.click(button('Save'))
    expect(h.toast).toHaveBeenCalledWith('Could not save. Your previous values were kept.')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('still edits a tracker with 30 active', () => {
    const t = trackerOf()
    useTrackers.setState({ trackers: [t, ...manyActive(29)] })
    show(t)
    type('Other')
    expect(button('Save').disabled).toBe(false)
    expect(screen.queryByText(/the most allowed/)).toBeNull()
  })

  it('asks before archiving, and archives on confirmation', () => {
    const t = trackerOf()
    useTrackers.setState({ trackers: [t] })
    show(t)
    fireEvent.click(button('Archive tracker'))
    expect(screen.getByRole('alertdialog', { name: 'Archive this tracker?' })).toBeTruthy()
    fireEvent.click(button('Cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(archiveTracker).not.toHaveBeenCalled()
    fireEvent.click(button('Archive tracker'))
    fireEvent.click(button('Archive'))
    expect(archiveTracker).toHaveBeenCalledWith(T1)
    expect(saveTracker).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Tracker archived')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('TrackerSheet: the 30 active limit', () => {
  it('cannot create a 31st active tracker and says why', () => {
    useTrackers.setState({ trackers: [...manyActive(30), trackerOf({ id: 'old', archived_at: '2026-10-01T00:00:00Z' })] })
    show()
    type('One more')
    expect(button('Create tracker').disabled).toBe(true)
    expect(screen.getByText('You already have 30 active trackers, the most allowed. Archive one to make room.')).toBeTruthy()
    fireEvent.click(button('Create tracker'))
    expect(saveTracker).not.toHaveBeenCalled()
  })

  it('creates with 29 active', () => {
    useTrackers.setState({ trackers: manyActive(29) })
    show()
    type('One more')
    expect(button('Create tracker').disabled).toBe(false)
    expect(screen.queryByText(/the most allowed/)).toBeNull()
  })

  it('keeps the sheet open and explains when the store refuses a 31st tracker', () => {
    saveTracker.mockImplementation(() => { throw classify({ code: 'P0001', message: 'too_many_trackers' }) })
    show()
    type('Water')
    fireEvent.click(button('Create tracker'))
    expect(h.toast).toHaveBeenCalledWith('You already have 30 active trackers, the most allowed. Archive one to make room.')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('TrackerSheet: an archived tracker', () => {
  const old = trackerOf({ archived_at: '2026-10-01T00:00:00Z' })

  it('offers Reactivate instead of Archive, and brings it back with the edits', () => {
    useTrackers.setState({ trackers: [old] })
    show(old)
    expect(screen.queryByRole('button', { name: 'Archive tracker' })).toBeNull()
    fireEvent.click(button('Reactivate'))
    expect(reactivateTracker).toHaveBeenCalledWith(T1)
    expect(saveTracker).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Tracker reactivated')
    expect(onOpenChange).toHaveBeenCalledWith(false)

    reactivateTracker.mockClear()
    onOpenChange.mockClear()
    cleanup()
    show(old)
    type('Water 2')
    fireEvent.click(button('Reactivate'))
    expect(saveTracker).toHaveBeenCalledWith(expect.objectContaining({ id: T1, name: 'Water 2', kind: 'number' }))
    expect(reactivateTracker).toHaveBeenCalledWith(T1)
    expect(saveTracker.mock.invocationCallOrder[0]).toBeLessThan(reactivateTracker.mock.invocationCallOrder[0])
  })

  it('cannot come back with 30 active and says why', () => {
    useTrackers.setState({ trackers: [old, ...manyActive(30)] })
    show(old)
    expect(button('Reactivate').disabled).toBe(true)
    expect(screen.getByText('You already have 30 active trackers, the most allowed. Archive one to make room.')).toBeTruthy()
  })

  it('keeps the sheet open when the store refuses the reactivation', () => {
    useTrackers.setState({ trackers: [old] })
    reactivateTracker.mockImplementation(() => { throw classify({ code: 'P0001', message: 'too_many_trackers' }) })
    show(old)
    fireEvent.click(button('Reactivate'))
    expect(h.toast).toHaveBeenCalledWith('You already have 30 active trackers, the most allowed. Archive one to make room.')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
