// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import CustomFoodSheet from './CustomFoodSheet'
import { useNutrition } from './useNutrition'
import { ME, foodOf } from './test-nutrition'

const real = useNutrition.getState()
const saved = foodOf({ source: 'custom', source_id: null, name: 'Granola da casa' })
const saveFood = vi.fn(() => saved), onOpenChange = vi.fn(), onSaved = vi.fn()
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => screen.getByRole('button', { name: 'Save food' }) as HTMLButtonElement

beforeEach(() => {
  ;[saveFood, onOpenChange, onSaved].forEach(f => f.mockClear())
  useNutrition.setState({ userId: ME, saveFood })
})
afterEach(() => { cleanup(); useNutrition.setState(real) })

const fillBasics = () => {
  type('Name', 'Granola da casa')
  type('Calories (kcal)', '420')
  type('Protein (g)', '12')
  type('Carbs (g)', '60')
  type('Fat (g)', '14')
}

describe('CustomFoodSheet', () => {
  it('saves a food per 100 g and hands it back', () => {
    render(<CustomFoodSheet open onOpenChange={onOpenChange} onSaved={onSaved} />)
    expect(save().disabled).toBe(true)
    fillBasics()
    type('Brand', 'Caseira')
    type('Serving (g)', '40')
    type('Serving name', '1 xícara')
    fireEvent.click(save())
    expect(saveFood).toHaveBeenCalledWith({
      source: 'custom', source_id: null, name: 'Granola da casa', brand: 'Caseira', favorite: false, barcode: null,
      per100: { kcal: 420, protein: 12, carbs: 60, fat: 14, fiber: null }, serving_g: 40, serving_label: '1 xícara'
    })
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the values inside what 100 g can hold', () => {
    render(<CustomFoodSheet open onOpenChange={onOpenChange} onSaved={onSaved} />)
    fillBasics()
    type('Calories (kcal)', '901')
    expect(screen.getByText('Up to 900 kcal per 100 g.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    type('Calories (kcal)', '900')
    type('Protein (g)', '101')
    expect(screen.getByText('Up to 100 g per 100 g.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    type('Protein (g)', '100')
    expect(save().disabled).toBe(false)
  })

  it('takes an optional barcode of 8 to 14 digits, filled in when given', () => {
    const { unmount } = render(<CustomFoodSheet open onOpenChange={onOpenChange} onSaved={onSaved} />)
    fillBasics()
    type('Barcode', '1234567')
    expect(screen.getByText('Barcodes have 8 to 14 digits.')).toBeTruthy()
    expect(save().disabled).toBe(true)
    type('Barcode', '')
    expect(save().disabled).toBe(false)
    unmount()
    render(<CustomFoodSheet barcode="7891000100103" open onOpenChange={onOpenChange} onSaved={onSaved} />)
    expect((screen.getByLabelText('Barcode') as HTMLInputElement).value).toBe('7891000100103')
    fillBasics()
    fireEvent.click(save())
    expect(saveFood).toHaveBeenCalledWith(expect.objectContaining({ barcode: '7891000100103', brand: null, serving_g: null, serving_label: null }))
  })
})
