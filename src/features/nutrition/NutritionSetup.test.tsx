// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: vi.fn(), fetchTargets: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), fetchTargets: h.fetchTargets }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import NutritionSetup from './NutritionSetup'
import { useNutrition } from './useNutrition'
import { useProfile } from '../profile/useProfile'
import { targetOf } from './test-nutrition'
import type { Profile } from '../profile/types'

// The example of spec 3.2: man, 30 on 2026-10-06, 80 kg, 178 cm, moderate, muscle gain, standard.
const BASE = {
  id: 'u1', display_name: 'Ana', timezone: 'America/Sao_Paulo', unit: 'kg', birth_date: '1996-10-06', sex: 'male',
  height_cm: 178, weight_kg: 80, goal: 'hypertrophy', activity_level: null, nutrition_pace: 'standard',
  nutrition_enabled: false, nutrition_days_per_week: 5
}
const realProfile = useProfile.getState()
const realNutrition = useNutrition.getState()
const save = vi.fn(), setTarget = vi.fn(), onOpenChange = vi.fn()

const withProfile = (over: Record<string, unknown> = {}) => {
  const profile = { ...BASE, ...over } as unknown as Profile
  useProfile.setState({ status: 'ready', profile, save })
  return profile
}
const show = () => render(<NutritionSetup open onOpenChange={onOpenChange} />)
const choose = (name: string | RegExp) => fireEvent.click(screen.getByRole('radio', { name }))
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T15:00:00Z'))
  ;[save, setTarget, onOpenChange, h.toast, h.fetchTargets].forEach(f => f.mockReset())
  save.mockImplementation(async (patch: object) => ({ ...useProfile.getState().profile, ...patch }))
  setTarget.mockResolvedValue(undefined)
  useNutrition.setState({ setTarget, targets: [], status: 'ready' })
})
afterEach(() => { cleanup(); vi.useRealTimers(); useProfile.setState(realProfile); useNutrition.setState(realNutrition) })

describe('NutritionSetup', () => {
  it('asks for the goal first when the profile has none', () => {
    withProfile({ goal: null })
    show()
    expect(screen.getByText('Main goal')).toBeTruthy()
    // Only what is missing: the body data is already there.
    expect(screen.queryByLabelText('Height (cm)')).toBeNull()
    expect(button('Next').disabled).toBe(true)
    choose('Fat loss')
    next()
    expect(screen.getByRole('radio', { name: /Sedentary/ })).toBeTruthy()
  })

  it('asks for the body data that is missing, in the profile unit', async () => {
    withProfile({ weight_kg: null, birth_date: null, unit: 'lb' })
    show()
    fireEvent.change(screen.getByLabelText('Weight (lb)'), { target: { value: '176.4' } })
    fireEvent.change(screen.getByLabelText('Birth date'), { target: { value: '1996-10-06' } })
    next()
    choose(/Moderately active/)
    next()
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ weight_kg: 80, birth_date: '1996-10-06', nutrition_enabled: true })))
  })

  it('lists the five activity levels with their descriptions and asks the pace only when it changes the target', () => {
    withProfile()
    show()
    for (const name of ['Sedentary', 'Lightly active', 'Moderately active', 'Active', 'Very active']) {
      expect(screen.getByRole('radio', { name: new RegExp('^' + name) })).toBeTruthy()
    }
    expect(screen.getByText('Desk job, little movement outside training')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Gentle/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeTruthy()
    cleanup()
    withProfile({ goal: 'strength' })
    show()
    expect(screen.queryByRole('radio', { name: /Gentle/ })).toBeNull()
  })

  it('shows the sum in one line, then turns the pillar on with a target from today', async () => {
    withProfile()
    show()
    expect(button('Next').disabled).toBe(true)
    choose(/Moderately active/)
    next()
    expect(screen.getByText('Estimated burn 2,740 kcal, +10% for muscle gain')).toBeTruthy()
    expect(screen.getByText('3,010 kcal')).toBeTruthy()
    expect(screen.getByText('160 g')).toBeTruthy()
    expect(screen.getByText('404 g')).toBeTruthy()
    expect(screen.getByText('84 g')).toBeTruthy()
    // Days on target: 3 to 7, five by default.
    expect(screen.queryByRole('radio', { name: '2' })).toBeNull()
    for (const d of ['3', '4', '5', '6', '7']) expect(screen.getByRole('radio', { name: d })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '5' }).getAttribute('aria-checked')).toBe('true')
    choose('4')
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      nutrition_enabled: true, activity_level: 'moderate', nutrition_pace: 'standard', nutrition_days_per_week: 4
    }))
    expect(setTarget).toHaveBeenCalledWith({ kcal: 3010, protein_g: 160, carbs_g: 404, fat_g: 84, mode: 'auto' }, '2026-10-06')
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(setTarget.mock.invocationCallOrder[0])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('takes a manual target, warns when the macros do not add up and fits the carbs', async () => {
    withProfile({ activity_level: 'moderate' })
    show()
    next()
    fireEvent.click(button('Adjust manually'))
    fireEvent.change(screen.getByLabelText('Protein (g)'), { target: { value: '250' } })
    expect(screen.getByText(/more than 5% off/)).toBeTruthy()
    fireEvent.click(button('Adjust carbs'))
    expect(screen.queryByText(/more than 5% off/)).toBeNull()
    // (3010 − 4·250 − 9·84) / 4 = 313.5
    expect((screen.getByLabelText('Carbs (g)') as HTMLInputElement).value).toBe('314')
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(setTarget).toHaveBeenCalledWith({ kcal: 3010, protein_g: 250, carbs_g: 314, fat_g: 84, mode: 'manual' }, '2026-10-06'))
  })

  it('does not save a manual value outside the limits', () => {
    withProfile({ activity_level: 'moderate' })
    show()
    next()
    fireEvent.click(button('Adjust manually'))
    fireEvent.change(screen.getByLabelText('Calories (kcal)'), { target: { value: '800' } })
    expect(screen.getByText('Between 1000 and 6000.')).toBeTruthy()
    expect(button('Turn on Nutrition').disabled).toBe(true)
  })

  it('saves an edit for tomorrow once the pillar is on', async () => {
    withProfile({ nutrition_enabled: true, activity_level: 'moderate' })
    useNutrition.setState({ targets: [targetOf({ valid_from: '2026-10-01' })] })
    show()
    choose(/Very active/)
    next()
    fireEvent.click(button('Save'))
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(setTarget.mock.calls[0][1]).toBe('2026-10-07')
    expect(save).toHaveBeenCalledWith(expect.not.objectContaining({ nutrition_enabled: true }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ activity_level: 'very_active' }))
  })

  it('keeps the sheet open and offers a retry when the target is not saved', async () => {
    withProfile({ activity_level: 'moderate' })
    setTarget.mockRejectedValueOnce(new Error('offline'))
    show()
    next()
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(h.toast).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    // The retry still writes the first target for today, though the profile now says the pillar is on.
    useProfile.setState({ profile: { ...useProfile.getState().profile!, nutrition_enabled: true } })
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(2))
    expect(setTarget.mock.calls[1][1]).toBe('2026-10-06')
  })

  it('writes the target for tomorrow when the pillar is turned back on', async () => {
    withProfile({ nutrition_enabled: false, activity_level: 'moderate' })
    // An old row from before the pillar was turned off: not today's, but the person has had a target.
    useNutrition.setState({ targets: [targetOf({ valid_from: '2026-09-01', kcal: 2000 })] })
    show()
    next()
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ nutrition_enabled: true }))
    expect(setTarget).toHaveBeenCalledTimes(1)
    expect(setTarget.mock.calls[0][1]).toBe('2026-10-07')
  })

  // The first target may start today only when the person has no target at all. The button never
  // waits for the diary to load (it used to hang on "Loading your targets"): when the store is not
  // ready, finishing asks the server for the targets.
  it('works while the diary is still loading, asking the server for the targets', async () => {
    withProfile({ activity_level: 'moderate' })
    useNutrition.setState({ status: 'loading', targets: [] })
    h.fetchTargets.mockResolvedValue([targetOf({ valid_from: '2026-09-01', kcal: 2000 })])
    show()
    next()
    expect(screen.queryByRole('button', { name: 'Loading your targets' })).toBeNull()
    expect(button('Turn on Nutrition').disabled).toBe(false)
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(h.fetchTargets).toHaveBeenCalledTimes(1)
    // The server says this is not the first target: it starts tomorrow.
    expect(setTarget.mock.calls[0][1]).toBe('2026-10-07')
  })

  it('starts the first target today when the server has none, whatever the store status', async () => {
    for (const status of ['idle', 'loading', 'error'] as const) {
      withProfile({ activity_level: 'moderate' })
      useNutrition.setState({ status, targets: [] })
      h.fetchTargets.mockResolvedValue([])
      show()
      next()
      fireEvent.click(button('Turn on Nutrition'))
      await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
      expect(setTarget.mock.calls[0][1]).toBe('2026-10-06')
      setTarget.mockClear(); save.mockClear()
      cleanup()
    }
  })

  it('writes nothing and says so when the targets cannot be read', async () => {
    withProfile({ activity_level: 'moderate' })
    useNutrition.setState({ status: 'error', targets: [] })
    h.fetchTargets.mockRejectedValue(new Error('offline'))
    show()
    next()
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Could not save the target. Check your connection and try again.'))
    expect(save).not.toHaveBeenCalled()
    expect(setTarget).not.toHaveBeenCalled()
    expect(button('Turn on Nutrition').disabled).toBe(false)
  })

  it('uses the loaded targets without asking the server again', async () => {
    withProfile({ activity_level: 'moderate' })
    useNutrition.setState({ status: 'ready', targets: [] })
    show()
    next()
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(setTarget).toHaveBeenCalledTimes(1))
    expect(h.fetchTargets).not.toHaveBeenCalled()
  })

  it('does not hold back the earlier steps while the targets load', () => {
    withProfile()
    useNutrition.setState({ status: 'loading' })
    show()
    choose(/Moderately active/)
    expect(button('Next').disabled).toBe(false)
  })

  it('writes nothing when turned back on with the same target already in force', async () => {
    withProfile({ nutrition_enabled: false, activity_level: 'moderate' })
    useNutrition.setState({ targets: [targetOf({ valid_from: '2026-09-01', kcal: 3010, protein_g: 160, carbs_g: 404, fat_g: 84, mode: 'auto' })] })
    show()
    next()
    fireEvent.click(button('Turn on Nutrition'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(setTarget).not.toHaveBeenCalled()
  })
})
