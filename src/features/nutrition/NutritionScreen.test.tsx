// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
// The store's writes go to the outbox; here they only need to land in memory.
// "Copy from" asks the server for days older than the phone keeps.
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), fetchLogs: vi.fn(async () => []) }))
vi.mock('./outbox', () => ({ enqueue: vi.fn(), flushOutbox: vi.fn(async () => ({ sent: 0, dropped: 0, reasons: [] })), pending: () => [], clearOutbox: vi.fn() }))

import NutritionScreen from './NutritionScreen'
import { useNutrition } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { ME, logOf, targetOf } from './test-nutrition'
import type { NutritionDay } from './types'

// 2026-10-06 15:00 UTC is noon in Sao Paulo.
const TODAY = '2026-10-06', YESTERDAY = '2026-10-05'
const realState = useNutrition.getState()
const realProfile = useProfile.getState()
const BODY = { id: 'u1', birth_date: '1996-10-06', sex: 'male', height_cm: 178, weight_kg: 80, goal: 'hypertrophy', activity_level: 'moderate', nutrition_pace: 'standard', nutrition_days_per_week: 5 }

const profile = (over: Record<string, unknown> = {}) =>
  useProfile.setState({ status: 'ready', profile: { timezone: 'America/Sao_Paulo', nutrition_enabled: true, unit: 'kg', ...over } as never })

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  setOnline(true)
  h.nav.mockReset(); h.toast.mockReset()
  profile()
  useNutrition.setState({
    ...realState, userId: ME, status: 'ready', stale: false, droppedNotice: false, droppedReason: null, foods: [], closed: [],
    targets: [targetOf()],
    logs: {
      [TODAY]: [
        logOf({ id: 'a', day: TODAY, meal: 'breakfast', name: 'Ovo', kcal: 300, protein_g: 25, carbs_g: 2, fat_g: 20, grams: 100 }),
        logOf({ id: 'b', day: TODAY, meal: 'lunch', name: 'Arroz', kcal: 190, protein_g: 4, carbs_g: 41, fat_g: 0.4, grams: 150 })
      ],
      [YESTERDAY]: [logOf({ id: 'c', day: YESTERDAY, meal: 'dinner', name: 'Pão', kcal: 250, protein_g: 8, carbs_g: 48, fat_g: 3, grams: 80 })]
    }
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); setOnline(true); useNutrition.setState(realState); useProfile.setState({ ...realProfile, profile: null }) })

describe('NutritionScreen', () => {
  it('invites to turn the pillar on when it is off', () => {
    profile({ nutrition_enabled: false })
    render(<NutritionScreen />)
    expect(screen.queryByTestId('kcal-ring')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Turn on/ }))
    // The setup opens right here, not in the profile.
    expect(h.nav).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('A few details first. Your target is based on them.')).toBeTruthy()
  })

  it('keeps the setup open with a retry when the first target cannot be saved', async () => {
    // useProfile.save is optimistic: the pillar is on before the target is written.
    const save = vi.fn(async (patch: object) => {
      const p = { ...useProfile.getState().profile, ...patch }
      useProfile.setState({ profile: p as never })
      return p
    })
    const setTarget = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    profile({ ...BODY, nutrition_enabled: false, activity_level: null })
    useProfile.setState({ save: save as never })
    useNutrition.setState({ setTarget, targets: [] })
    render(<NutritionScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Nutrition' }))
    let sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('radio', { name: /Moderately active/ }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on Nutrition' }))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save the target. Check your connection and try again.'))
    expect(useProfile.getState().profile?.nutrition_enabled).toBe(true)
    sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on Nutrition' }))
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(2))
    expect(setTarget).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'auto' }), TODAY)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('offers to set a target on a day without one', () => {
    profile(BODY)
    useNutrition.setState({ targets: [] })
    render(<NutritionScreen />)
    expect(screen.getByText('No target for this day yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set target' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your nutrition target' })).toBeTruthy()
  })

  it('shows the kcal ring, three macro bars and the four meals with their totals', () => {
    render(<NutritionScreen />)
    const ring = screen.getByTestId('kcal-ring')
    expect(within(ring).getByText('Eaten').nextSibling?.textContent).toBe('490')
    expect(within(ring).getByText('Goal').nextSibling?.textContent).toBe('2,400')
    expect(within(ring).getByText('Left').nextSibling?.textContent).toBe('1,910')

    expect(screen.getByRole('progressbar', { name: 'Protein' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Carbs' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Fat' })).toBeTruthy()
    expect(screen.getByText('29 / 160 g')).toBeTruthy()
    expect(screen.getByText('43 / 270 g')).toBeTruthy()
    expect(screen.getByText('20.4 / 70 g')).toBeTruthy()

    const meal = (name: string) => screen.getByRole('region', { name })
    const total = (name: string) => within(meal(name)).getByTestId('meal-total').textContent
    expect(['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map(total)).toEqual(['300 kcal', '190 kcal', '0 kcal', '0 kcal'])
    expect(within(meal('Lunch')).getByText('Arroz')).toBeTruthy()
  })

  it('goes over the goal without a negative remainder', () => {
    useNutrition.setState({ targets: [targetOf({ kcal: 400 })] })
    render(<NutritionScreen />)
    const ring = screen.getByTestId('kcal-ring')
    expect(within(ring).getByText('Over').nextSibling?.textContent).toBe('90')
  })

  it('switches between today and yesterday', () => {
    render(<NutritionScreen />)
    expect(screen.getByText('Arroz')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Yesterday' }))
    expect(screen.queryByText('Arroz')).toBeNull()
    expect(screen.getByText('Pão')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }))
    expect(screen.getByText('Arroz')).toBeTruthy()
  })

  it('deletes an item with a toast that brings it back', () => {
    render(<NutritionScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Arroz' }))
    expect(screen.queryByText('Arroz')).toBeNull()
    expect(h.toast).toHaveBeenCalledWith('Arroz removed', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    const undo = h.toast.mock.calls[0][1].action.onClick
    act(() => undo())
    expect(screen.getByText('Arroz')).toBeTruthy()
  })

  it('shows one quiet line when offline and keeps everything usable', () => {
    setOnline(false)
    render(<NutritionScreen />)
    expect(screen.getByText(/^Offline\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Arroz' })).toBeTruthy()
  })

  it('offers to add on an empty meal and the + opens the food search for that meal', () => {
    render(<NutritionScreen />)
    const dinner = screen.getByRole('region', { name: 'Dinner' })
    expect(within(dinner).getByText('Nothing logged yet.')).toBeTruthy()
    fireEvent.click(within(dinner).getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('heading', { name: 'Add to Dinner' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search foods' })).toBeTruthy()
  })

  it('opens "Copy from" for a meal and the whole day copy', () => {
    render(<NutritionScreen />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Dinner' })).getByRole('button', { name: 'Copy from…' }))
    expect(screen.getByRole('heading', { name: 'Copy to Dinner' })).toBeTruthy()
    cleanup()
    render(<NutritionScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy a whole day' }))
    expect(screen.getByRole('heading', { name: 'Copy a whole day' })).toBeTruthy()
  })

  it('repeats an item from yesterday today', () => {
    render(<NutritionScreen />)
    expect(screen.queryByRole('button', { name: /^Repeat .* today$/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Yesterday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repeat Pão today' }))
    expect(h.toast).toHaveBeenCalledWith('Added to today: Pão')
    const copy = useNutrition.getState().logs[TODAY].find(l => l.name === 'Pão')!
    expect(copy).toMatchObject({ day: TODAY, meal: 'dinner', kcal: 250, grams: 80, source: 'taco' })
    expect(copy.id).not.toBe('c')
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }))
    expect(within(screen.getByRole('region', { name: 'Dinner' })).getByText('Pão')).toBeTruthy()
  })

  it('opens the portion to edit an item', () => {
    render(<NutritionScreen />)
    fireEvent.click(screen.getByRole('button', { name: /^Arroz/ }))
    expect((screen.getByLabelText('Grams') as HTMLInputElement).value).toBe('150')
  })

  it('says once why queued items were dropped', () => {
    useNutrition.setState({ droppedNotice: true, droppedReason: 'day_closed' })
    const { rerender } = render(<NutritionScreen />)
    expect(h.toast).toHaveBeenCalledWith('Some items from days that already closed were not saved.')
    expect(useNutrition.getState().droppedNotice).toBe(false)
    rerender(<NutritionScreen />)
    expect(h.toast).toHaveBeenCalledTimes(1)
    h.toast.mockReset()
    act(() => useNutrition.setState({ droppedNotice: true, droppedReason: 'refused' }))
    expect(h.toast).toHaveBeenCalledWith('Some items could not be saved.')
  })

  it('lists earlier days as read-only summaries', () => {
    const day: NutritionDay = {
      day: '2026-10-03', kcal: 2350, protein_g: 170, carbs_g: 260, fat_g: 68, meals: 4,
      target: { kcal: 2400, protein_g: 160, carbs_g: 270, fat_g: 70 }, logged: true, on_target: true, balanced: false, imported: false
    }
    useNutrition.setState({ closed: [day] })
    render(<NutritionScreen />)
    const list = screen.getByRole('region', { name: 'Earlier days' })
    expect(within(list).getByText('Saturday')).toBeTruthy()
    expect(within(list).getByText('On target')).toBeTruthy()
    expect(within(list).getByText('2,350 / 2,400 kcal')).toBeTruthy()
    expect(within(list).queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('uses the profile time zone for today, not the device', () => {
    // 01:00 UTC on the 7th is still the 6th in Sao Paulo but already the 7th in Tokyo.
    vi.setSystemTime(new Date('2026-10-07T01:00:00Z'))
    profile({ timezone: 'Asia/Tokyo' })
    render(<NutritionScreen />)
    // Tokyo's yesterday is the 6th: Arroz is there.
    expect(screen.queryByText('Arroz')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Yesterday' }))
    expect(screen.getByText('Arroz')).toBeTruthy()
  })

  it('shows a skeleton while the first load runs and a retry when it fails', () => {
    const refresh = vi.fn(async () => {})
    useNutrition.setState({ status: 'loading', logs: {} })
    const { unmount } = render(<NutritionScreen />)
    expect(screen.getByLabelText('Loading…')).toBeTruthy()
    unmount()
    useNutrition.setState({ status: 'error', refresh })
    render(<NutritionScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalled()
  })
})
