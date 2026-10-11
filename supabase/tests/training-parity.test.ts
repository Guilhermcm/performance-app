import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import fixture from './fixtures/training-scenarios.json'

// The Treino pillar after the check-in cutover (award_xp in 0019, with the PR and weigh-in cutoff
// of 0020), against the same scenarios the client mirror replays (src/features/gamification/xp.ts).
let db: PGlite

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')
})

describe('training xp rules (server, same scenarios as xp.test.ts)', () => {
  it.each(fixture.weeks)('$name', async s => {
    await sql(db, `update public.app_settings set value = to_jsonb($1::date) where key = 'training_checkin_since'`, [s.since])
    const targets = Object.entries(s.targets as Record<string, number>)
    await makeUser(db, A, { days_per_week: targets[0][1] })
    for (const [week, target] of targets)
      await sql(db, 'insert into public.weekly_targets (user_id, week_start, target) values ($1, $2, $3)', [A, week, target])
    // As the database owner, the role close_training_days emits its events with.
    for (const e of s.events) {
      try { await event(db, A, e.kind, e.on, e.ref) }
      catch (err) { if (!/duplicate key/.test(String(err))) throw err }
    }
    const rows = (await ledger(db, A))
      .filter(r => !r.reason.startsWith('achievement:'))
      .map(r => ({ reason: r.reason, amount: r.amount, week: r.week_start }))
    expect(rows).toEqual(s.awards)
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(s.total)
  })
})
