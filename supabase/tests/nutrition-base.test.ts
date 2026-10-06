import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql, legacyTraining } from './helpers/game'
import { enableNutrition } from './helpers/nutrition'

let db: PGlite
const periods = (uid: string) =>
  sql(db, `select to_char(started_on, 'YYYY-MM-DD') as started_on, to_char(ended_on, 'YYYY-MM-DD') as ended_on
             from public.nutrition_periods where user_id = $1 order by started_on`, [uid])
const activeOn = async (uid: string, day: string) =>
  (await sql<{ v: boolean }>(db, 'select public.nutrition_active_on($1, $2) as v', [uid, day]))[0].v
// The 14-day window (and, for clients, the order of BEFORE trigger and RLS check) reads the real
// clock, so the client cases use the real local today rather than the pinned one.
const realToday = async () =>
  (await sql<{ d: string }>(db, `select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`))[0].d
const insertKind = (kind: string, on: string, ref = `nutrition:${on}`) =>
  db.query(
    `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
     values ($1, 'nutrition', $2, $3, $4)`, [A, kind, on, ref])

beforeEach(async () => {
  db = await freshDb()
  await legacyTraining(db)   // the workout rules from before check-ins
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday
  await makeUser(db, A)
})

describe('nutrition periods', () => {
  it('opens a period on the day the pillar is turned on', async () => {
    await enableNutrition(db, A)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
  })

  it('closes it the day before it is turned off', async () => {
    await enableNutrition(db, A)
    await setClock(db, '2026-10-09T15:00:00Z')
    await enableNutrition(db, A, false)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: '2026-10-08' }])
    expect(await activeOn(A, '2026-10-08')).toBe(true)
    expect(await activeOn(A, '2026-10-09')).toBe(false)
  })

  it('reopens the same period when turned back on the day it was turned off', async () => {
    await enableNutrition(db, A)
    await setClock(db, '2026-10-09T15:00:00Z')
    await enableNutrition(db, A, false)
    await enableNutrition(db, A)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
  })

  it('covers no day when turned on and off on the same day', async () => {
    await enableNutrition(db, A)
    await enableNutrition(db, A, false)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: '2026-10-06' }])
    expect(await activeOn(A, '2026-10-07')).toBe(false)
  })

  it('opens a period for a profile created with the pillar on', async () => {
    await makeUser(db, B, { nutrition_enabled: true })
    expect(await periods(B)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
  })

  it('starts a new period after a gap', async () => {
    await setClock(db, '2026-10-01T15:00:00Z')
    await enableNutrition(db, A)
    await setClock(db, '2026-10-03T15:00:00Z')
    await enableNutrition(db, A, false)
    await setClock(db, '2026-10-10T15:00:00Z')
    await enableNutrition(db, A)
    expect(await periods(A)).toEqual([
      { started_on: '2026-10-01', ended_on: '2026-10-02' },
      { started_on: '2026-10-10', ended_on: null },
    ])
  })

  it('lets clients read but not write periods', async () => {
    await enableNutrition(db, A)
    const asA = (q: string) => asUser(db, A, () => db.query(q))
    await expect(asA(`insert into public.nutrition_periods (user_id, started_on) values ('${A}', '2026-01-01')`))
      .rejects.toThrow(/permission denied/)
    await expect(asA('update public.nutrition_periods set ended_on = null')).rejects.toThrow(/permission denied/)
    await expect(asA('delete from public.nutrition_periods')).rejects.toThrow(/permission denied/)
    await makeUser(db, B)
    const seen = await asUser(db, B, () => db.query('select * from public.nutrition_periods'))
    expect(seen.rows).toEqual([])
    const own = await asUser(db, A, () => db.query('select * from public.nutrition_periods'))
    expect(own.rows).toHaveLength(1)
  })
})

describe('server-only event kinds', () => {
  it('refuses server-only kinds from clients, whatever they set', async () => {
    const today = await realToday()
    await expect(asUser(db, A, () => insertKind('day_logged', today))).rejects.toThrow(/row-level security/)
    await expect(asUser(db, A, async () => {
      await db.exec('begin')
      try {
        await db.query(`select set_config('perf.server_write', 'on', true)`)
        await insertKind('day_logged', today)
      } finally {
        await db.exec('rollback')
      }
    })).rejects.toThrow(/row-level security/)
  })

  it('accepts server-only kinds from the server outside the window', async () => {
    await insertKind('day_on_target', '2026-09-01')
    const r = await sql(db, `select kind, to_char(occurred_on, 'YYYY-MM-DD') as d from public.activity_events where user_id = $1`, [A])
    expect(r).toEqual([{ kind: 'day_on_target', d: '2026-09-01' }])
    // award_xp ran: the first day on target of the week (default T = 5) pays 600 / 5.
    expect((await ledger(db, A)).filter(r => !r.reason.startsWith('achievement:'))).toEqual([
      { reason: 'nutrition_day', amount: 120, week_start: '2026-08-31', pillar: 'nutrition' },
    ])
  })

  it('still accepts strength events from clients', async () => {
    const today = await realToday()
    await asUser(db, A, () => db.query(
      `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
       values ($1, 'strength', 'workout_completed', $2, 'w1')`, [A, today]))
    expect(await sql(db, 'select 1 from public.activity_events')).toHaveLength(1)
  })
})

describe('profile columns', () => {
  it('checks the new profile columns', async () => {
    await expect(sql(db, 'update public.profiles set nutrition_days_per_week = 2 where id = $1', [A])).rejects.toThrow(/check/)
    await expect(sql(db, `update public.profiles set activity_level = 'x' where id = $1`, [A])).rejects.toThrow(/check/)
    await expect(sql(db, `update public.profiles set nutrition_pace = 'x' where id = $1`, [A])).rejects.toThrow(/check/)
  })
})
