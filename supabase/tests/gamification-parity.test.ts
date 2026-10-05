import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import fixture from './fixtures/xp-scenarios.json'

let db: PGlite
const DAY = 86400000
const monday = (i: number) => new Date(Date.UTC(2026, 5, 1) + i * 7 * DAY).toISOString().slice(0, 10)

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')
})

describe('xp rules (server, same scenarios as xp.test.ts)', () => {
  it.each(fixture.levels)('level_for($xp)', async l => {
    const [r] = await sql(db, 'select level, into_level, need from public.level_for($1)', [l.xp])
    expect(r).toEqual({ level: l.level, into_level: l.into, need: l.need })
  })

  it.each(fixture.weeks)('$name', async s => {
    const targets = Object.entries(s.targets as Record<string, number>)
    await makeUser(db, A, { days_per_week: targets[0][1] })
    for (const [week, target] of targets)
      await sql(db, 'insert into public.weekly_targets (user_id, week_start, target) values ($1, $2, $3)', [A, week, target])
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

  it.each(fixture.streaks)('streak: $name', async s => {
    await makeUser(db, A, { days_per_week: 1 })
    await sql(db, `update public.profiles set created_at = '2026-06-01T15:00:00Z' where id = $1`, [A])
    for (const [i, hit] of s.hits.entries()) if (hit) await event(db, A, 'workout_completed', monday(i), 'w' + i)
    await setClock(db, monday(s.hits.length) + 'T15:00:00Z')
    await sql(db, 'select public.close_weeks($1)', [A])
    const [st] = await sql(db, `select current, best, shields from public.streaks where user_id = $1 and kind = 'training_week'`, [A])
    expect(st).toEqual({ current: s.current, best: s.best, shields: s.shields })
  })
})
