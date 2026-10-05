import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'

let db: PGlite
const BASE = Date.UTC(2026, 5, 1)   // Monday 2026-06-01
const monday = (i: number) => new Date(BASE + i * 7 * 86400000).toISOString().slice(0, 10)
const streak = async (uid = A) =>
  (await sql(db, `select current, best, shields from public.streaks where user_id = $1 and kind = 'training_week'`, [uid]))[0]
const close = (uid = A) => sql(db, 'select public.close_weeks($1)', [uid])
// T = 1, so one session meets a week's goal.
const train = async (weeks: number[], uid = A) => { for (const i of weeks) await event(db, uid, 'workout_completed', monday(i), 'w' + i) }
const clockAfter = (weeks: number) => setClock(db, monday(weeks) + 'T15:00:00Z')

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-06-02T15:00:00Z')
  await makeUser(db, A, { days_per_week: 1 })
  await sql(db, `update public.profiles set created_at = '2026-06-01T15:00:00Z' where id = $1`, [A])
})

describe('close_weeks', () => {
  it('counts closed weeks with the goal met', async () => {
    await train([0, 1, 2])
    await clockAfter(3)
    await close()
    expect(await streak()).toEqual({ current: 3, best: 3, shields: 0 })
  })

  it('never judges the week in progress', async () => {
    await train([0, 1])
    await setClock(db, monday(2) + 'T15:00:00Z')   // week 2 running, nothing trained yet
    await close()
    expect(await streak()).toEqual({ current: 2, best: 2, shields: 0 })
  })

  it('resets on a missed week without a shield', async () => {
    await train([0, 1, 3])
    await clockAfter(4)
    await close()
    expect(await streak()).toEqual({ current: 1, best: 2, shields: 0 })
  })

  it('earns a shield every 4 weeks, two at most', async () => {
    await train([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    await clockAfter(12)
    await close()
    expect(await streak()).toEqual({ current: 12, best: 12, shields: 2 })
  })

  it('spends a shield on a missed week and keeps the streak', async () => {
    await train([0, 1, 2, 3, 5])
    await clockAfter(6)
    await close()
    expect(await streak()).toEqual({ current: 5, best: 5, shields: 0 })
  })

  it('is incremental: a second call changes nothing', async () => {
    await train([0, 1])
    await clockAfter(2)
    await close()
    await close()
    expect(await streak()).toEqual({ current: 2, best: 2, shields: 0 })
  })

  it('closes the week at Monday 00:00 in the profile time zone', async () => {
    await makeUser(db, B, { days_per_week: 1, timezone: 'Asia/Tokyo' })
    await event(db, A, 'workout_completed', '2026-09-28', 'sp')
    await event(db, B, 'workout_completed', '2026-09-28', 'tk')
    await sql(db, `update public.profiles set created_at = '2026-09-28T03:00:00Z'`)
    // Sunday 13:00 in São Paulo, Monday 01:00 in Tokyo.
    await setClock(db, '2026-10-04T16:00:00Z')
    await close(A)
    await close(B)
    expect(await streak(A)).toEqual({ current: 0, best: 0, shields: 0 })
    expect(await streak(B)).toEqual({ current: 1, best: 1, shields: 0 })
  })

  it('replays the streak when a past week meets its goal late', async () => {
    await train([0, 2])
    await clockAfter(3)
    await close()
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0 })
    await event(db, A, 'workout_completed', monday(1), 'late')
    expect(await streak()).toEqual({ current: 3, best: 3, shields: 0 })
  })
})
