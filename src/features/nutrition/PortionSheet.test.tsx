// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import PortionSheet from './PortionSheet'
import { useNutrition } from './useNutrition'
import { ME, foodOf, itemOf, logOf } from './test-nutrition'

const real = useNutrition.getState()
const addLog = vi.fn(), updateLog = vi.fn(), toggleFavorite = vi.fn()
const onOpenChange = vi.fn()
const grams = () => (screen.getByLabelText('Grams') as HTMLInputElement).value
const save = () => screen.getByRole('button', { name: /^(Add|Save)$/ }) as HTMLButtonElement

beforeEach(() => {
  ;[addLog, updateLog, toggleFavorite, onOpenChange].forEach(f => f.mockReset())
  useNutrition.setState({ userId: ME, foods: [], addLog, updateLog, toggleFavorite })
})
afterEach(() => { cleanup(); useNutrition.setState(real) })

describe('PortionSheet', () => {
  it('offers 50, 100, 150 and 200 g and updates the totals live', () => {
    render(<PortionSheet item={itemOf()} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(grams()).toBe('100')
    expect(screen.getByTestId('portion-kcal').textContent).toBe('128')
    for (const g of [50, 100, 150]) expect(screen.getByRole('button', { name: `${g} g` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '200 g' }))
    expect(grams()).toBe('200')
    expect(screen.getByTestId('portion-kcal').textContent).toBe('256')
    expect(screen.getByText('5 g')).toBeTruthy() // protein: 2.5 × 2
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(grams()).toBe('210')
    fireEvent.change(screen.getByLabelText('Grams'), { target: { value: '75' } })
    expect(screen.getByTestId('portion-kcal').textContent).toBe('96')
  })

  it('starts on the label serving when the food has one, and offers it as a shortcut', () => {
    render(<PortionSheet item={itemOf({ serving_g: 30, serving_label: '1 fatia' })} meal="breakfast" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(grams()).toBe('30')
    fireEvent.click(screen.getByRole('button', { name: '100 g' }))
    fireEvent.click(screen.getByRole('button', { name: '1 fatia (30 g)' }))
    expect(grams()).toBe('30')
  })

  it('adds a new item with the portion totals', () => {
    render(<PortionSheet item={itemOf()} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: '150 g' }))
    fireEvent.click(save())
    expect(addLog).toHaveBeenCalledWith({
      day: '2026-10-06', meal: 'lunch', name: 'Arroz', brand: null, source: 'taco', source_id: 'taco-1',
      grams: 150, kcal: 192, protein_g: 3.8, carbs_g: 42, fat_g: 0.3, fiber_g: null
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('refuses a portion of zero or over 5000 g', () => {
    render(<PortionSheet item={itemOf()} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByLabelText('Grams'), { target: { value: '0' } })
    expect(save().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Grams'), { target: { value: '5001' } })
    expect(save().disabled).toBe(true)
    expect(screen.getByText('Use between 1 and 5000 g.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Grams'), { target: { value: '0,5' } })
    expect(save().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Grams'), { target: { value: '1' } })
    expect(save().disabled).toBe(false)
  })

  it('names the shortcut of a recent food after the last amount used', () => {
    render(<PortionSheet item={itemOf({ serving_g: 120, recent: true })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(grams()).toBe('120')
    expect(screen.queryByRole('button', { name: /Label serving/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '100 g' }))
    fireEvent.click(screen.getByRole('button', { name: 'Last time (120 g)' }))
    expect(grams()).toBe('120')
  })

  it('tells the caller when the portion was added', () => {
    const onSaved = vi.fn()
    render(<PortionSheet item={itemOf()} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} onSaved={onSaved} />)
    fireEvent.click(save())
    expect(onSaved).toHaveBeenCalled()
  })

  it('stars the food through toggleFavorite and shows it as a favorite', () => {
    const item = itemOf()
    const { rerender } = render(<PortionSheet item={item} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }))
    expect(toggleFavorite).toHaveBeenCalledWith(item)
    useNutrition.setState({ foods: [foodOf({ favorite: true })] })
    rerender(<PortionSheet item={item} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('button', { name: 'Remove from favorites' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('edits an existing item through updateLog', () => {
    const log = logOf({ id: 'x', grams: 150 })
    render(<PortionSheet item={itemOf()} log={log} meal="lunch" day={log.day} open onOpenChange={onOpenChange} />)
    expect(grams()).toBe('150')
    fireEvent.click(screen.getByRole('button', { name: '100 g' }))
    fireEvent.click(save())
    expect(updateLog).toHaveBeenCalledWith('x', { grams: 100, kcal: 128, protein_g: 2.5, carbs_g: 28, fat_g: 0.2, fiber_g: null })
    expect(addLog).not.toHaveBeenCalled()
  })
})
