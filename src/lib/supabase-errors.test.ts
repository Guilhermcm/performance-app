import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))

import { classify, isRefused, toNutritionError, NutritionError } from './supabase-errors'
import * as nutritionApi from '@/features/nutrition/nutrition-api'

describe('classify', () => {
  it('turns the typed P0001 messages into their code, refused for good', () => {
    for (const code of ['day_closed', 'too_many_items', 'too_many_checkins', 'item_immutable'] as const) {
      const e = classify({ code: 'P0001', message: code })
      expect(e).toBeInstanceOf(NutritionError)
      expect(e).toMatchObject({ code, refused: true, sqlstate: 'P0001', detail: code })
    }
  })

  it('refuses the check-in rules even when the message arrives without a SQLSTATE', () => {
    expect(classify({ message: 'too_many_checkins' })).toMatchObject({ code: 'too_many_checkins', refused: true })
    expect(classify({ message: 'item_immutable' })).toMatchObject({ code: 'item_immutable', refused: true })
    expect(classify({ message: 'day_closed' })).toMatchObject({ code: 'day_closed', refused: true })
  })

  it('keeps the nutrition reasons: day_closed, else a plain refusal', () => {
    expect(classify({ message: 'day_closed' }).reason).toBe('day_closed')
    expect(classify({ message: 'item_immutable' }).reason).toBe('refused')
    expect(classify({ message: 'too_many_measures' })).toMatchObject({ code: 'network', refused: true, reason: 'refused' })
  })

  it('refuses a closed sleep night with its own reason', () => {
    expect(classify({ code: 'P0001', message: 'night_closed' })).toMatchObject({ code: 'night_closed', refused: true, reason: 'night_closed', sqlstate: 'P0001' })
    expect(classify({ message: 'night_closed' })).toMatchObject({ code: 'night_closed', refused: true, reason: 'night_closed' })
    expect(new NutritionError('night_closed').reason).toBe('night_closed')
  })

  it('refuses the habit rules as plain refusals and keeps a closed day as day_closed', () => {
    for (const message of ['habit_archived', 'pillar_off', 'too_many_habits']) {
      expect(classify({ code: 'P0001', message })).toMatchObject({ refused: true, reason: 'refused', detail: message })
    }
    expect(classify({ code: 'P0001', message: 'day_closed' })).toMatchObject({ code: 'day_closed', refused: true, reason: 'day_closed' })
  })

  it('refuses the tracker rules as plain refusals, keeping the code in detail', () => {
    for (const message of ['too_many_trackers', 'option_in_use', 'invalid_options', 'invalid_value', 'future_day', 'tracker_archived', 'tracker_not_found']) {
      expect(classify({ code: 'P0001', message })).toMatchObject({ refused: true, reason: 'refused', detail: message })
    }
  })

  it('refuses check, unique, FK (23xxx) and data exception (22xxx) violations', () => {
    expect(classify({ code: '23514', message: 'check violation' })).toMatchObject({ refused: true, sqlstate: '23514' })
    expect(classify({ code: '23505', message: 'dup' }).refused).toBe(true)
    expect(classify({ code: '22P02', message: 'bad uuid' }).refused).toBe(true)
  })

  it('treats network, 5xx, expired sessions and unknown errors as try again', () => {
    expect(classify(new TypeError('Failed to fetch'))).toMatchObject({ code: 'network', refused: false, reason: null })
    expect(classify({ code: '42501', message: 'permission denied' }).refused).toBe(false)
    expect(classify({ code: 'PGRST301', message: 'JWT expired' }).refused).toBe(false)
    expect(classify({ code: '08006', message: 'connection failure' }).refused).toBe(false)
    expect(classify(null)).toMatchObject({ code: 'network', refused: false })
    expect(classify('boom').refused).toBe(false)
  })

  it('returns an error it already classified as it is', () => {
    const e = classify({ message: 'day_closed' })
    expect(classify(e)).toBe(e)
  })

  it('has the helpers the nutrition code uses', () => {
    expect(toNutritionError({ message: 'too_many_items' })).toBe('too_many_items')
    expect(toNutritionError(new TypeError('x'))).toBe('network')
    expect(isRefused({ message: 'too_many_checkins' })).toBe(true)
    expect(isRefused({ message: 'boom' })).toBe(false)
  })

  it('is the very function nutrition-api exports', () => {
    expect(nutritionApi.classify).toBe(classify)
    expect(nutritionApi.isRefused).toBe(isRefused)
    expect(nutritionApi.toNutritionError).toBe(toNutritionError)
    expect(nutritionApi.NutritionError).toBe(NutritionError)
  })
})
