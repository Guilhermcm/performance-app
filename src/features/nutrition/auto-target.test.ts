// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const nut = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('./useNutrition', () => ({ useNutrition: { getState: () => nut.state } }))

import { refreshAutoTarget } from './auto-target'
import { computeTarget } from './targets'
import { targetOf } from './test-nutrition'
import type { Profile } from '../profile/types'

const base = {
  birth_date: '1995-03-10', sex: 'male', height_cm: 180, weight_kg: 80, goal: 'hypertrophy',
  activity_level: 'moderate', nutrition_pace: 'standard', nutrition_enabled: true, timezone: 'America/Sao_Paulo'
}
const profileOf = (over: Record<string, unknown> = {}) => ({ ...base, ...over }) as unknown as Profile
const setTarget = vi.fn()
const ahead = (t: ReturnType<typeof targetOf> | null) => { nut.state = { setTarget, targetOn: () => t } }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T15:00:00Z'))
  setTarget.mockReset().mockResolvedValue(undefined)
  ahead(targetOf({ mode: 'auto' }))
})
afterEach(() => vi.useRealTimers())

describe('refreshAutoTarget', () => {
  it('writes a recalculated automatic target from tomorrow after a profile change', async () => {
    await expect(refreshAutoTarget(profileOf({ goal: 'fat_loss' }))).resolves.toBe(true)
    const want = computeTarget({ birth_date: base.birth_date, sex: 'male', height_cm: 180, weight_kg: 80, goal: 'fat_loss', activity_level: 'moderate', pace: 'standard' }, '2026-10-05')
    expect(setTarget).toHaveBeenCalledWith({ kcal: want.kcal, protein_g: want.protein_g, carbs_g: want.carbs_g, fat_g: want.fat_g, mode: 'auto' }, '2026-10-06')
  })

  it('does not write when the target would not change', async () => {
    const same = computeTarget({ birth_date: base.birth_date, sex: 'male', height_cm: 180, weight_kg: 80, goal: 'hypertrophy', activity_level: 'moderate', pace: 'standard' }, '2026-10-05')
    ahead(targetOf({ mode: 'auto', kcal: same.kcal, protein_g: same.protein_g, carbs_g: same.carbs_g, fat_g: same.fat_g }))
    await expect(refreshAutoTarget(profileOf())).resolves.toBe(false)
    expect(setTarget).not.toHaveBeenCalled()
  })

  it('leaves manual targets, a pillar that is off and an incomplete profile alone', async () => {
    ahead(targetOf({ mode: 'manual' }))
    await refreshAutoTarget(profileOf({ goal: 'fat_loss' }))
    ahead(null)
    await refreshAutoTarget(profileOf({ goal: 'fat_loss' }))
    ahead(targetOf({ mode: 'auto' }))
    await refreshAutoTarget(profileOf({ nutrition_enabled: false, goal: 'fat_loss' }))
    await refreshAutoTarget(profileOf({ sex: null }))
    expect(setTarget).not.toHaveBeenCalled()
  })

  it('never throws when the target cannot be saved', async () => {
    setTarget.mockRejectedValue(new Error('offline'))
    await expect(refreshAutoTarget(profileOf({ goal: 'fat_loss' }))).resolves.toBe(false)
  })
})
