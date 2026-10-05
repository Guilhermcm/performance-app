import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import { C, befriend, createChallenge, one, rows } from './helpers/social'

let db: PGlite
const remove = (uid: string | null) => rows(db, uid, 'select public.delete_my_account()')
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const join = (uid: string, id: string) => rows(db, uid, 'select public.join_challenge($1, false)', [id])
const challenge = async (id: string) =>
  (await sql<{ status: string; created_by: string | null; timezone: string | null }>(db,
    'select status, created_by, timezone from public.challenges where id = $1', [id]))[0]

// Every uuid column of every table in public, so a table added later is checked too.
async function rowsPointingAt(uid: string) {
  const cols = await sql<{ t: string; c: string }>(db,
    `select table_name as t, column_name as c from information_schema.columns
      where table_schema = 'public' and data_type = 'uuid' order by 1, 2`)
  const hits: string[] = []
  for (const { t, c } of cols) {
    const [{ n }] = await sql<{ n: number }>(db, `select count(*)::int as n from public.${t} where ${c} = $1`, [uid])
    if (n) hits.push(`${t}.${c}: ${n}`)
  }
  return { hits, tables: new Set(cols.map(x => x.t)) }
}

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T10:00:00Z')   // the 5th both in Tokyo and in São Paulo
  await makeUser(db, A, { display_name: 'Ana', timezone: 'Asia/Tokyo', share_activity: true })
  await makeUser(db, B, { display_name: 'Bia', share_activity: true })
  await makeUser(db, C, { display_name: 'Caio' })
  await befriend(db, A, C)
  await befriend(db, B, C)
  // Ana and Bia become friends through invites both ways (inviter_id and used_by).
  const fromA = await one<{ code: string }>(db, A, 'select public.create_invite() as v')
  await one(db, B, 'select public.accept_invite($1) as v', [fromA.code])
  await sql(db, 'delete from public.friendships where user_a = $1 and user_b = $2', [A, B])
  const fromB = await one<{ code: string }>(db, B, 'select public.create_invite() as v')
  await one(db, A, 'select public.accept_invite($1) as v', [fromB.code])
  await one(db, A, 'select public.create_invite() as v')   // still open
  // Ana trains, syncs and earns XP, a streak, a weekly target and a badge.
  await rows(db, A, 'select public.push_state($1::jsonb, 0)', [JSON.stringify({ workouts: [] })])
  await event(db, A, 'workout_completed', '2026-10-05', 'a1')
  await event(db, A, 'workout_completed', '2026-10-06', 'a2')
  await event(db, B, 'workout_completed', '2026-10-06', 'b1')
  await one(db, A, 'select public.get_my_progress() as v')
  await sql(db, `insert into public.weekly_targets (user_id, week_start, target) values ($1, '2026-09-28', 3) on conflict do nothing`, [A])
  await sql(db, `insert into public.streaks (user_id, kind, current, best) values ($1, 'training_week', 1, 1) on conflict do nothing`, [A])
})

describe('delete_my_account', () => {
  it('leaves no row about the person in any public table', async () => {
    const mine = await createChallenge(db, A, { invitees: [B, C] })
    await join(B, mine)
    const theirs = await createChallenge(db, B, { invitees: [A, C] })
    await join(A, theirs)
    const before = await rowsPointingAt(A)
    // The setup reaches every table that can hold the person.
    for (const t of ['profiles', 'app_state', 'activity_events', 'weekly_targets', 'xp_ledger', 'streaks',
      'user_achievements', 'friend_invites', 'friendships', 'challenges', 'challenge_members']) {
      expect(before.tables.has(t)).toBe(true)
      expect(before.hits.some(h => h.startsWith(t + '.'))).toBe(true)
    }

    await remove(A)

    expect((await rowsPointingAt(A)).hits).toEqual([])
    expect(await sql(db, 'select 1 from auth.users where id = $1', [A])).toEqual([])
    // Nobody else lost anything.
    expect(await sql(db, 'select 1 from public.profiles where id in ($1, $2)', [B, C])).toHaveLength(2)
    expect((await ledger(db, B)).length).toBeGreaterThan(0)
  })

  it('ends the friendships, and friends no longer see the person anywhere', async () => {
    await remove(A)
    expect(await sql(db, 'select * from public.friendships where $1 in (user_a, user_b)', [A])).toEqual([])
    const friends = await one<any[]>(db, B, 'select public.get_friends() as v')
    expect(friends.map((f: any) => f.id)).toEqual([C])
    for (const fn of ['get_friends', 'get_feed', 'get_weekly_leaderboard', 'get_alltime_leaderboard']) {
      for (const who of [B, C]) expect(JSON.stringify(await one(db, who, `select public.${fn}() as v`))).not.toContain(A)
    }
  })

  it('keeps a challenge the person created for the others, in the creator\'s time zone', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C], target: 2 })
    await join(B, id)
    await join(C, id)
    await remove(A)

    expect(await challenge(id)).toEqual({ status: 'active', created_by: null, timezone: 'Asia/Tokyo' })
    const [c] = await list(B)
    expect(c).toMatchObject({ id, status: 'active', created_by: null, me: { joined: true } })
    expect(c.members.map((m: any) => m.name)).toEqual(['Bia', 'Caio'])
    expect(c.total).toBe(1)

    // 18 Oct, 16:00 UTC: already the 19th in Tokyo, still the 18th in São Paulo.
    await setClock(db, '2026-10-18T16:00:00Z')
    await event(db, C, 'workout_completed', '2026-10-07', 'c1')
    expect((await list(C))[0]).toMatchObject({ id, status: 'won', total: 2, me: { won: true } })
    expect((await ledger(db, B)).filter(r => r.reason === 'challenge:' + id).map(r => r.amount)).toEqual([300])
  })

  it('cancels at the end a challenge left with one participant', async () => {
    const id = await createChallenge(db, A, { invitees: [B] })
    await join(B, id)
    await remove(A)
    expect((await list(B))[0]).toMatchObject({ id, status: 'active' })
    await setClock(db, '2026-10-19T15:00:00Z')
    expect((await list(B))[0]).toMatchObject({ id, status: 'cancelled' })
    expect((await ledger(db, B)).filter(r => r.reason.startsWith('challenge:'))).toEqual([])
  })

  it('removes a challenge nobody else joined', async () => {
    const id = await createChallenge(db, A, { invitees: [B] })
    await remove(A)
    expect(await challenge(id)).toBeUndefined()
    expect(await list(B)).toEqual([])
  })

  it('keeps working a challenge someone else created with the person in it', async () => {
    const id = await createChallenge(db, B, { invitees: [A, C], target: 2 })
    await join(A, id)
    await join(C, id)
    await remove(A)

    expect(await challenge(id)).toMatchObject({ status: 'active', created_by: B })
    const [c] = await list(B)
    expect(c.members.map((m: any) => m.name)).toEqual(['Bia', 'Caio'])
    await event(db, C, 'workout_completed', '2026-10-07', 'c1')
    await setClock(db, '2026-10-19T15:00:00Z')
    expect((await list(B))[0]).toMatchObject({ id, status: 'won', total: 2 })
  })

  it('needs a session', async () => {
    await expect(remove(null)).rejects.toThrow(/permission denied/)
    expect(await sql(db, 'select 1 from public.profiles where id = $1', [A])).toHaveLength(1)
  })

  it('only ever deletes the caller', async () => {
    await expect(rows(db, B, 'delete from auth.users where id = $1', [A])).rejects.toThrow(/permission denied/)
    await rows(db, B, 'delete from public.profiles where id = $1', [A])
    await expect(rows(db, B, 'select public.delete_my_account($1)', [A])).rejects.toThrow(/function .* does not exist/)
    expect(await sql(db, 'select 1 from public.profiles where id = $1', [A])).toHaveLength(1)

    await remove(B)
    expect(await sql(db, 'select 1 from auth.users where id = $1', [A])).toHaveLength(1)
    expect(await sql(db, 'select 1 from public.profiles where id = $1', [A])).toHaveLength(1)
    expect(await sql(db, 'select 1 from auth.users where id = $1', [B])).toEqual([])
  })
})
