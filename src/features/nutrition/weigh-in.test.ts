// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const profile = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/features/profile/useProfile', () => ({ useProfile: { getState: () => profile.state } }))
const nut = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('./useNutrition', () => ({ useNutrition: { getState: () => nut.state } }))

import { onWeighIn } from './weigh-in'
import { computeTarget } from './targets'
import { targetOf } from './test-nutrition'

const base = {
  birth_date: '1995-03-10', sex: 'male', height_cm: 180, weight_kg: 80, goal: 'hypertrophy',
  activity_level: 'moderate', nutrition_pace: 'standard', nutrition_enabled: true
}
const save = vi.fn(), setTarget = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0))
  save.mockReset().mockImplementation(async (p: object) => ({ ...(profile.state.profile as object), ...p }))
  setTarget.mockReset().mockResolvedValue(undefined)
  profile.state = { profile: base, save }
  nut.state = { setTarget, targets: [targetOf({ mode: 'auto' })], targetOn: () => targetOf({ mode: 'auto' }) }
})
afterEach(() => vi.useRealTimers())

describe('onWeighIn', () => {
  it('converts lb and saves the profile weight', async () => {
    await onWeighIn(176.4, 'lb')
    expect(save).toHaveBeenCalledWith({ weight_kg: 80 })
    await onWeighIn(81.26, 'kg')
    expect(save).toHaveBeenLastCalledWith({ weight_kg: 81.3 })
  })

  it("writes tomorrow's automatic target when the pillar is on", async () => {
    await onWeighIn(85, 'kg')
    const want = computeTarget({ birth_date: base.birth_date, sex: 'male', height_cm: 180, weight_kg: 85, goal: 'hypertrophy', activity_level: 'moderate', pace: 'standard' }, '2026-10-05')
    expect(setTarget).toHaveBeenCalledWith({ kcal: want.kcal, protein_g: want.protein_g, carbs_g: want.carbs_g, fat_g: want.fat_g, mode: 'auto' }, '2026-10-06')
  })

  it('leaves a manual target alone', async () => {
    nut.state = { setTarget, targets: [targetOf({ mode: 'manual' })], targetOn: () => targetOf({ mode: 'manual' }) }
    await onWeighIn(85, 'kg')
    expect(save).toHaveBeenCalled()
    expect(setTarget).not.toHaveBeenCalled()
  })

  it('does nothing about targets when the pillar is off or the profile is incomplete', async () => {
    profile.state = { profile: { ...base, nutrition_enabled: false }, save }
    await onWeighIn(85, 'kg')
    profile.state = { profile: { ...base, goal: null }, save }
    await onWeighIn(85, 'kg')
    expect(setTarget).not.toHaveBeenCalled()
  })

  it('never throws when the profile cannot be saved', async () => {
    save.mockRejectedValue(new Error('offline'))
    await expect(onWeighIn(85, 'kg')).resolves.toBeUndefined()
    expect(setTarget).not.toHaveBeenCalled()
  })
})
