import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { C, befriend, one, rows } from './helpers/social'
import { enableNutrition } from './helpers/nutrition'
import {
  GRACE, MAX_DAYS, MIN_DAYS, TEMPLATES, addDays, checkChallenge, resultOn, targetRange, type ChallengeProblem
} from '../../src/features/social/templates'
import type { Challenge, ChallengeMode, NewChallenge } from '../../src/features/social/types'

// The challenge rules of the client (src/features/social/templates.ts) against create_challenge
// (0015_nutrition_challenge.sql) on the same cases: what the form accepts the server accepts, and
// what the form refuses the server refuses with the matching error. Ana creates, today is Monday
// 2026-10-05 in her time zone, Bia and Caio are her friends.

let db: PGlite
const TODAY = '2026-10-05'
const NUT = 'nutrition_days_on_target'

// What the server says about a client problem.
const SERVER: Record<ChallengeProblem, string> = {
  title: 'invalid_challenge', mode: 'invalid_challenge', dates: 'invalid_challenge', target: 'invalid_challenge',
  invitees: 'invalid_challenge', volume: 'volume_opt_in_required', nutrition: 'nutrition_opt_in_required', nutrition_off: 'nutrition_off'
}

async function serverSays(c: NewChallenge): Promise<string> {
  try {
    await one(db, A,
      `select public.create_challenge(p_template => $1, p_title => $2, p_mode => $3, p_target => $4::numeric,
              p_starts_on => $5::date, p_ends_on => $6::date, p_invitees => $7::uuid[],
              p_share_volume => $8, p_share_nutrition => $9) as v`,
      [c.template, c.title, c.mode, c.target, c.starts_on, c.ends_on, '{' + c.invitees.join(',') + '}', c.share_volume, c.share_nutrition])
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
  invitees: [B], share_volume: false, share_nutrition: true, ...over
})

async function same(c: NewChallenge, nutritionOn = true) {
  const problem = checkChallenge(c, TODAY, { nutritionOn })
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
    for (const template of TEMPLATES.filter(t => t !== NUT)) {
      const mode = template === 'weeks_on_target' ? 'solo' : 'team'
      const ends_on = addDays(TODAY, 13)
      const { max } = targetRange(template, TODAY, ends_on, mode, 1)
      await same(draft({ template, mode, ends_on, target: max, share_volume: true, share_nutrition: false }))
      await same(draft({ template, mode, ends_on, target: max + 1, share_volume: true, share_nutrition: false }))
    }
  })
})

describe('when the result comes', () => {
  it('waits as many days as challenge_grace', async () => {
    for (const template of TEMPLATES) {
      const [g] = await sql<{ n: number }>(db, 'select public.challenge_grace($1) as n', [template])
      expect(g.n, template).toBe(GRACE[template])
    }
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
})
