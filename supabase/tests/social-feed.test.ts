import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql, legacyTraining } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'

let db: PGlite
type Feed = { items: any[]; next: { before: string; before_id: number } | null }
const feed = (uid: string, next: Feed['next'] = null) => next
  ? one<Feed>(db, uid, 'select public.get_feed($1::timestamptz, $2::bigint) as v', [next.before, next.before_id])
  : one<Feed>(db, uid, 'select public.get_feed() as v')

beforeEach(async () => {
  db = await freshDb()
  await legacyTraining(db)   // the workout rules from before check-ins
  await withoutEventWindow(db)
  await setClock(db, '2026-10-07T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia', share_activity: true })
  await makeUser(db, C, { display_name: 'Caio', share_activity: false })
  await makeUser(db, D, { display_name: 'Duda', share_activity: true })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('get_feed', () => {
  it('shows workouts of friends who share, with the PRs of that session', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
    await event(db, B, 'pr', '2026-10-06', 'b1:0025', { ex: '0025' })
    await event(db, B, 'pr', '2026-10-06', 'b1:0032', { ex: '0032' })
    await event(db, B, 'weight_logged', '2026-10-06', '2026-10-06', { w: 83.4 })
    await event(db, C, 'workout_completed', '2026-10-06', 'c1', { sets: 10 })
    await event(db, D, 'workout_completed', '2026-10-06', 'd1', { sets: 12 })
    const { items, next } = await feed(A)
    expect(next).toBeNull()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ day: '2026-10-06', user: { id: B, name: 'Bia', avatar_url: null }, sets: 18, prs: ['0025', '0032'] })
    expect(Object.keys(items[0]).sort()).toEqual(['at', 'day', 'id', 'prs', 'sets', 'user'])
  })

  it('never carries volume, hour or weight', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
    await event(db, B, 'weight_logged', '2026-10-06', '2026-10-06', { w: 83.4 })
    const text = JSON.stringify(await feed(A))
    for (const leak of ['12345', 'vol', 'hour', '83.4', '"w"']) expect(text, leak).not.toContain(leak)
  })

  it('follows the sharing switch at read time', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18 })
    expect((await feed(A)).items).toHaveLength(1)
    await sql(db, 'update public.profiles set share_activity = false where id = $1', [B])
    expect((await feed(A)).items).toEqual([])
  })

  it('shows nothing from people who are not friends', async () => {
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18 })
    expect((await feed(D)).items).toEqual([])
  })

  it('pages by 20, newest first, without repeats', async () => {
    for (let i = 0; i < 25; i++) await event(db, B, 'workout_completed', '2026-10-06', 'w' + i, { sets: i })
    const first = await feed(A)
    expect(first.items).toHaveLength(20)
    expect(first.items[0].sets).toBe(24)
    expect(first.next).not.toBeNull()
    const second = await feed(A, first.next)
    expect(second.items.map((x: { sets: number }) => x.sets)).toEqual([4, 3, 2, 1, 0])
    expect(second.next).toBeNull()
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_feed()')).rejects.toThrow(/permission denied/)
  })
})
