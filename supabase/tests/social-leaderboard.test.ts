import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock } from './helpers/game'
import { C, D, befriend, one, rows, xp } from './helpers/social'

let db: PGlite
const weekly = (uid: string) => one<any>(db, uid, 'select public.get_weekly_leaderboard() as v')
const alltime = (uid: string) => one<any>(db, uid, 'select public.get_alltime_leaderboard() as v')

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, week of 2026-10-05 everywhere below
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio', timezone: 'Asia/Tokyo' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  await xp(db, A, 300, '2026-10-05', 't:a1')
  await xp(db, A, 900, '2026-09-28', 't:a0')
  await xp(db, B, 500, '2026-10-05', 't:b1')
  await xp(db, B, 100, '2026-09-28', 't:b0')
  await xp(db, C, 300, '2026-10-05', 't:c1')
  await xp(db, D, 4999, '2026-10-05', 't:d1')
})

describe('weekly leaderboard', () => {
  it('ranks me and my friends by this week, with last week and the gap', async () => {
    expect(await weekly(A)).toEqual({
      week_start: '2026-10-05',
      rows: [
        { id: B, name: 'Bia', avatar_url: null, me: false, xp: 500, level: 4, pos: 1, prev_pos: 2, gap: null },
        { id: A, name: 'Ana', avatar_url: null, me: true, xp: 300, level: 6, pos: 2, prev_pos: 1, gap: 200 },
        { id: C, name: 'Caio', avatar_url: null, me: false, xp: 300, level: 3, pos: 2, prev_pos: 3, gap: 200 }
      ]
    })
  })

  it('resets each person at Monday 00:00 in their own time zone', async () => {
    await setClock(db, '2026-10-11T16:00:00Z')   // Sunday in São Paulo, Monday 01:00 in Tokyo
    const caio = (await weekly(A)).rows.find((r: { id: string }) => r.id === C)
    expect(caio).toMatchObject({ xp: 0, prev_pos: 2 })
  })

  it('shows only friends, never their friends', async () => {
    expect((await weekly(B)).rows.map((r: { name: string }) => r.name)).toEqual(['Bia', 'Ana'])
    expect((await weekly(D)).rows.map((r: { name: string }) => r.name)).toEqual(['Duda'])
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_weekly_leaderboard()')).rejects.toThrow(/permission denied/)
  })
})

describe('all-time leaderboard', () => {
  it('ranks by total XP, compared with the total before this week', async () => {
    expect((await alltime(A)).rows).toEqual([
      { id: A, name: 'Ana', avatar_url: null, me: true, xp: 1200, level: 6, pos: 1, prev_pos: 1, gap: null },
      { id: B, name: 'Bia', avatar_url: null, me: false, xp: 600, level: 4, pos: 2, prev_pos: 2, gap: 600 },
      { id: C, name: 'Caio', avatar_url: null, me: false, xp: 300, level: 3, pos: 3, prev_pos: 3, gap: 300 }
    ])
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_alltime_leaderboard()')).rejects.toThrow(/permission denied/)
  })
})
