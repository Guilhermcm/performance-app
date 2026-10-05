import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'

let db: PGlite
const friends = (uid: string) => one<any[]>(db, uid, 'select public.get_friends() as v')

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, week of 2026-10-05
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, {
    display_name: 'Bia', avatar_url: 'https://img.test/bia.png', weight_kg: 83.4, height_cm: 181.5,
    birth_date: '1990-04-12', sex: 'female', share_activity: true
  })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  await event(db, B, 'workout_completed', '2026-10-05', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
  await event(db, B, 'pr', '2026-10-05', 'b1:0025', { ex: '0025' })
  await event(db, B, 'weight_logged', '2026-10-06', '2026-10-06', { w: 83.4 })
  await sql(db, `insert into public.app_state (user_id, data) values ($1, '{"bodyweight":[{"w":83.4}]}')`, [B])
})

describe('get_friends', () => {
  it('lists friends by name with the public card', async () => {
    const list = await friends(A)
    expect(list.map(f => f.name)).toEqual(['Bia', 'Caio'])
    const bia = list[0]
    expect(Object.keys(bia).sort()).toEqual(['avatar_url', 'card', 'id', 'name', 'shares_activity', 'since'])
    expect(bia).toMatchObject({ id: B, avatar_url: 'https://img.test/bia.png', shares_activity: true })
    expect(Object.keys(bia.card).sort()).toEqual(['achievements', 'level', 'pillars', 'streak', 'total_xp', 'week'])
    expect(bia.card.week).toMatchObject({ start: '2026-10-05', workouts: 1, prs: 1, target: 3 })
    expect(bia.card.achievements.map((a: { code: string }) => a.code).sort()).toEqual(['first_friend', 'first_pr', 'first_workout'])
  })

  it('never carries weight, body, diet or loads', async () => {
    const text = JSON.stringify(await friends(A))
    for (const leak of ['83.4', '181.5', '1990', 'female', '12345', 'weight', 'height', 'birth', 'vol', 'payload', 'bodyweight', 'weighed_today', 'stats']) {
      expect(text, leak).not.toContain(leak)
    }
  })

  it('shows nothing to someone who is not a friend', async () => {
    expect(await friends(D)).toEqual([])
  })

  it('keeps every private table closed between friends', async () => {
    for (const table of ['profiles', 'app_state', 'activity_events', 'xp_ledger', 'user_achievements', 'streaks', 'weekly_targets']) {
      const col = table === 'profiles' ? 'id' : 'user_id'
      expect(await rows(db, A, `select * from public.${table} where ${col} = $1`, [B]), table).toEqual([])
    }
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_friends()')).rejects.toThrow(/permission denied/)
  })
})
