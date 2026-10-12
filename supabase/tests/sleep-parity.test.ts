import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, ledger, sql } from './helpers/game'
import fixture from './fixtures/sleep-scenarios.json'

let db: PGlite

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')
})

describe('sleep rules (server, same scenarios as the client)', () => {
  it.each(fixture.nights)('classify: $name', async c => {
    // The duration is the one sleep_logs computes: wake minus bed, wrapped around midnight.
    const [r] = await sql(db,
      `select public.classify_sleep_night(
                $1::time,
                case when $1::time is null then null
                     else ((extract(epoch from ($2::time - $1::time))::int / 60) + 1440) % 1440 end,
                $3::int, $4::jsonb) as v`,
      [c.log?.bed_time ?? null, c.log?.wake_time ?? null, c.log?.quality ?? null,
        c.target === null ? null : JSON.stringify(c.target)])
    expect(r.v).toEqual(c.expect)
  })

  it.each(fixture.weeks)('$name', async s => {
    await makeUser(db, A, { sleep_nights_per_week: s.target })
    await sql(db,
      `insert into public.weekly_targets (user_id, pillar, week_start, target) values ($1, 'sleep', $2, $3)`,
      [A, s.nights[0].on, s.target])
    // Inserted as the database owner, the same role the night closing writes with, in its order.
    for (const n of s.nights)
      for (const [kind, on] of [['night_logged', n.classes.logged], ['night_on_target', n.classes.on_target],
        ['night_rested', n.classes.rested]] as const)
        if (on)
          await sql(db,
            `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
             values ($1, 'sleep', $2, $3, $4)`, [A, kind, n.on, 'sleep:' + n.on])
    const rows = (await ledger(db, A)).filter(r => !r.reason.startsWith('achievement:'))
    expect(rows.every(r => r.pillar === 'sleep')).toBe(true)
    const awards = rows.map(r => ({ reason: r.reason, amount: r.amount, week: r.week_start }))
    expect(awards).toEqual(s.awards)
    expect(awards.reduce((n, r) => n + r.amount, 0)).toBe(s.total)
  })
})
