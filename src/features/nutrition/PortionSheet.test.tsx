// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import PortionSheet from './PortionSheet'
import { useNutrition } from './useNutrition'
import { ME, foodOf, itemOf, logOf, measureOf } from './test-nutrition'

const real = useNutrition.getState()
const addLog = vi.fn(), updateLog = vi.fn(), toggleFavorite = vi.fn()
const addMeasure = vi.fn((m: { food_key: string; label: string; grams: number }) => ({ ...m, id: 'new', updated_at: 'x' }))
const updateMeasure = vi.fn(), removeMeasure = vi.fn()
const onOpenChange = vi.fn()
const grams = () => (screen.getByLabelText('Grams') as HTMLInputElement).value
const save = () => screen.getByRole('button', { name: /^(Add|Save)$/ }) as HTMLButtonElement

beforeEach(() => {
  ;[addLog, updateLog, toggleFavorite, onOpenChange, addMeasure, updateMeasure, removeMeasure].forEach(f => f.mockClear())
  useNutrition.setState({ userId: ME, foods: [], measures: [], addLog, updateLog, toggleFavorite, addMeasure, updateMeasure, removeMeasure })
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

// TACO 3 has POF measures: colher de chá 6.3, colher de sobremesa 12.5, colher de sopa 25,
// colher de servir 45, escumadeira 85, concha 100.
const RICE = { source: 'taco' as const, source_id: '3', per100: { kcal: 128, protein: 2.5, carbs: 28, fat: 0.2 } }
const chipNames = () => within(screen.getByRole('group', { name: 'Portion shortcuts' })).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)
const measureLine = () => screen.queryByTestId('portion-measure')?.textContent ?? null

describe('PortionSheet household measures', () => {
  it('lists personal, suggested, last time and grams in that order, citing the POF', async () => {
    useNutrition.setState({ measures: [measureOf({ id: 'p1', food_key: 'taco:3', label: 'prato', grams: 300 }), measureOf({ food_key: 'taco:4', label: 'outro' })] })
    render(<PortionSheet item={itemOf({ ...RICE, serving_g: 180, recent: true })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(await screen.findByRole('button', { name: 'colher de servir (45 g)' })).toBeTruthy()
    expect(chipNames()).toEqual([
      'prato (300 g)', 'Options for prato',
      'colher de chá (6.3 g)', 'colher de sobremesa (12.5 g)', 'colher de sopa (25 g)', 'colher de servir (45 g)', 'escumadeira (85 g)', 'concha (100 g)',
      'Last time (180 g)', '50 g', '100 g', '150 g', '200 g', 'Create measure',
    ])
    expect(screen.getByText('Measures: POF 2008-2009, IBGE')).toBeTruthy()
  })

  it('cites the POF only when a suggested measure is shown', async () => {
    useNutrition.setState({ measures: [measureOf({ food_key: 'off:789', label: 'pote', grams: 170 })] })
    render(<PortionSheet item={itemOf({ source: 'off', source_id: '789', serving_g: 30, serving_label: '1 porção' })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(chipNames().slice(0, 3)).toEqual(['pote (170 g)', 'Options for pote', '1 porção (30 g)'])
    await act(async () => {})
    expect(screen.queryByText('Measures: POF 2008-2009, IBGE')).toBeNull()
  })

  it('sets 1 × measure on a tap and multiplies it in steps of 0.5', async () => {
    render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(measureLine()).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'colher de servir (45 g)' }))
    expect(screen.getByRole('button', { name: 'colher de servir (45 g)' }).getAttribute('aria-pressed')).toBe('true')
    expect(measureLine()).toBe('1 colher de servir · 45 g')
    expect(grams()).toBe('45')
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    expect(measureLine()).toBe('1.5 colher de servir · 67.5 g')
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    expect(measureLine()).toBe('2 colheres de servir · 90 g')
    expect(grams()).toBe('90')
    expect(screen.getByTestId('portion-kcal').textContent).toBe('115')
    fireEvent.click(save())
    expect(addLog).toHaveBeenCalledWith({
      day: '2026-10-06', meal: 'lunch', name: 'Arroz', brand: null, source: 'taco', source_id: '3',
      grams: 90, kcal: 115.2, protein_g: 2.3, carbs_g: 25.2, fat_g: 0.2, fiber_g: null
    })
  })

  it('keeps the quantity between 0.5 and 20', async () => {
    render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'colher de chá (6.3 g)' }))
    const less = screen.getByRole('button', { name: 'Half a measure less' }) as HTMLButtonElement
    const more = screen.getByRole('button', { name: 'Half a measure more' }) as HTMLButtonElement
    fireEvent.click(less)
    expect(measureLine()).toBe('0.5 colher de chá · 3.2 g')
    expect(less.disabled).toBe(true)
    for (let i = 0; i < 50; i++) fireEvent.click(more)
    expect(measureLine()).toBe('20 colheres de chá · 126 g')
    expect(more.disabled).toBe(true)
  })

  it('goes back to grams with a gram shortcut or a typed amount', async () => {
    render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'concha (100 g)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    expect(grams()).toBe('150')
    fireEvent.click(screen.getByRole('button', { name: '200 g' }))
    expect(measureLine()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Half a measure more' })).toBeNull()
    expect(grams()).toBe('200')
    fireEvent.click(screen.getByRole('button', { name: 'concha (100 g)' }))
    fireEvent.change(screen.getByLabelText('Grams'), { target: { value: '130' } })
    expect(measureLine()).toBeNull()
    expect(screen.getByTestId('portion-kcal').textContent).toBe('166')
  })

  it('multiplies a personal measure and the label serving', () => {
    useNutrition.setState({ measures: [measureOf({ food_key: 'off:789', label: 'pote', grams: 170 })] })
    render(<PortionSheet item={itemOf({ source: 'off', source_id: '789', serving_g: 30, serving_label: '1 porção' })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'pote (170 g)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    expect(measureLine()).toBe('2 × pote · 340 g')
    fireEvent.click(screen.getByRole('button', { name: '1 porção (30 g)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    expect(measureLine()).toBe('1.5 × 1 porção · 45 g')
  })

  it('creates a measure with the current grams and the food key', async () => {
    render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'colher de servir (45 g)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Half a measure more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create measure' }))
    const sheet = screen.getByRole('heading', { name: 'New measure' }).closest('[role="dialog"]') as HTMLElement
    expect((within(sheet).getByLabelText('Grams') as HTMLInputElement).value).toBe('90')
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'prato' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create measure' }))
    expect(addMeasure).toHaveBeenCalledWith({ food_key: 'taco:3', label: 'prato', grams: 90 })
  })

  it('edits and deletes a personal measure from its chip menu', () => {
    useNutrition.setState({ measures: [measureOf({ id: 'p1', food_key: 'taco:3', label: 'prato', grams: 300 })] })
    render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Options for prato' }))
    const sheet = () => screen.getByRole('heading', { name: 'Edit measure' }).closest('[role="dialog"]') as HTMLElement
    expect((within(sheet()).getByLabelText('Name') as HTMLInputElement).value).toBe('prato')
    fireEvent.change(within(sheet()).getByLabelText('Grams'), { target: { value: '250' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save' }))
    expect(updateMeasure).toHaveBeenCalledWith('p1', { label: 'prato', grams: 250 })
    fireEvent.click(screen.getByRole('button', { name: 'Options for prato' }))
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Delete' }))
    expect(removeMeasure).toHaveBeenCalledWith('p1')
  })

  it('opens the same menu on a long press, without picking the measure', () => {
    vi.useFakeTimers()
    try {
      useNutrition.setState({ measures: [measureOf({ id: 'p1', food_key: 'taco:3', label: 'prato', grams: 300 })] })
      render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
      const chip = screen.getByRole('button', { name: 'prato (300 g)' })
      fireEvent.pointerDown(chip)
      act(() => { vi.advanceTimersByTime(600) })
      fireEvent.pointerUp(chip)
      fireEvent.click(chip)
      expect(screen.getByRole('heading', { name: 'Edit measure' })).toBeTruthy()
      expect(measureLine()).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('goes back to grams when the measure in use is deleted', () => {
    useNutrition.setState({ measures: [measureOf({ id: 'p1', food_key: 'taco:3', label: 'prato', grams: 300 })] })
    render(<PortionSheet item={itemOf(RICE)} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'prato (300 g)' }))
    expect(measureLine()).toBe('1 × prato · 300 g')
    act(() => { useNutrition.setState({ measures: [] }) })
    expect(measureLine()).toBeNull()
    expect(grams()).toBe('300')
  })

  it('offers no measure to create without a food key', async () => {
    render(<PortionSheet item={itemOf({ source: 'taco', source_id: null })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Create measure' })).toBeNull()
    cleanup()
    // A custom food that is not among the saved foods has no id to hang a measure on.
    render(<PortionSheet item={itemOf({ source: 'custom', source_id: null, name: 'Bolo da vó' })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(screen.queryByRole('button', { name: 'Create measure' })).toBeNull()
  })

  it('keys a custom food by its saved row, from the food itself or from a recent', () => {
    const saved = foodOf({ id: 'f-9', source: 'custom', source_id: null, name: 'Bolo da vó' })
    useNutrition.setState({ foods: [saved], measures: [measureOf({ food_key: 'custom:f-9', label: 'fatia', grams: 80 })] })
    const { unmount } = render(<PortionSheet item={saved} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('button', { name: 'fatia (80 g)' })).toBeTruthy()
    unmount()
    render(<PortionSheet item={itemOf({ source: 'custom', source_id: null, name: 'Bolo da vó', serving_g: 160, recent: true })} meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('button', { name: 'fatia (80 g)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create measure' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'pedaço' } })
    fireEvent.click(within(screen.getByRole('heading', { name: 'New measure' }).closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'Create measure' }))
    expect(addMeasure).toHaveBeenCalledWith({ food_key: 'custom:f-9', label: 'pedaço', grams: 160 })
  })
})
