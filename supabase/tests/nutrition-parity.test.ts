import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, ledger, sql } from './helpers/game'
import fixture from './fixtures/nutrition-scenarios.json'

let db: PGlite

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')
})

describe('nutrition rules (server, same scenarios as the client)', () => {
  it.each(fixture.days)('classify: $name', async c => {
    const [r] = await sql(db,
      'select public.classify_nutrition_day($1, $2, $3, $4, $5, $6::jsonb) as v',
      [c.totals.kcal, c.totals.protein, c.totals.carbs, c.totals.fat, c.totals.meals, JSON.stringify(c.target)])
    expect(r.v).toEqual(c.expect)
  })

  it.each(fixture.weeks)('$name', async s => {
    await makeUser(db, A, { nutrition_days_per_week: s.target })
    await sql(db,
      `insert into public.weekly_targets (user_id, pillar, week_start, target) values ($1, 'nutrition', $2, $3)`,
      [A, s.days[0].on, s.target])
    // Inserted as the database owner, the same role the day closing writes with.
    for (const d of s.days)
      for (const kind of d.classes)
        await sql(db,
          `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
           values ($1, 'nutrition', $2, $3, $4)`, [A, kind, d.on, 'nutrition:' + d.on])
    const rows = (await ledger(db, A)).filter(r => !r.reason.startsWith('achievement:'))
    expect(rows.every(r => r.pillar === 'nutrition')).toBe(true)
    const awards = rows.map(r => ({ reason: r.reason, amount: r.amount, week: r.week_start }))
    expect(awards).toEqual(s.awards)
    expect(awards.reduce((n, r) => n + r.amount, 0)).toBe(s.total)
  })
})
