import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'

let db: PGlite

beforeEach(async () => {
  db = await freshDb()
  await makeUser(db, A)
  await makeUser(db, B, { days_per_week: 4, timezone: 'Asia/Tokyo' })
})

describe('levels', () => {
  it.each([
    [0, 1, 0, 100], [99, 1, 99, 100], [100, 2, 0, 150], [250, 3, 0, 200], [2700, 10, 0, 550]
  ])('level_for(%i)', async (xp, level, into, need) => {
    const [r] = await sql(db, 'select level, into_level, need from public.level_for($1)', [xp])
    expect(r).toEqual({ level, into_level: into, need })
  })

  it('level_json uses the keys the app reads', async () => {
    const [r] = await sql(db, 'select public.level_json(260) as j')
    expect(r.j).toEqual({ level: 3, into: 10, need: 200 })
  })
})

describe('planned sessions', () => {
  it('add up to exactly 600 for every weekly target', async () => {
    for (let t = 1; t <= 7; t++) {
      const [r] = await sql<{ total: number }>(db, 'select sum(public.session_xp($1, k))::int as total from generate_series(1, $1) k', [t])
      expect(r.total, `T=${t}`).toBe(600)
    }
    const [seven] = await sql(db, 'select public.session_xp(7, 1) as first, public.session_xp(7, 7) as last')
    expect(seven).toEqual({ first: 86, last: 84 })
  })
})

describe('weeks', () => {
  it('start on Monday', async () => {
    const rows = await sql<{ w: string }>(db,
      `select to_char(public.week_start_of(d::date), 'YYYY-MM-DD') as w
         from unnest(array['2026-10-05', '2026-10-11', '2026-10-12']) d`)
    expect(rows.map(r => r.w)).toEqual(['2026-10-05', '2026-10-05', '2026-10-12'])
  })

  it('follow the profile time zone', async () => {
    // Sunday 23:30 UTC: still Sunday in São Paulo, already Monday in Tokyo.
    await setClock(db, '2026-10-04T23:30:00Z')
    const [r] = await sql(db,
      `select to_char(public.local_week_start($1), 'YYYY-MM-DD') as a, to_char(public.local_week_start($2), 'YYYY-MM-DD') as b`, [A, B])
    expect(r).toEqual({ a: '2026-09-28', b: '2026-10-05' })
  })

  it('ignore the test clock outside a superuser session', async () => {
    await setClock(db, '2000-01-01T00:00:00Z')
    await db.exec('set session authorization authenticated')
    try {
      const [r] = await sql<{ y: number }>(db, 'select extract(year from public.app_now())::int as y')
      expect(r.y).toBeGreaterThan(2000)
    } finally {
      await db.exec('reset session authorization')
      await setClock(db, null)
    }
  })
})

describe('weekly targets', () => {
  beforeEach(() => setClock(db, '2026-10-07T15:00:00Z'))

  it('freeze the profile value for the week; a change applies next week', async () => {
    const [r] = await sql(db, `select public.week_target_for($1, '2026-10-05') as t`, [A])
    expect(r.t).toBe(3)
    await asUser(db, A, () => db.query('update public.profiles set days_per_week = 5'))
    const [again] = await sql(db, `select public.week_target_for($1, '2026-10-05') as t`, [A])
    expect(again.t).toBe(3)
    const [next] = await sql(db, `select public.week_target_for($1, '2026-10-12') as t`, [A])
    expect(next.t).toBe(5)
  })

  it('keep the old value when the profile changes before anything touched the week', async () => {
    await asUser(db, B, () => db.query('update public.profiles set days_per_week = 2'))
    const rows = await sql(db,
      `select to_char(week_start, 'YYYY-MM-DD') as w, target from public.weekly_targets where user_id = $1`, [B])
    expect(rows).toEqual([{ w: '2026-10-05', target: 4 }])
  })

  it('give an untouched past week the value frozen after it', async () => {
    await sql(db, `select public.week_target_for($1, '2026-10-05')`, [A])
    await asUser(db, A, () => db.query('update public.profiles set days_per_week = 6'))
    const [r] = await sql(db, `select public.week_target_for($1, '2026-09-28') as t`, [A])
    expect(r.t).toBe(3)
  })
})

describe('privacy', () => {
  it('lets users read only their own rows and write none', async () => {
    await sql(db, `insert into public.xp_ledger (user_id, pillar, amount, reason, week_start) values ($1, 'strength', 10, 'seed', '2026-10-05')`, [A])
    expect((await asUser(db, A, () => db.query('select amount from public.xp_ledger'))).rows).toEqual([{ amount: 10 }])
    expect((await asUser(db, B, () => db.query('select * from public.xp_ledger'))).rows).toEqual([])
    await expect(asUser(db, A, () => db.query(`insert into public.xp_ledger (user_id, amount, reason, week_start) values ($1, 999, 'cheat', '2026-10-05')`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`insert into public.weekly_targets values ($1, '2026-10-05', 1)`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`insert into public.streaks (user_id, kind, current) values ($1, 'training_week', 99)`, [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`select public.week_target_for($1, '2026-10-05')`, [A]))).rejects.toThrow(/permission denied/)
  })
})
