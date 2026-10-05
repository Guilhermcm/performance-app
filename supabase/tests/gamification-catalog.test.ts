import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { sql } from './helpers/game'
import { ACHIEVEMENTS } from '../../src/features/gamification/achievements'
import cases from './fixtures/achievement-scenarios.json'

let db: PGlite
beforeEach(async () => { db = await freshDb() })

describe('achievement catalogue (server)', () => {
  it('is the same as the client catalogue', async () => {
    const rows = await sql(db, 'select code, metric, threshold, xp, sort, private from public.achievement_catalog order by sort')
    expect(rows).toEqual(ACHIEVEMENTS.map(({ code, metric, threshold, xp, sort, private: p }) =>
      ({ code, metric, threshold, xp, sort, private: p ?? false })))
  })

  it.each(cases)('$name', async c => {
    const [r] = await sql<{ codes: string[] }>(db,
      'select to_jsonb(public.achievements_for_stats($1::jsonb, $2::text[])) as codes',
      [JSON.stringify(c.stats), '{' + c.unlocked.join(',') + '}'])
    expect(r.codes).toEqual(c.expect)
  })
})
