// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }), fetchLogs: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), fetchLogs: h.fetchLogs }))
vi.mock('./outbox', () => ({ enqueue: vi.fn(), flushOutbox: vi.fn(async () => ({ sent: 0, dropped: 0, reasons: [] })), pending: () => [], clearOutbox: vi.fn() }))

import CopyFromSheet from './CopyFromSheet'
import { useNutrition } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { ME, logOf } from './test-nutrition'

// 2026-10-06 15:00 UTC is noon in Sao Paulo.
const TODAY = '2026-10-06'
const real = useNutrition.getState()
const onOpenChange = vi.fn()
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const rows = () => within(screen.getByRole('list')).getAllByRole('button')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  onOpenChange.mockReset(); h.toast.mockReset()
  h.fetchLogs.mockReset().mockResolvedValue([])
  setOnline(true)
  useProfile.setState({ status: 'ready', profile: { timezone: 'America/Sao_Paulo', nutrition_enabled: true } as never })
  useNutrition.setState({
    ...real, userId: ME, status: 'ready', foods: [],
    logs: {
      [TODAY]: [logOf({ id: 't1', day: TODAY, meal: 'lunch', name: 'Feijão', kcal: 140 })],
      '2026-10-05': [
        logOf({ id: 'y1', day: '2026-10-05', meal: 'breakfast', name: 'Pão', kcal: 250 }),
        logOf({ id: 'y2', day: '2026-10-05', meal: 'breakfast', name: 'Café', kcal: 10 }),
        logOf({ id: 'y3', day: '2026-10-05', meal: 'dinner', name: 'Sopa', kcal: 300 })
      ],
      '2026-10-01': [logOf({ id: 'o1', day: '2026-10-01', meal: 'lunch', name: 'Arroz', kcal: 190 })],
      // More than 30 days back: not offered.
      '2026-09-01': [logOf({ id: 'x1', day: '2026-09-01', meal: 'breakfast', name: 'Bolo', kcal: 400 })]
    }
  })
})
afterEach(() => { cleanup(); setOnline(true); vi.useRealTimers(); useNutrition.setState(real); useProfile.setState({ profile: null }) })

describe('CopyFromSheet', () => {
  it('lists the days of the last 30 with that meal, newest first, with the items and total', () => {
    render(<CopyFromSheet day={TODAY} meal="breakfast" open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('heading', { name: 'Copy to Breakfast' })).toBeTruthy()
    const list = rows()
    expect(list).toHaveLength(1)
    expect(list[0].textContent).toContain('Yesterday')
    expect(list[0].textContent).toContain('2 items')
    expect(list[0].textContent).toContain('260 kcal')
  })

  it('copies the meal into the current one and closes with a toast', () => {
    render(<CopyFromSheet day={TODAY} meal="breakfast" open onOpenChange={onOpenChange} />)
    fireEvent.click(rows()[0])
    const today = useNutrition.getState().logs[TODAY]
    expect(today.filter(l => l.meal === 'breakfast').map(l => l.name)).toEqual(['Pão', 'Café'])
    expect(h.toast).toHaveBeenCalledWith('2 items copied')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('copies a whole day, every meal in its place', () => {
    render(<CopyFromSheet day={TODAY} meal="all" open onOpenChange={onOpenChange} />)
    expect(screen.getByRole('heading', { name: 'Copy a whole day' })).toBeTruthy()
    const list = rows()
    expect(list).toHaveLength(2)
    expect(list[0].textContent).toContain('3 items')
    expect(list[0].textContent).toContain('560 kcal')
    expect(list[1].textContent).toContain('1 item')
    fireEvent.click(list[0])
    const today = useNutrition.getState().logs[TODAY]
    expect(today.map(l => `${l.meal}:${l.name}`)).toEqual(['lunch:Feijão', 'breakfast:Pão', 'breakfast:Café', 'dinner:Sopa'])
    expect(h.toast).toHaveBeenCalledWith('3 items copied')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says when there is nothing to copy', () => {
    render(<CopyFromSheet day={TODAY} meal="snack" open onOpenChange={onOpenChange} />)
    expect(screen.getByText('Nothing to copy from the last 30 days.')).toBeTruthy()
  })

  it('fetches the older days of the last 30 when online and copies from them', async () => {
    // 20 days before 2026-10-06: only the server has it, the phone keeps two weeks.
    const OLD = '2026-09-16'
    h.fetchLogs.mockResolvedValue([
      logOf({ id: 'r1', day: OLD, meal: 'breakfast', name: 'Tapioca', source: 'custom', source_id: null, grams: 80, kcal: 210, protein_g: 1, carbs_g: 50, fat_g: 0.5, fiber_g: 0.3 })
    ])
    render(<CopyFromSheet day={TODAY} meal="breakfast" open onOpenChange={onOpenChange} />)
    expect(h.fetchLogs).toHaveBeenCalledWith('2026-09-06', '2026-09-21')
    await waitFor(() => expect(rows()).toHaveLength(2))
    const list = rows()
    expect(list[0].textContent).toContain('Yesterday')
    expect(list[1].textContent).toContain('1 item')
    expect(list[1].textContent).toContain('210 kcal')
    fireEvent.click(list[1])
    const copied = useNutrition.getState().logs[TODAY].find(l => l.name === 'Tapioca')!
    expect(copied).toMatchObject({ day: TODAY, meal: 'breakfast', source: 'custom', grams: 80, kcal: 210, protein_g: 1, carbs_g: 50, fat_g: 0.5, fiber_g: 0.3 })
    expect(copied.id).not.toBe('r1')
    expect(h.toast).toHaveBeenCalledWith('1 item copied')
  })

  it('lists only the days on the phone when offline, and says why', () => {
    setOnline(false)
    render(<CopyFromSheet day={TODAY} meal="breakfast" open onOpenChange={onOpenChange} />)
    expect(h.fetchLogs).not.toHaveBeenCalled()
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('Days older than two weeks need a connection.')).toBeTruthy()
  })
})
