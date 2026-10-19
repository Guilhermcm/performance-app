// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import fixture from '../../../supabase/tests/fixtures/run-details.json'
import { checkRunDetail, formatKm, parseKm, plannedMinutes, plannedOn, runLine } from './run-detail'
import type { Item, RunPlan, Session } from './types'

afterEach(async () => { await setLang('en') })

// The same cases the database runs (supabase/tests/run-checkins.test.ts, plan decision 6).
describe('checkRunDetail', () => {
  const cases = (fixture as { cases: { name: string; activity: string; run: unknown; valid: boolean }[] }).cases

  it('has the shared cases', () => {
    expect(cases.length).toBeGreaterThan(50)
    expect(cases.some(c => c.valid) && cases.some(c => !c.valid)).toBe(true)
  })

  it.each(cases.map(c => [c.name, c] as const))('%s', (_name, c) => {
    expect(checkRunDetail(c.run, c.activity)).toBe(c.valid)
  })

  it('checks what goes out: a key left undefined is dropped, a number that is not finite is refused', () => {
    expect(checkRunDetail({ status: 'unplanned', rpe: undefined, distance_km: 5 }, 'run')).toBe(true)
    expect(checkRunDetail({ status: 'unplanned', distance_km: Number.NaN }, 'run')).toBe(false)
    expect(checkRunDetail({ status: 'unplanned', distance_km: Infinity }, 'run')).toBe(false)
    expect(checkRunDetail(undefined, 'run')).toBe(false)
  })
})

describe('parseKm', () => {
  it('takes a comma or a dot, from 0.1 to 100, with two decimals at most', () => {
    expect(parseKm('6,25')).toBe(6.25)
    expect(parseKm('6.2')).toBe(6.2)
    expect(parseKm('0,1')).toBe(0.1)
    expect(parseKm('100')).toBe(100)
    expect(parseKm(' 12,3 ')).toBe(12.3)
  })

  it('gives null for anything else', () => {
    for (const s of ['0,05', '100,5', '6,255', 'abc', '', '0', '-5', '6,', ',5', '6,2,1', '1e2']) expect(parseKm(s)).toBeNull()
  })

  it('gives only what the database takes', () => {
    for (const s of ['0,1', '6,25', '12.34', '99,99', '100']) {
      expect(checkRunDetail({ status: 'unplanned', distance_km: parseKm(s) }, 'run')).toBe(true)
    }
  })
})

describe('formatKm and runLine', () => {
  it('writes the distance with the decimal mark of the language', async () => {
    expect(formatKm(6.2)).toBe('6.2')
    expect(formatKm(10)).toBe('10')
    await setLang('pt-BR')
    expect(formatKm(6.2)).toBe('6,2')
    expect(formatKm(6.25)).toBe('6,25')
  })

  it('names the type, the distance and the duration, each when there is one', async () => {
    await setLang('pt-BR')
    expect(runLine({ run_type: 'intervals', distance_km: 6.2, duration_min: 38 })).toBe('Intervalado · 6,2 km · 38 min')
    expect(runLine({ run_type: null, distance_km: 6.2, duration_min: 38 })).toBe('6,2 km · 38 min')
    expect(runLine({ distance_km: null, duration_min: 38 })).toBe('38 min')
    expect(runLine({ run_type: 'long', duration_min: null })).toBe('Longão')
    expect(runLine({ duration_min: null })).toBe('')
  })

  it('in English', () => {
    expect(runLine({ run_type: 'intervals', distance_km: 6.2, duration_min: 38 })).toBe('Interval run · 6.2 km · 38 min')
  })

  it('leaves the duration out when the title already ends with it (final review M3)', () => {
    expect(runLine({ run_type: 'intervals', distance_km: 6.2, duration_min: 38, title: 'Running · 38 min' })).toBe('Interval run · 6.2 km')
    expect(runLine({ run_type: 'intervals', distance_km: 6.2, duration_min: 38, title: 'Track day' })).toBe('Interval run · 6.2 km · 38 min')
    expect(runLine({ distance_km: 20, duration_min: 38, title: 'Running · 138 min' })).toBe('20 km · 38 min')
  })
})

// A plan whose week 1 starts on Monday 12/10/2026: an easy run on Tuesday and an interval run on
// Thursday, then a long run on Sunday in week 2.
const INTERVALS: Item[] = [{ zone: 'easy', min: 10 }, { repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] }, { zone: 'easy', min: 5 }]
const session = (id: string, type: Session['type'], day: number, blocks: Item[]): Session => ({ id, type, day, blocks })
const planOf = (over: Partial<RunPlan> = {}): RunPlan => ({
  version: 1, goal: '10k', goalType: 'finish', startDate: '2026-10-12',
  answers: { goal: '10k', reference: { kind: 'none' }, days: 3, longDay: 0 },
  vdotSource: null, dismissed: {},
  weeks: [
    { index: 1, phase: 'base', recovery: false, sessions: [session('w1-s1', 'easy', 2, [{ zone: 'easy', min: 30 }]), session('w1-s2', 'intervals', 4, INTERVALS)] },
    { index: 2, phase: 'base', recovery: false, sessions: [session('w2-s1', 'long', 0, [{ zone: 'easy', min: 60 }])] }
  ],
  ...over
})

describe('plannedOn', () => {
  it('copies the first session of the day, with the index of its week', () => {
    const plan = planOf({ weekStart: 1 })
    expect(plannedOn(plan, '2026-10-15', 1)).toEqual({ week: 1, session: 'w1-s2', type: 'intervals', blocks: INTERVALS })
    expect(plannedOn(plan, '2026-10-25', 1)).toEqual({ week: 2, session: 'w2-s1', type: 'long', blocks: [{ zone: 'easy', min: 60 }] })
    const got = plannedOn(plan, '2026-10-15', 1)!
    expect(got.blocks).not.toBe(plan.weeks[0].sessions[1].blocks)
    ;(got.blocks[1] as { repeat: number }).repeat = 9
    expect((plan.weeks[0].sessions[1].blocks[1] as { repeat: number }).repeat).toBe(5)
  })

  it('maps the date with the week start: Sunday 18/10 ends week 1 from Monday, and starts week 2 from Sunday', () => {
    const plan = planOf()
    expect(plannedOn(plan, '2026-10-18', 1)).toBeNull()
    expect(plannedOn(plan, '2026-10-18', 0)).toMatchObject({ week: 2, session: 'w2-s1' })
    expect(plannedOn({ ...plan, weekStart: 0 }, '2026-10-18', 1)).toMatchObject({ week: 2, session: 'w2-s1' })
    expect(plannedOn(plan, '2026-10-15', 0)).toMatchObject({ week: 1, session: 'w1-s2' })
  })

  it('takes the first of two sessions on the same day', () => {
    const plan = planOf({ weekStart: 1 })
    plan.weeks[0].sessions.push(session('w1-s3', 'easy', 4, [{ zone: 'easy', min: 20 }]))
    expect(plannedOn(plan, '2026-10-15', 1)?.session).toBe('w1-s2')
  })

  it('is null on a day without a session, before the start, after the end and for a plan this build does not read', () => {
    const plan = planOf({ weekStart: 1 })
    expect(plannedOn(plan, '2026-10-14', 1)).toBeNull()
    expect(plannedOn(plan, '2026-10-08', 1)).toBeNull()
    expect(plannedOn(plan, '2026-11-03', 1)).toBeNull()
    expect(plannedOn({ ...plan, version: 2 as never }, '2026-10-15', 1)).toBeNull()
    expect(plannedOn({ ...plan, weeks: [] }, '2026-10-15', 1)).toBeNull()
    expect(plannedOn(null, '2026-10-15', 1)).toBeNull()
  })

  it('gives what the database takes as planned', () => {
    const planned = plannedOn(planOf({ weekStart: 1 }), '2026-10-15', 1)
    expect(checkRunDetail({ status: 'as_planned', planned, distance_km: 6.2 }, 'run')).toBe(true)
  })
})

describe('plannedMinutes', () => {
  it('counts a repeat as many times as it goes', () => {
    expect(plannedMinutes(INTERVALS)).toBe(35)
    expect(plannedMinutes([{ repeat: 8, blocks: [{ zone: 'easy', min: 1 }, { zone: 'walk', min: 2 }] }])).toBe(24)
    expect(plannedMinutes([])).toBe(0)
  })
})
