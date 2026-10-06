// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  searchOff: vi.fn(),
  productByCode: vi.fn(),
  taco: [] as unknown[]
}))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./outbox', () => ({ enqueue: vi.fn(), flushOutbox: vi.fn(async () => ({ sent: 0, dropped: 0, reasons: [] })), pending: () => [], clearOutbox: vi.fn() }))
vi.mock('./off-api', () => ({ searchOff: h.searchOff, productByCode: h.productByCode }))
vi.mock('./taco', () => ({ loadTaco: async () => h.taco }))

import FoodSearchSheet from './FoodSearchSheet'
import { useNutrition } from './useNutrition'
import { ME, foodOf, itemOf, logOf } from './test-nutrition'

const DAY = '2026-10-06'
const real = useNutrition.getState()
const onOpenChange = vi.fn()
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const search = (q: string) => fireEvent.change(screen.getByRole('searchbox', { name: 'Search foods' }), { target: { value: q } })
const sectionTitles = () => screen.getAllByRole('heading', { level: 3 }).map(e => e.textContent)
// Lets the TACO import and the mocked Open Food Facts promise settle.
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const open = async () => {
  render(<FoodSearchSheet day={DAY} meal="lunch" open onOpenChange={onOpenChange} />)
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setOnline(true)
  // No camera here: the scanner goes straight to its message and "Type code".
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  onOpenChange.mockReset(); h.toast.mockReset(); h.searchOff.mockReset(); h.productByCode.mockReset()
  h.searchOff.mockResolvedValue({ items: [] })
  h.taco = [itemOf({ source: 'taco', source_id: 'taco-9', name: 'Arroz integral cozido', per100: { kcal: 124, protein: 2.6, carbs: 25.8, fat: 1 } })]
  useNutrition.setState({
    ...real, userId: ME, status: 'ready',
    foods: [
      foodOf({ source: 'off', source_id: '789', name: 'Arroz parboilizado Tio', brand: 'Tio', favorite: true }),
      foodOf({ source: 'custom', source_id: null, name: 'Arroz da vó', favorite: false })
    ],
    logs: { '2026-10-05': [logOf({ name: 'Arroz branco', source: 'taco', source_id: 'taco-1', grams: 100, kcal: 128 })] }
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); setOnline(true); useNutrition.setState(real) })

describe('FoodSearchSheet', () => {
  it('lists the sections in order, each with its title, and credits TACO', async () => {
    await open()
    search('arroz')
    expect(sectionTitles()).toEqual(['Recent', 'Favorites', 'My foods', 'Food table', 'Packaged foods'])
    expect(screen.getByText('Arroz branco')).toBeTruthy()
    expect(screen.getByText('Arroz parboilizado Tio')).toBeTruthy()
    expect(screen.getByText('Arroz da vó')).toBeTruthy()
    expect(screen.getByText('Arroz integral cozido')).toBeTruthy()
    expect(screen.getByText('Source: TACO, NEPA/Unicamp')).toBeTruthy()
  })

  it('leaves the TACO section out while the table is empty', async () => {
    h.taco = []
    await open()
    search('arroz')
    expect(sectionTitles()).not.toContain('Food table')
    expect(screen.queryByText(/^Source: TACO/)).toBeNull()
  })

  it('shows recents and favourites before anything is typed', async () => {
    await open()
    expect(sectionTitles()).toEqual(['Recent', 'Favorites'])
  })

  it('searches Open Food Facts only from 3 letters and after 600 ms without typing', async () => {
    h.searchOff.mockResolvedValue({ items: [itemOf({ source: 'off', source_id: '7891', name: 'Arroz Camil', brand: 'Camil' })] })
    await open()
    search('ar')
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(h.searchOff).not.toHaveBeenCalled()

    search('arr')
    await act(async () => { vi.advanceTimersByTime(300) })
    search('arro')
    await act(async () => { vi.advanceTimersByTime(599) })
    expect(h.searchOff).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    await settle()
    expect(h.searchOff).toHaveBeenCalledTimes(1)
    expect(h.searchOff.mock.calls[0][0]).toBe('arro')

    expect(sectionTitles().at(-1)).toBe('Packaged foods')
    expect(screen.getByText('Data: Open Food Facts')).toBeTruthy()
    expect(screen.getByText('Arroz Camil')).toBeTruthy()
  })

  it('keeps the local results when Open Food Facts says too many requests', async () => {
    h.searchOff.mockResolvedValue({ error: 'rate_limited' })
    await open()
    search('arroz')
    await act(async () => { vi.advanceTimersByTime(600) })
    await settle()
    expect(screen.getByText('Online search is unavailable right now. Try again in a moment.')).toBeTruthy()
    expect(screen.getByText('Arroz branco')).toBeTruthy()
    expect(screen.getByText('Arroz integral cozido')).toBeTruthy()
  })

  it('says online search needs a connection when offline, without calling it', async () => {
    setOnline(false)
    await open()
    search('arroz')
    await act(async () => { vi.advanceTimersByTime(600) })
    await settle()
    expect(screen.getByText('Online search is unavailable without a connection.')).toBeTruthy()
    expect(h.searchOff).not.toHaveBeenCalled()
    expect(screen.getByText('Arroz branco')).toBeTruthy()
  })

  it('opens the portion when an item is tapped', async () => {
    await open()
    search('arroz')
    fireEvent.click(screen.getByRole('button', { name: /^Arroz integral cozido/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('heading', { name: 'Arroz integral cozido' })).toBeTruthy()
    expect(screen.getByLabelText('Grams')).toBeTruthy()
  })

  it('has quick add and create food in the footer', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    expect(screen.getByRole('heading', { name: 'Quick add' })).toBeTruthy()
    cleanup()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Create food' }))
    expect(screen.getByRole('heading', { name: 'Create food' })).toBeTruthy()
  })

  it('opens create food with the code filled in when a barcode is not found', async () => {
    h.productByCode.mockResolvedValue(null)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Type code' }))
    fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '7891000100103' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    await settle()
    expect(h.productByCode).toHaveBeenCalledWith('7891000100103')
    const dialog = screen.getByRole('heading', { name: 'Create food' }).closest('[role=dialog]') as HTMLElement
    expect((within(dialog).getByLabelText('Barcode') as HTMLInputElement).value).toBe('7891000100103')
    expect(h.toast).toHaveBeenCalledWith('Barcode not found. Create the food with it.')
  })

  it('opens the portion for a barcode found among the own foods', async () => {
    useNutrition.setState({ foods: [foodOf({ source: 'custom', source_id: null, name: 'Whey da loja', barcode: '7891000100103' })] })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Scan barcode' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Type code' }))
    fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: '7891000100103' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    await settle()
    expect(screen.getByRole('heading', { name: 'Whey da loja' })).toBeTruthy()
    expect(h.productByCode).not.toHaveBeenCalled()
  })
})
