import { describe, it, expect } from 'vitest'
import { celebrationsSince, completeMarker, dayResultToast, markerOf } from './celebrations'
import { progressOf } from './test-progress'
import { levelFor } from './xp'
import type { NutritionProgress, Progress } from './types'

const badge = (code: string) => ({ code, unlocked_at: '2026-10-07T20:00:00Z' })

const nutrition = (over: Partial<NutritionProgress> = {}): NutritionProgress => ({
  target: 5, on_target: 2, logged: 3, streak: { current: 1, best: 1, shields: 0 }, confirms_on: '2026-10-09',
  last_closed: null, last_week: null, ...over
})
// Strength 700 XP; nutrition at `nxp` XP.
const withNutrition = (nxp: number, n: Partial<NutritionProgress> = {}, over: Partial<Progress> = {}) =>
  progressOf(700, {}, {
    pillars: { strength: { ...levelFor(700), xp: 700 }, nutrition: { ...levelFor(nxp), xp: nxp } },
    nutrition: nutrition(n), ...over
  })

describe('celebrations', () => {
  it('celebrates a level-up first, then new badges in catalogue order', () => {
    const seen = markerOf(progressOf(90, {}, { achievements: [badge('first_workout')] }))
    const now = progressOf(700, {}, { achievements: [badge('first_workout'), badge('early_bird'), badge('first_pr')] })
    expect(celebrationsSince(seen, now)).toEqual([
      { kind: 'level', level: 5 },
      { kind: 'achievement', code: 'first_pr' },
      { kind: 'achievement', code: 'early_bird' }
    ])
  })

  it('has nothing to say when nothing changed', () => {
    const p = progressOf(700, {}, { achievements: [badge('first_workout')] })
    expect(celebrationsSince(markerOf(p), p)).toEqual([])
  })

  it('celebrates the nutrition pillar reaching a new level', () => {
    const seen = markerOf(withNutrition(90))
    const now = withNutrition(400)
    expect(levelFor(400).level).toBeGreaterThan(levelFor(90).level)
    expect(celebrationsSince(seen, now)).toEqual([{ kind: 'pillar_level', pillar: 'nutrition', level: levelFor(400).level }])
  })

  it('celebrates a pillar that shows up already past level 1', () => {
    const seen = markerOf(progressOf(700))
    const now = withNutrition(400)
    expect(celebrationsSince(seen, now)).toEqual([{ kind: 'pillar_level', pillar: 'nutrition', level: levelFor(400).level }])
  })

  it('celebrates the nutrition weekly goal once per new week', () => {
    const seen = markerOf(withNutrition(90, { last_week: { start: '2026-09-21', target_hit: true } }))
    const hit = withNutrition(90, { last_week: { start: '2026-09-28', target_hit: true } })
    expect(celebrationsSince(seen, hit)).toEqual([{ kind: 'week_target', pillar: 'nutrition', week_start: '2026-09-28' }])
    expect(celebrationsSince(markerOf(hit), hit)).toEqual([])
    const missed = withNutrition(90, { last_week: { start: '2026-09-28', target_hit: false } })
    expect(celebrationsSince(seen, missed)).toEqual([])
  })

  it('orders level, pillar level, weekly goal, then badges', () => {
    const seen = markerOf(progressOf(90, {}, { pillars: { strength: { ...levelFor(90), xp: 90 }, nutrition: { ...levelFor(0), xp: 0 } } }))
    const now = withNutrition(400, { last_week: { start: '2026-09-28', target_hit: true } }, { achievements: [badge('nutrition_week_target_1')] })
    expect(celebrationsSince(seen, now).map(c => c.kind)).toEqual(['level', 'pillar_level', 'week_target', 'achievement'])
  })

  it('completes an old marker with the current progress without celebrating', () => {
    const now = withNutrition(400, { last_week: { start: '2026-09-28', target_hit: true } })
    const old = { level: now.level.level, codes: [] }
    const done = completeMarker(old, now)
    expect(done.pillarLevels).toEqual({ strength: now.level.level, nutrition: levelFor(400).level })
    expect(done.weekTargets).toEqual({ nutrition: '2026-09-28' })
    expect(celebrationsSince(done, now)).toEqual([])
    // A complete marker is left as it is.
    const seen = markerOf(withNutrition(90))
    expect(completeMarker(seen, now)).toEqual(seen)
  })

  it('reads a cached progress from an older build without pillars or nutrition', () => {
    const old = { ...progressOf(700), pillars: undefined, nutrition: undefined } as unknown as Progress
    expect(markerOf(old)).toEqual({ level: old.level.level, codes: [], pillarLevels: {}, weekTargets: {} })
    expect(celebrationsSince(markerOf(old), old)).toEqual([])
    expect(dayResultToast(old, null)).toBeNull()
  })
})

describe('dayResultToast', () => {
  // 2026-10-03 is a Saturday.
  const closed = (over: Partial<NonNullable<NutritionProgress['last_closed']>>) =>
    withNutrition(90, { last_closed: { day: '2026-10-03', logged: true, on_target: true, balanced: false, xp: 120, ...over } })

  it('names the weekday and the XP of a day on target', () => {
    expect(dayResultToast(closed({}), '2026-10-02')).toEqual({ text: 'Saturday on target, +120 XP', day: '2026-10-03' })
  })

  it('says a logged day was logged', () => {
    expect(dayResultToast(closed({ on_target: false, xp: 10 }), null)).toEqual({ text: 'Saturday logged, +10 XP', day: '2026-10-03' })
  })

  it('leaves out the XP when the day paid none', () => {
    expect(dayResultToast(closed({ xp: 0 }), null)?.text).toBe('Saturday on target')
  })

  it('stays quiet for a day already shown, an empty day or no closed day', () => {
    expect(dayResultToast(closed({}), '2026-10-03')).toBeNull()
    expect(dayResultToast(closed({ logged: false, on_target: false, xp: 0 }), null)).toBeNull()
    expect(dayResultToast(withNutrition(90), null)).toBeNull()
  })
})
