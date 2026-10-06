// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import MeasureSheet from './MeasureSheet'
import { useNutrition } from './useNutrition'
import { ME, measureOf } from './test-nutrition'

const real = useNutrition.getState()
const addMeasure = vi.fn((m: { food_key: string; label: string; grams: number }) => ({ ...m, id: 'new', updated_at: 'x' }))
const updateMeasure = vi.fn(), removeMeasure = vi.fn(), onOpenChange = vi.fn(), onSaved = vi.fn()
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  ;[addMeasure, updateMeasure, removeMeasure, onOpenChange, onSaved, h.toast].forEach(f => f.mockClear())
  useNutrition.setState({ userId: ME, measures: [], addMeasure, updateMeasure, removeMeasure })
})
afterEach(() => { cleanup(); useNutrition.setState(real) })

describe('MeasureSheet', () => {
  it('creates a measure from the current portion, with the name trimmed', () => {
    render(<MeasureSheet foodKey="taco:3" defaultGrams={90} open onOpenChange={onOpenChange} onSaved={onSaved} />)
    expect(screen.getByRole('heading', { name: 'New measure' })).toBeTruthy()
    expect(value('Grams')).toBe('90')
    expect(button('Create measure').disabled).toBe(true)
    type('Name', '  concha  ')
    fireEvent.click(button('Create measure'))
    expect(addMeasure).toHaveBeenCalledWith({ food_key: 'taco:3', label: 'concha', grams: 90 })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', label: 'concha' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('takes a name of 1 to 30 characters', () => {
    render(<MeasureSheet foodKey="taco:3" defaultGrams={90} open onOpenChange={onOpenChange} />)
    type('Name', '   ')
    expect(button('Create measure').disabled).toBe(true)
    type('Name', 'x'.repeat(31))
    expect(screen.getByText('Use 1 to 30 characters.')).toBeTruthy()
    expect(button('Create measure').disabled).toBe(true)
    type('Name', 'x'.repeat(30))
    expect(screen.queryByText('Use 1 to 30 characters.')).toBeNull()
    expect(button('Create measure').disabled).toBe(false)
  })

  it('takes 1 to 2000 g, with a comma for decimals', () => {
    render(<MeasureSheet foodKey="taco:3" defaultGrams={90} open onOpenChange={onOpenChange} />)
    type('Name', 'prato')
    for (const bad of ['0', '0,5', '2001', 'abc', '']) {
      type('Grams', bad)
      expect(button('Create measure').disabled, bad).toBe(true)
    }
    type('Grams', '2001')
    expect(screen.getByText('Use between 1 and 2000 g.')).toBeTruthy()
    type('Grams', '2000')
    expect(button('Create measure').disabled).toBe(false)
    type('Grams', '45,5')
    fireEvent.click(button('Create measure'))
    expect(addMeasure).toHaveBeenCalledWith({ food_key: 'taco:3', label: 'prato', grams: 45.5 })
  })

  it('starts the grams inside the range when the portion is outside it', () => {
    render(<MeasureSheet foodKey="taco:3" defaultGrams={4000} open onOpenChange={onOpenChange} />)
    expect(value('Grams')).toBe('2000')
  })

  it('stops at 10 measures for the food, and only for that food', () => {
    const ten = Array.from({ length: 10 }, (_, i) => measureOf({ food_key: 'taco:3', label: `m${i}`, grams: i + 1 }))
    useNutrition.setState({ measures: ten })
    const { unmount } = render(<MeasureSheet foodKey="taco:3" defaultGrams={90} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('This food already has 10 measures. Delete one to add another.')).toBeTruthy()
    type('Name', 'concha')
    expect(button('Create measure').disabled).toBe(true)
    unmount()
    render(<MeasureSheet foodKey="taco:4" defaultGrams={90} open onOpenChange={onOpenChange} />)
    type('Name', 'concha')
    expect(button('Create measure').disabled).toBe(false)
  })

  it('edits a measure, even when the food is at the limit', () => {
    const m = measureOf({ id: 'p1', food_key: 'taco:3', label: 'prato', grams: 300 })
    useNutrition.setState({ measures: [m, ...Array.from({ length: 9 }, (_, i) => measureOf({ food_key: 'taco:3', label: `m${i}` }))] })
    render(<MeasureSheet foodKey="taco:3" measure={m} defaultGrams={90} open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('heading', { name: 'Edit measure' })).toBeTruthy()
    expect(value('Name')).toBe('prato')
    expect(value('Grams')).toBe('300')
    type('Grams', '250')
    fireEvent.click(button('Save'))
    expect(updateMeasure).toHaveBeenCalledWith('p1', { label: 'prato', grams: 250 })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('deletes a measure with an undo', () => {
    const m = measureOf({ id: 'p1', food_key: 'taco:3', label: 'prato', grams: 300 })
    useNutrition.setState({ measures: [m] })
    render(<MeasureSheet foodKey="taco:3" measure={m} defaultGrams={90} open onOpenChange={onOpenChange} />)
    fireEvent.click(button('Delete'))
    expect(removeMeasure).toHaveBeenCalledWith('p1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(h.toast).toHaveBeenCalledWith('prato removed', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    h.toast.mock.calls[0][1].action.onClick()
    expect(addMeasure).toHaveBeenCalledWith({ food_key: 'taco:3', label: 'prato', grams: 300 })
  })
})
