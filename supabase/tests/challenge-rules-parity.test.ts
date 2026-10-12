import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { C, befriend, one, rows } from './helpers/social'
import { enableNutrition } from './helpers/nutrition'
import { enableSleep } from './helpers/sleep'
import {
  GRACE, MAX_DAYS, MIN_DAYS, TEMPLATES, addDays, checkChallenge, resultOn, targetRange, type ChallengeProblem
} from '../../src/features/social/templates'
import type { Challenge, ChallengeMode, NewChallenge } from '../../src/features/social/types'

// The challenge rules of the client (src/features/social/templates.ts) against create_challenge
// (0015_nutrition_challenge.sql, 0020_checkin_feed.sql, 0024_sleep_challenge.sql) on the same cases: what the form accepts the
// server accepts, and what the form refuses the server refuses with the matching error. Ana creates,
// today is Monday 2026-10-05 in her time zone, Bia and Caio are her friends.

let db: PGlite
const TODAY = '2026-10-05'
const NUT = 'nutrition_days_on_target'
const SLEEP = 'sleep_nights_on_target'
// The training days template (0020) takes the rules of workouts_count and is the one the client
// creates (workouts_count stays only for challenges already running).
const DAYS = 'checkin_days'

// What the server says about a client problem.
const SERVER: Record<ChallengeProblem, string> = {
  title: 'invalid_challenge', mode: 'invalid_challenge', dates: 'invalid_challenge', target: 'invalid_challenge',
  invitees: 'invalid_challenge', volume: 'volume_opt_in_required', nutrition: 'nutrition_opt_in_required', nutrition_off: 'nutrition_off',
  sleep: 'sleep_opt_in_required', sleep_off: 'sleep_off'
}

async function serverSays(c: NewChallenge, template: string = c.template): Promise<string> {
  try {
    await one(db, A,
      `select public.create_challenge(p_template => $1, p_title => $2, p_mode => $3, p_target => $4::numeric,
              p_starts_on => $5::date, p_ends_on => $6::date, p_invitees => $7::uuid[],
              p_share_volume => $8, p_share_nutrition => $9, p_share_sleep => $10) as v`,
      [template, c.title, c.mode, c.target, c.starts_on, c.ends_on, '{' + c.invitees.join(',') + '}', c.share_volume, c.share_nutrition,
        c.share_sleep])
    return 'ok'
  } catch (e) {
    return (e as Error).message
  } finally {
    // Ana may hold only 10 active challenges.
    await sql(db, 'delete from public.challenges')
  }
}

const draft = (over: Partial<NewChallenge>): NewChallenge => ({
  template: NUT, title: 'No alvo', mode: 'team', target: 1, starts_on: TODAY, ends_on: addDays(TODAY, 6),
  invitees: [B], share_volume: false, share_nutrition: true, share_sleep: false, ...over
})

async function same(c: NewChallenge, nutritionOn = true, sleepOn = false) {
  const problem = checkChallenge(c, TODAY, { nutritionOn, sleepOn })
  expect(await serverSays(c), JSON.stringify(c)).toBe(problem ? SERVER[problem] : 'ok')
}

beforeAll(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  await enableNutrition(db, A)
})

describe('nutrition challenge rules, client and server', () => {
  const shapes: [ChallengeMode, number, string[]][] = []
  for (const mode of ['team', 'solo'] as const) {
    for (const days of [MIN_DAYS, 30, MAX_DAYS]) for (const invitees of [[B], [B, C]]) shapes.push([mode, days, invitees])
  }

  it.each(shapes)('%s for %i days with %j: same goal range', async (mode, days, invitees) => {
    const ends_on = addDays(TODAY, days - 1)
    const r = targetRange(NUT, TODAY, ends_on, mode, invitees.length)
    expect(r.max).toBe(days * (mode === 'team' ? 1 + invitees.length : 1))
    for (const target of [r.min - 1, r.min, r.max, r.max + 1]) await same(draft({ mode, ends_on, invitees, target }))
  })

  it('agrees on the period, the opt-in and the pillar', async () => {
    await same(draft({ ends_on: addDays(TODAY, MIN_DAYS - 2) }))
    await same(draft({ ends_on: addDays(TODAY, MAX_DAYS) }))
    await same(draft({ target: 2.5 }))
    await same(draft({ share_nutrition: false }))
    await enableNutrition(db, A, false)
    await same(draft({}), false)
    await same(draft({ share_nutrition: false }), false)
    await enableNutrition(db, A)
  })

  it('keeps the other templates as they were', async () => {
    // The old templates stay on the server for challenges already running, so they are held too.
    for (const template of (Object.keys(GRACE) as (keyof typeof GRACE)[]).filter(t => t !== NUT && t !== SLEEP)) {
      const mode = template === 'weeks_on_target' ? 'solo' : 'team'
      const ends_on = addDays(TODAY, 13)
      const { max } = targetRange(template, TODAY, ends_on, mode, 1)
      await same(draft({ template, mode, ends_on, target: max, share_volume: true, share_nutrition: false }))
      await same(draft({ template, mode, ends_on, target: max + 1, share_volume: true, share_nutrition: false }))
    }
  })
})

// Ana's Sleep pillar is off outside this block, so the cases above see a sleep template as sleep_off.
describe('sleep challenge rules, client and server', () => {
  const night = (over: Partial<NewChallenge>) =>
    draft({ template: SLEEP, title: 'Dormir bem', share_nutrition: false, share_sleep: true, ...over })
  const sameSleep = (c: NewChallenge, sleepOn = true) => same(c, true, sleepOn)

  const shapes: [ChallengeMode, number, string[]][] = []
  for (const mode of ['team', 'solo'] as const) {
    for (const days of [MIN_DAYS, 30, MAX_DAYS]) for (const invitees of [[B], [B, C]]) shapes.push([mode, days, invitees])
  }

  it.each(shapes)('%s for %i days with %j: same goal range', async (mode, days, invitees) => {
    await enableSleep(db, A)
    try {
      const ends_on = addDays(TODAY, days - 1)
      const r = targetRange(SLEEP, TODAY, ends_on, mode, invitees.length)
      expect(r.max).toBe(days * (mode === 'team' ? 1 + invitees.length : 1))
      for (const target of [r.min - 1, r.min, r.max, r.max + 1]) await sameSleep(night({ mode, ends_on, invitees, target }))
    } finally {
      await enableSleep(db, A, false)
    }
  })

  it('agrees on the period, the opt-in and the pillar, in the order the server checks them', async () => {
    await enableSleep(db, A)
    try {
      await sameSleep(night({ ends_on: addDays(TODAY, MIN_DAYS - 2) }))
      await sameSleep(night({ ends_on: addDays(TODAY, MAX_DAYS) }))
      await sameSleep(night({ target: 2.5 }))
      await sameSleep(night({ share_sleep: false }))
      // The nutrition opt-in does not stand in for the sleep one.
      await sameSleep(night({ share_sleep: false, share_nutrition: true }))
    } finally {
      await enableSleep(db, A, false)
    }
    await sameSleep(night({}), false)
    await sameSleep(night({ share_sleep: false }), false)
    expect(checkChallenge(night({}), TODAY, { sleepOn: false })).toBe('sleep_off')
    expect(checkChallenge(night({ share_sleep: false }), TODAY, { sleepOn: true })).toBe('sleep')
  })
})

describe('training days challenge rules, client and server', () => {
  const asWorkouts = (over: Partial<NewChallenge>) =>
    draft({ template: DAYS, share_nutrition: false, ...over })
  async function sameAsWorkouts(c: NewChallenge) {
    const problem = checkChallenge(c, TODAY)
    expect(await serverSays(c), JSON.stringify(c)).toBe(problem ? SERVER[problem] : 'ok')
  }

  const shapes: [ChallengeMode, number, string[]][] = []
  for (const mode of ['team', 'solo'] as const) {
    for (const days of [MIN_DAYS, 30, MAX_DAYS]) for (const invitees of [[B], [B, C]]) shapes.push([mode, days, invitees])
  }

  it.each(shapes)('%s for %i days with %j: the goal range of checkin_days', async (mode, days, invitees) => {
    const ends_on = addDays(TODAY, days - 1)
    const r = targetRange(DAYS, TODAY, ends_on, mode, invitees.length)
    for (const target of [r.min - 1, r.min, r.max, r.max + 1]) await sameAsWorkouts(asWorkouts({ mode, ends_on, invitees, target }))
  })

  it('agrees on the title, the period, whole goals and the people', async () => {
    await sameAsWorkouts(asWorkouts({ title: ' ' }))
    await sameAsWorkouts(asWorkouts({ title: 'x'.repeat(61) }))
    await sameAsWorkouts(asWorkouts({ ends_on: addDays(TODAY, MIN_DAYS - 2) }))
    await sameAsWorkouts(asWorkouts({ ends_on: addDays(TODAY, MAX_DAYS) }))
    await sameAsWorkouts(asWorkouts({ starts_on: addDays(TODAY, -1) }))
    await sameAsWorkouts(asWorkouts({ starts_on: addDays(TODAY, 31), ends_on: addDays(TODAY, 40) }))
    await sameAsWorkouts(asWorkouts({ target: 2.5 }))
    await sameAsWorkouts(asWorkouts({ invitees: [] }))
    // No opt-in and no pillar: nutrition off and nothing shared is fine.
    await enableNutrition(db, A, false)
    await sameAsWorkouts(asWorkouts({}))
    await enableNutrition(db, A)
  })
})

describe('when the result comes', () => {
  it('waits as many days as challenge_grace', async () => {
    // Every template the client knows, the old ones included.
    for (const template of Object.keys(GRACE) as (keyof typeof GRACE)[]) {
      const [g] = await sql<{ n: number }>(db, 'select public.challenge_grace($1) as n', [template])
      expect(g.n, template).toBe(GRACE[template])
    }
    expect(Object.keys(GRACE).sort()).toEqual([...TEMPLATES, 'workouts_count', 'volume_total'].sort())
  })

  it('closes on the day resultOn gives, in the creator time zone', async () => {
    await enableNutrition(db, B)
    const c = draft({ ends_on: addDays(TODAY, 6), target: 1 })
    const { id } = await one<{ id: string }>(db, A,
      `select public.create_challenge(p_template => $1, p_title => 'No alvo', p_mode => 'team', p_target => 1,
              p_starts_on => $2::date, p_ends_on => $3::date, p_invitees => $4::uuid[],
              p_share_volume => false, p_share_nutrition => true) as v`, [NUT, c.starts_on, c.ends_on, '{' + B + '}'])
    await rows(db, B, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => true)', [id])
    const day = resultOn({ template: NUT, ends_on: c.ends_on } as Challenge)
    expect(day).toBe('2026-10-14')
    // Sao Paulo is UTC-3: the day starts at 03:00Z.
    await setClock(db, addDays(day, -1) + 'T15:00:00Z')
    expect((await sql(db, 'select public.close_all_challenges() as n'))[0].n).toBe(0)
    await setClock(db, day + 'T03:01:00Z')
    expect((await sql(db, 'select public.close_all_challenges() as n'))[0].n).toBe(1)
  })

  it('closes a sleep challenge on the day resultOn gives too', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    await enableSleep(db, A)
    await enableSleep(db, B)
    const ends_on = addDays(TODAY, 6)
    const { id } = await one<{ id: string }>(db, A,
      `select public.create_challenge(p_template => $1, p_title => 'Dormir bem', p_mode => 'team', p_target => 1,
              p_starts_on => $2::date, p_ends_on => $3::date, p_invitees => $4::uuid[],
              p_share_volume => false, p_share_nutrition => false, p_share_sleep => true) as v`, [SLEEP, TODAY, ends_on, '{' + B + '}'])
    await rows(db, B, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_sleep => true)', [id])
    const day = resultOn({ template: SLEEP, ends_on } as Challenge)
    expect(day).toBe('2026-10-14')
    await setClock(db, addDays(day, -1) + 'T15:00:00Z')
    expect((await sql(db, 'select public.close_all_challenges() as n'))[0].n).toBe(0)
    await setClock(db, day + 'T03:01:00Z')
    expect((await sql(db, 'select public.close_all_challenges() as n'))[0].n).toBe(1)
  })
})
