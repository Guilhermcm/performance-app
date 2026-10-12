import { describe, it, expect } from 'vitest'
import fixture from '../../../supabase/tests/fixtures/xp-scenarios.json'
import nutrition from '../../../supabase/tests/fixtures/nutrition-scenarios.json'
import training from '../../../supabase/tests/fixtures/training-scenarios.json'
import {
  nutritionWeekAwards, sleepWeekAwards, levelFor, replay, sessionXp, streakAfter, weekStartOf, WEEK_MAX, TRAINING_WEEK_MAX, type XpEvent
} from './xp'
import sleep from '../../../supabase/tests/fixtures/sleep-scenarios.json'

describe('xp rules (client mirror)', () => {
  it.each(fixture.levels)('levelFor($xp)', l => {
    expect(levelFor(l.xp)).toEqual({ level: l.level, into: l.into, need: l.need })
  })

  it.each(fixture.weeks)('$name', s => {
    const targets = s.targets as Record<string, number>
    const awards = replay(s.events as XpEvent[], week => targets[week])
    expect(awards).toEqual(s.awards)
    expect(awards.reduce((n, a) => n + a.amount, 0)).toBe(s.total)
  })

  it.each(fixture.streaks)('streak: $name', s => {
    expect(streakAfter(s.hits)).toEqual({ current: s.current, best: s.best, shields: s.shields })
  })

  it('planned sessions add up to 600 and the weekly max is 960 for every T', () => {
    for (let t = 1; t <= 7; t++) {
      let sum = 0
      for (let k = 1; k <= t; k++) sum += sessionXp(t, k)
      expect(sum, `T=${t}`).toBe(600)
    }
    expect(WEEK_MAX).toBe(960)
  })

  it('weeks start on Monday', () => {
    expect(['2026-10-05', '2026-10-11', '2026-10-12'].map(weekStartOf)).toEqual(['2026-10-05', '2026-10-05', '2026-10-12'])
  })

  it.each(nutrition.weeks)('nutrition: $name', w => {
    const days = w.days.map(d => ({
      on: d.on,
      classes: {
        logged: d.classes.includes('day_logged'),
        on_target: d.classes.includes('day_on_target'),
        balanced: d.classes.includes('macros_balanced'),
      },
    }))
    const awards = nutritionWeekAwards(days, w.target)
    expect(awards).toEqual(w.awards)
    expect(awards.reduce((n, a) => n + a.amount, 0)).toBe(w.total)
  })

  // The Treino pillar after the check-in cutover: the server's award_xp (0019, with the PR and
  // weigh-in cutoff of 0020) runs the same file in supabase/tests/training-parity.test.ts.
  it.each(training.weeks)('training: $name', s => {
    const targets = s.targets as Record<string, number>
    const awards = replay(s.events as XpEvent[], week => targets[week], s.since)
    expect(awards).toEqual(s.awards)
    expect(awards.reduce((n, a) => n + a.amount, 0)).toBe(s.total)
  })

  it('keeps the weekly max at 960 with the check-in reasons (spec 5.1)', () => {
    expect(TRAINING_WEEK_MAX).toBe(960)
  })

  it('pays a live workout before the cutover only on a day no check-in paid', () => {
    const events: XpEvent[] = [
      { kind: 'training_day', on: '2026-09-07', ref: 'training:2026-09-07' },
      { kind: 'workout_completed', on: '2026-09-07', ref: 'w1' },
      { kind: 'workout_completed', on: '2026-09-08', ref: 'w2' },
    ]
    expect(replay(events, () => 3, '2026-09-10').map(a => a.reason))
      .toEqual(['training_logged', 'training_day', 'workout'])
  })

  it('without a cutover, every event pays the way it did before check-ins', () => {
    const events: XpEvent[] = [
      { kind: 'workout_completed', on: '2026-09-07', ref: 'w1' },
      { kind: 'pr', on: '2026-09-07', ref: 'w1:0025' },
      { kind: 'weight_logged', on: '2026-09-07', ref: '2026-09-07' },
    ]
    expect(replay(events, () => 3).map(a => a.reason)).toEqual(['workout', 'pr', 'weight'])
    expect(replay(events, () => 3, null).map(a => a.reason)).toEqual(['workout', 'pr', 'weight'])
  })
})

describe('sleep xp rules (client mirror)', () => {
  it.each(sleep.weeks)('sleep: $name', w => {
    const awards = sleepWeekAwards(w.nights, w.target)
    expect(awards).toEqual(w.awards)
    expect(awards.reduce((n, a) => n + a.amount, 0)).toBe(w.total)
  })
  // The server emits no event for a night with no target in force, so the caller passes only the
  // nights that had one. classifyNight alone would call such a night logged.
  it('pays nothing for a night with no target in force once the caller filters it out', () => {
    const logged = { logged: true, on_target: true, rested: false }
    const nights = [
      { on: '2026-09-07', classes: logged, target: null },
      { on: '2026-09-08', classes: logged, target: { goal_min: 480, bed_target: '23:00' } },
    ]
    const awards = sleepWeekAwards(nights.filter(n => n.target).map(({ on, classes }) => ({ on, classes })), 5)
    expect(awards.map(a => a.reason)).toEqual(['sleep_logged', 'sleep_night'])
  })
})
