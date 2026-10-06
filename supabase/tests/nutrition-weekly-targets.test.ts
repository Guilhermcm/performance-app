import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { befriend, one } from './helpers/social'

let db: PGlite
const target = async (uid: string, week: string, pillar?: string) =>
  (await sql<{ v: number }>(db,
    pillar ? 'select public.week_target_for($1, $2, $3) as v' : 'select public.week_target_for($1, $2) as v',
    pillar ? [uid, week, pillar] : [uid, week]))[0].v

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday of the week of 2026-10-05
  await makeUser(db, A)
})

describe('weekly targets per pillar', () => {
  it('freezes each pillar on its own', async () => {
    expect(await target(A, '2026-10-05', 'nutrition')).toBe(5)
    expect(await target(A, '2026-10-05')).toBe(3)
    await sql(db, 'update public.profiles set nutrition_days_per_week = 7 where id = $1', [A])
    expect(await target(A, '2026-10-05', 'nutrition')).toBe(5)
    expect(await target(A, '2026-10-12', 'nutrition')).toBe(7)
    expect(await target(A, '2026-10-05')).toBe(3)
    expect(await target(A, '2026-10-12')).toBe(3)
  })

  it('freezes only the pillar whose column changed', async () => {
    await sql(db, 'update public.profiles set days_per_week = 4 where id = $1', [A])
    const rows = await sql(db, `select pillar::text as pillar, target from public.weekly_targets where user_id = $1`, [A])
    expect(rows).toEqual([{ pillar: 'strength', target: 3 }])
  })

  it('falls back to the profile column of the pillar', async () => {
    await sql(db, 'update public.profiles set nutrition_days_per_week = 6 where id = $1', [A])
    await sql(db, 'delete from public.weekly_targets where user_id = $1', [A])
    expect(await target(A, '2026-09-21', 'nutrition')).toBe(6)
    expect(await target(A, '2026-09-21')).toBe(3)
  })

  it('keeps progress_card and get_friends working with two rows in a week', async () => {
    await makeUser(db, B)
    await befriend(db, A, B)
    await sql(db, `insert into public.weekly_targets (user_id, week_start, target, pillar)
                   values ($1, '2026-10-05', 3, 'strength'), ($1, '2026-10-05', 5, 'nutrition')`, [A])
    const card = (await sql<{ v: any }>(db, 'select public.progress_card($1) as v', [A]))[0].v
    expect(card.week.target).toBe(3)
    const friends = await one<any[]>(db, B, 'select public.get_friends() as v')
    expect(friends).toHaveLength(1)
  })

  it('leaves a single week_target_for', async () => {
    const [{ n }] = await sql<{ n: number }>(db, `select count(*)::int as n from pg_proc where proname = 'week_target_for'`)
    expect(n).toBe(1)
    await expect(asUser(db, A, () => db.query(`select public.week_target_for($1, '2026-10-05', 'nutrition')`, [A])))
      .rejects.toThrow(/permission denied/)
  })
})
