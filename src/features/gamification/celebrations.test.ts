// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { celebrationsSince, completeMarker, dayResultToast, habitWeekText, markerOf, sleepNightToast, trainingDayToast } from './celebrations'
import { setLang } from '../../lib/i18n.js'
import { progressOf } from './test-progress'
import { levelFor } from './xp'
import type { HabitsProgress, NutritionProgress, Progress, SleepProgress } from './types'

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

const sleep = (over: Partial<SleepProgress> = {}): SleepProgress => ({
  target: 5, on_target: 2, logged: 3, streak: { current: 1, best: 1, shields: 0 }, confirms_on: '2026-10-09',
  last_closed: null, last_week: null, ...over
})
// Strength 700 XP; sleep at `sxp` XP.
const withSleep = (sxp: number, s: Partial<SleepProgress> = {}, over: Partial<Progress> = {}) =>
  progressOf(700, {}, {
    pillars: { strength: { ...levelFor(700), xp: 700 }, sleep: { ...levelFor(sxp), xp: sxp } },
    sleep: sleep(s), ...over
  })

const habits = (over: Partial<HabitsProgress> = {}): HabitsProgress => ({
  week: { q: 9, c: 4, xp: 300 }, streak: { current: 1, best: 1, shields: 0 }, last_week: null, ...over
})
// Strength 700 XP; habits at `hxp` XP.
const withHabits = (hxp: number, b: Partial<HabitsProgress> = {}, over: Partial<Progress> = {}) =>
  progressOf(700, {}, {
    pillars: { strength: { ...levelFor(700), xp: 700 }, habits: { ...levelFor(hxp), xp: hxp } },
    habits: habits(b), ...over
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
    expect(done.pillarLevels).toEqual({ strength: now.level.level, nutrition: levelFor(400).level, sleep: 1, habits: 1 })
    expect(done.weekTargets).toEqual({ nutrition: '2026-09-28', sleep: null, habits: null })
    expect(celebrationsSince(done, now)).toEqual([])
    // A complete marker is left as it is.
    const seen = markerOf(withNutrition(90))
    expect(completeMarker(seen, now)).toEqual(seen)
  })

  it('reads a cached progress from an older build without pillars or nutrition', () => {
    const old = { ...progressOf(700), pillars: undefined, nutrition: undefined } as unknown as Progress
    expect(markerOf(old)).toEqual({ level: old.level.level, codes: [], pillarLevels: { sleep: 1, habits: 1 }, weekTargets: { sleep: null, habits: null } })
    expect(celebrationsSince(markerOf(old), old)).toEqual([])
    expect(dayResultToast(old, null)).toBeNull()
    expect(sleepNightToast(old, null)).toBeNull()
  })

  it('celebrates the sleep pillar reaching a new level', () => {
    const seen = markerOf(withSleep(90))
    const now = withSleep(400)
    expect(celebrationsSince(seen, now)).toEqual([{ kind: 'pillar_level', pillar: 'sleep', level: levelFor(400).level }])
  })

  it('celebrates the sleep weekly goal once per new week, after nutrition', () => {
    const seen = markerOf(withSleep(90))
    const hit = withSleep(90, { last_week: { start: '2026-09-28', target_hit: true } })
    expect(celebrationsSince(seen, hit)).toEqual([{ kind: 'week_target', pillar: 'sleep', week_start: '2026-09-28' }])
    expect(celebrationsSince(markerOf(hit), hit)).toEqual([])
    const next = withSleep(90, { last_week: { start: '2026-10-05', target_hit: true } })
    expect(celebrationsSince(markerOf(hit), next)).toEqual([{ kind: 'week_target', pillar: 'sleep', week_start: '2026-10-05' }])
    const missed = withSleep(90, { last_week: { start: '2026-10-05', target_hit: false } })
    expect(celebrationsSince(markerOf(hit), missed)).toEqual([])
    const both = withSleep(90, { last_week: { start: '2026-09-28', target_hit: true } },
      { nutrition: nutrition({ last_week: { start: '2026-09-28', target_hit: true } }) })
    expect(celebrationsSince(seen, both).map(c => c.kind === 'week_target' && c.pillar)).toEqual(['nutrition', 'sleep'])
  })

  it('completes a marker from before the sleep pillar without celebrating it', () => {
    const now = withSleep(400, { last_week: { start: '2026-09-28', target_hit: true } })
    // Saved by the nutrition-era build: both maps there, no sleep in either.
    const old = { level: now.level.level, codes: [], pillarLevels: { strength: now.level.level }, weekTargets: {} }
    const done = completeMarker(old, now)
    expect(done.pillarLevels).toEqual({ strength: now.level.level, sleep: levelFor(400).level, habits: 1 })
    expect(done.weekTargets).toEqual({ sleep: '2026-09-28', habits: null })
    expect(celebrationsSince(done, now)).toEqual([])
    // A marker with sleep and no week yet is complete: the first sleep week is still celebrated.
    const fresh = markerOf(withSleep(90))
    expect(fresh.weekTargets).toEqual({ sleep: null, habits: null })
    expect(completeMarker(fresh, now)).toBe(fresh)
    expect(celebrationsSince(fresh, withSleep(90, { last_week: { start: '2026-09-28', target_hit: true } })))
      .toEqual([{ kind: 'week_target', pillar: 'sleep', week_start: '2026-09-28' }])
  })
})

describe('habit celebrations', () => {
  it('celebrates the habits pillar reaching a new level', () => {
    const seen = markerOf(withHabits(90))
    const now = withHabits(400)
    expect(levelFor(400).level).toBeGreaterThan(levelFor(90).level)
    expect(celebrationsSince(seen, now)).toEqual([{ kind: 'pillar_level', pillar: 'habits', level: levelFor(400).level }])
  })

  it('celebrates the habit week once per new week, with the bonus it paid', () => {
    const seen = markerOf(withHabits(90))
    const hit = withHabits(90, { last_week: { start: '2026-09-28', target_hit: true, bonus: 64 } })
    expect(celebrationsSince(seen, hit)).toEqual([{ kind: 'week_target', pillar: 'habits', week_start: '2026-09-28', xp: 64 }])
    expect(celebrationsSince(markerOf(hit), hit)).toEqual([])
    const next = withHabits(90, { last_week: { start: '2026-10-05', target_hit: true, bonus: 150 } })
    expect(celebrationsSince(markerOf(hit), next)).toEqual([{ kind: 'week_target', pillar: 'habits', week_start: '2026-10-05', xp: 150 }])
    const missed = withHabits(90, { last_week: { start: '2026-10-05', target_hit: false, bonus: 0 } })
    expect(celebrationsSince(markerOf(hit), missed)).toEqual([])
  })

  it('tells the habit week after nutrition and sleep', () => {
    const week = { start: '2026-09-28', target_hit: true }
    const seen = markerOf(withHabits(90))
    const all = withHabits(90, { last_week: { ...week, bonus: 64 } }, { nutrition: nutrition({ last_week: week }), sleep: sleep({ last_week: week }) })
    expect(celebrationsSince(seen, all).map(c => c.kind === 'week_target' && c.pillar)).toEqual(['nutrition', 'sleep', 'habits'])
  })

  it('says the habit week is done with its XP', async () => {
    expect(habitWeekText(64)).toBe('Habit week done, +64 XP')
    expect(habitWeekText(1500)).toBe('Habit week done, +1,500 XP')
    await setLang('pt-BR')
    try {
      expect(habitWeekText(64)).toBe('Semana de hábitos completa, +64 XP')
    } finally {
      await setLang('en')
    }
  })

  it('completes a marker from before the habits pillar without celebrating it', () => {
    const now = withHabits(400, { last_week: { start: '2026-09-28', target_hit: true, bonus: 64 } })
    // Saved by the sleep-era build: sleep in both maps, no habits in either.
    const old = { level: now.level.level, codes: [], pillarLevels: { strength: now.level.level, sleep: 1 }, weekTargets: { sleep: null } }
    const done = completeMarker(old, now)
    expect(done.pillarLevels).toEqual({ strength: now.level.level, sleep: 1, habits: levelFor(400).level })
    expect(done.weekTargets).toEqual({ sleep: null, habits: '2026-09-28' })
    expect(celebrationsSince(done, now)).toEqual([])
    // A marker with habits and no week yet is complete: the first habit week is still celebrated.
    const fresh = markerOf(withHabits(90))
    expect(completeMarker(fresh, now)).toBe(fresh)
    expect(celebrationsSince(fresh, withHabits(90, { last_week: { start: '2026-09-28', target_hit: true, bonus: 64 } })))
      .toEqual([{ kind: 'week_target', pillar: 'habits', week_start: '2026-09-28', xp: 64 }])
  })

  it('reads a cached progress without the habits block', () => {
    const old = { ...withSleep(90), habits: undefined }
    expect(markerOf(old).weekTargets).toEqual({ sleep: null, habits: null })
    expect(celebrationsSince(markerOf(old), old)).toEqual([])
  })
})

describe('sleepNightToast', () => {
  // 2026-10-03 is a Saturday, 2026-10-05 a Monday. The night is the day of waking up.
  const closed = (over: Partial<NonNullable<SleepProgress['last_closed']>> = {}) =>
    withSleep(90, { last_closed: { night: '2026-10-03', logged: true, on_target: true, rested: false, xp: 130, ...over } })

  it('names the weekday and the XP of a night on target', () => {
    expect(sleepNightToast(closed(), '2026-10-02')).toEqual({ text: 'Saturday on target, +130 XP', night: '2026-10-03' })
  })

  it('says a night off target was logged, with its XP', () => {
    expect(sleepNightToast(closed({ on_target: false, xp: 10 }), null)).toEqual({ text: 'Saturday logged, +10 XP', night: '2026-10-03' })
    // A night with no goal in force pays nothing: no XP in the sentence.
    expect(sleepNightToast(closed({ on_target: false, xp: 0 }), null)?.text).toBe('Saturday logged')
  })

  it('reads naturally in Brazilian Portuguese', async () => {
    await setLang('pt-BR')
    try {
      expect(sleepNightToast(closed(), null)?.text).toBe('Sábado no alvo, +130 XP')
      expect(sleepNightToast(closed({ on_target: false, xp: 10 }), null)?.text).toBe('Sábado registrado, +10 XP')
      const monday = withSleep(90, { last_closed: { night: '2026-10-05', logged: true, on_target: false, rested: false, xp: 10 } })
      expect(sleepNightToast(monday, null)?.text).toBe('Segunda-feira registrada, +10 XP')
    } finally {
      await setLang('en')
    }
  })

  it('stays quiet for a night already shown, a night without a log or no closed night', () => {
    expect(sleepNightToast(closed(), '2026-10-03')).toBeNull()
    expect(sleepNightToast(closed(), '2026-10-04')).toBeNull()
    expect(sleepNightToast(closed({ logged: false, on_target: false, xp: 0 }), null)).toBeNull()
    expect(sleepNightToast(withSleep(90), null)).toBeNull()
    expect(sleepNightToast(progressOf(700), null)).toBeNull()
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

describe('trainingDayToast', () => {
  // 2026-10-03 is a Saturday. The Treino day closes at D+2, so the toast names its weekday.
  const closed = (xp: number, day = '2026-10-03') =>
    progressOf(700, {}, { training: { confirms_on: '2026-10-07', last_closed: { day, detailed: false, xp } } })

  it('confirms the training day by its weekday, with the XP it paid', () => {
    expect(trainingDayToast(closed(210), '2026-10-02')).toEqual({ text: 'Saturday workout confirmed, +210 XP', day: '2026-10-03' })
    expect(trainingDayToast(closed(0), null)?.text).toBe('Saturday workout confirmed')
  })

  it('reads naturally in Brazilian Portuguese', async () => {
    await setLang('pt-BR')
    try {
      expect(trainingDayToast(closed(210), null)?.text).toBe('Treino de sábado confirmado, +210 XP')
      expect(trainingDayToast(closed(0), null)?.text).toBe('Treino de sábado confirmado')
    } finally {
      await setLang('en')
    }
  })

  it('stays quiet for a day already shown or without a closed day', () => {
    expect(trainingDayToast(closed(210), '2026-10-03')).toBeNull()
    expect(trainingDayToast(closed(210), '2026-10-04')).toBeNull()
    expect(trainingDayToast(progressOf(700), null)).toBeNull()
    expect(trainingDayToast(progressOf(700, {}, { training: { confirms_on: '2026-10-07', last_closed: null } }), null)).toBeNull()
  })
})
