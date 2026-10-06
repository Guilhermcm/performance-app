// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { clearNutritionLocal } from './sign-out'

describe('clearNutritionLocal', () => {
  beforeEach(() => localStorage.clear())

  it('forgets the outbox, the day already told and the dismissed invite', () => {
    for (const k of ['perf_food_outbox_v1', 'perf_nutrition_seen_v1', 'perf_nutrition_invite_dismissed_v1', 'perf_other']) localStorage.setItem(k, '1')
    clearNutritionLocal()
    expect(localStorage.getItem('perf_food_outbox_v1')).toBeNull()
    expect(localStorage.getItem('perf_nutrition_seen_v1')).toBeNull()
    expect(localStorage.getItem('perf_nutrition_invite_dismissed_v1')).toBeNull()
    expect(localStorage.getItem('perf_other')).toBe('1')
  })
})
