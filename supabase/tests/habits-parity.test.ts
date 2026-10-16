import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, sql } from './helpers/game'
import { addHabit, checkHabit, closeHabitsAs, enableHabits, setHabitTarget } from './helpers/habits'
import fixture from './fixtures/habits-scenarios.json'

// The same weeks the client replays (src/features/habits/habits-parity.test.ts): the closing marks
// the valid checks and award_xp pays them, in the order they were emitted.

let db: PGlite

const at = (day: string, add: number) => {
  const d = new Date(day + 'T15:00:00Z')   // 12:00 in Sao Paulo
  d.setUTCDate(d.getUTCDate() + add)
  return d.toISOString()
}

beforeEach(async () => {
  db = await freshDb()
})

describe('habit XP (server, same scenarios as the client)', () => {
  it.each(fixture.weeks)('$name', async w => {
    // The pillar and the habits exist since the Monday before, so the week starts with every target.
    await setClock(db, at(w.week_start, -7))
    await makeUser(db, A)
    await enableHabits(db, A)
    for (const h of w.habits) {
      await addHabit(db, A, { id: h.id, sort: h.sort, perWeek: h.target, asOwner: true })
      await setHabitTarget(db, h.id, A, w.week_start, h.target)
    }
    for (const c of w.checks) await checkHabit(db, A, c.habit, c.day, { asOwner: true })

    await setClock(db, at(w.week_start, 9))   // the Wednesday after: the whole week has closed
    await closeHabitsAs(db, A)

    const rows = await sql(db,
      `select l.reason, l.amount, e.source_ref as ref, to_char(l.week_start, 'YYYY-MM-DD') as week
         from public.xp_ledger l join public.activity_events e on e.id = l.event_id
        where l.user_id = $1 and l.pillar = 'habits' order by l.id`, [A])
    expect(rows.every(r => r.week === w.week_start)).toBe(true)
    const awards = rows.map(({ reason, amount, ref }) => ({ reason, amount, ref }))
    expect(awards).toEqual(w.awards)
    expect(awards.reduce((n, r) => n + r.amount, 0)).toBe(w.total)
  })
})
