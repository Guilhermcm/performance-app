// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import QuickAddSheet from './QuickAddSheet'
import { useNutrition } from './useNutrition'
import { ME, logOf } from './test-nutrition'

const real = useNutrition.getState()
const addLog = vi.fn(), updateLog = vi.fn(), onOpenChange = vi.fn()
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const add = () => screen.getByRole('button', { name: /^(Add|Save)$/ }) as HTMLButtonElement

beforeEach(() => {
  ;[addLog, updateLog, onOpenChange].forEach(f => f.mockReset())
  useNutrition.setState({ userId: ME, addLog, updateLog })
})
afterEach(() => { cleanup(); useNutrition.setState(real) })

describe('QuickAddSheet', () => {
  it('needs only the calories', () => {
    render(<QuickAddSheet meal="snack" day="2026-10-06" open onOpenChange={onOpenChange} />)
    expect(add().disabled).toBe(true)
    type('Calories (kcal)', '350')
    expect(add().disabled).toBe(false)
    fireEvent.click(add())
    expect(addLog).toHaveBeenCalledWith({
      day: '2026-10-06', meal: 'snack', name: 'Quick add', brand: null, source: 'quick', source_id: null,
      grams: null, kcal: 350, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('takes optional macros and a name, with a comma for decimals', () => {
    render(<QuickAddSheet meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    type('Calories (kcal)', '520')
    type('Protein (g)', '32,5')
    type('Fat (g)', '18')
    type('Name', 'Marmita')
    fireEvent.click(add())
    expect(addLog).toHaveBeenCalledWith(expect.objectContaining({ name: 'Marmita', source: 'quick', kcal: 520, protein_g: 32.5, carbs_g: 0, fat_g: 18 }))
  })

  it('refuses values the diary cannot hold', () => {
    render(<QuickAddSheet meal="lunch" day="2026-10-06" open onOpenChange={onOpenChange} />)
    type('Calories (kcal)', '6000')
    expect(add().disabled).toBe(true)
    expect(screen.getByText('Up to 5000 kcal per item.')).toBeTruthy()
    type('Calories (kcal)', '600')
    type('Carbs (g)', '501')
    expect(add().disabled).toBe(true)
    expect(screen.getByText('Up to 500 g.')).toBeTruthy()
  })

  it('edits a quick item in place', () => {
    const log = logOf({ id: 'q', source: 'quick', source_id: null, grams: null, name: 'Lanche', kcal: 200, protein_g: 0, carbs_g: 0, fat_g: 0 })
    render(<QuickAddSheet meal="snack" day={log.day} log={log} open onOpenChange={onOpenChange} />)
    expect((screen.getByLabelText('Calories (kcal)') as HTMLInputElement).value).toBe('200')
    type('Calories (kcal)', '250')
    fireEvent.click(add())
    expect(updateLog).toHaveBeenCalledWith('q', { name: 'Lanche', kcal: 250, protein_g: 0, carbs_g: 0, fat_g: 0 })
  })
})
