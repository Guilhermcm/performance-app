// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ fetchLogs: vi.fn() }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), fetchLogs: h.fetchLogs }))
vi.mock('./outbox', () => ({ enqueue: vi.fn(), flushOutbox: vi.fn(async () => ({ sent: 0, dropped: 0, reasons: [] })), pending: () => [], clearOutbox: vi.fn() }))

import DaySheet from './DaySheet'
import { useNutrition } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { ME, logOf, targetOf } from './test-nutrition'
import type { MonthCell } from './history'
import type { NutritionDay } from './types'

// 2026-10-06 15:00 UTC is noon in Sao Paulo.
const TODAY = '2026-10-06'
const OLD = '2026-09-03' // a Thursday, more than 14 days back
const RECENT = '2026-10-01'
const realNutrition = useNutrition.getState()
const onOpenChange = vi.fn()

const dayOf = (day: string, over: Partial<NutritionDay> = {}): NutritionDay => ({
  day, kcal: 2300, protein_g: 150, carbs_g: 260, fat_g: 70, meals: 2,
  target: { kcal: 2400, protein_g: 160, carbs_g: 270, fat_g: 70 },
  logged: true, on_target: true, balanced: false, imported: false, xp: 40, ...over
})
const cellOf = (day: string, over: Partial<MonthCell> = {}): MonthCell =>
  ({ day, inMonth: true, state: 'on_target', future: false, data: dayOf(day), ...over })
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  setOnline(true)
  onOpenChange.mockReset()
  h.fetchLogs.mockReset().mockResolvedValue([
    logOf({ id: 'o1', day: OLD, meal: 'breakfast', name: 'Pão', kcal: 250 }),
    logOf({ id: 'o2', day: OLD, meal: 'dinner', name: 'Sopa', kcal: 300 })
  ])
  useProfile.setState({ status: 'ready', profile: { id: ME, timezone: 'America/Sao_Paulo', nutrition_enabled: true } as never })
  useNutrition.setState({
    ...realNutrition, userId: ME, status: 'ready', targets: [targetOf({ valid_from: '2026-09-01' })],
    logs: {
      [RECENT]: [logOf({ id: 'r1', day: RECENT, meal: 'lunch', name: 'Feijão', kcal: 140 })],
      [TODAY]: [logOf({ id: 't1', day: TODAY, meal: 'breakfast', name: 'Ovo', kcal: 300, protein_g: 25 })]
    }
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); setOnline(true); useNutrition.setState(realNutrition); useProfile.setState({ profile: null }) })

describe('DaySheet', () => {
  it('shows the day against its target, its class and XP, and fetches the items of an older day', async () => {
    render(<DaySheet cell={cellOf(OLD)} open onOpenChange={onOpenChange} />)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { name: /Thursday/ })).toBeTruthy()
    expect(within(sheet).getByText('On target')).toBeTruthy()
    expect(within(sheet).getByText('+40 XP')).toBeTruthy()
    expect(within(sheet).getByText('Calories').nextElementSibling?.textContent).toBe('2,300 / 2,400 kcal')
    expect(within(sheet).getByText('Protein').nextElementSibling?.textContent).toBe('150 / 160 g')
    expect(within(sheet).getByText('Fat').nextElementSibling?.textContent).toBe('70 / 70 g')
    expect(await within(sheet).findByText('Pão')).toBeTruthy()
    expect(h.fetchLogs).toHaveBeenCalledWith(OLD, OLD)
    // Per meal, read only.
    expect(within(sheet).getByRole('heading', { name: 'Breakfast' })).toBeTruthy()
    expect(within(sheet).getByRole('heading', { name: 'Dinner' })).toBeTruthy()
    expect(within(sheet).queryByRole('heading', { name: 'Lunch' })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('offline, keeps the summary of an older day and says its items need a connection', () => {
    setOnline(false)
    render(<DaySheet cell={cellOf(OLD, { state: 'logged', data: dayOf(OLD, { on_target: false, balanced: false }) })} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('Logged')).toBeTruthy()
    expect(screen.getByText("This day's items need a connection.")).toBeTruthy()
    expect(h.fetchLogs).not.toHaveBeenCalled()
  })

  it('reads a day of the last two weeks from the phone, offline too', () => {
    setOnline(false)
    render(<DaySheet cell={cellOf(RECENT, { data: dayOf(RECENT, { balanced: true }) })} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('Balanced macros')).toBeTruthy()
    expect(screen.getByText('Feijão')).toBeTruthy()
    expect(screen.queryByText("This day's items need a connection.")).toBeNull()
    expect(h.fetchLogs).not.toHaveBeenCalled()
  })

  it('shows an open day from the phone, with no XP yet', () => {
    render(<DaySheet cell={cellOf(TODAY, { state: 'open', data: null })} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('Still open')).toBeTruthy()
    expect(screen.getByText('Calories').nextElementSibling?.textContent).toBe('300 / 2,400 kcal')
    expect(screen.getByText('Ovo')).toBeTruthy()
    expect(screen.queryByText(/XP/)).toBeNull()
  })

  it('says when the items could not be fetched and tries again', async () => {
    h.fetchLogs.mockRejectedValueOnce(new Error('boom'))
    render(<DaySheet cell={cellOf(OLD)} open onOpenChange={onOpenChange} />)
    expect(await screen.findByText("Could not load this day's items.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Sopa')).toBeTruthy()
    expect(h.fetchLogs).toHaveBeenCalledTimes(2)
  })

  it('says when nothing was logged that day', async () => {
    h.fetchLogs.mockResolvedValue([])
    render(<DaySheet cell={cellOf(OLD, { state: 'none', data: dayOf(OLD, { logged: false, on_target: false, kcal: 0, meals: 0 }) })} open onOpenChange={onOpenChange} />)
    expect(await screen.findByText('Nothing logged on this day.')).toBeTruthy()
    expect(screen.getByText('Not enough logged')).toBeTruthy()
  })
})
