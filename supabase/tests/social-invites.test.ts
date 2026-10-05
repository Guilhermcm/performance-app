import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'

let db: PGlite
type Invite = { code: string; expires_at: string }
const invite = (uid: string) => one<Invite>(db, uid, 'select public.create_invite() as v')
const accept = (uid: string | null, code: string) => one(db, uid, 'select public.accept_invite($1) as v', [code])
const info = (uid: string | null, code: string) => one(db, uid, 'select public.get_invite($1) as v', [code])
const pairs = (uid: string) =>
  sql<{ a: string; b: string }>(db, 'select user_a as a, user_b as b from public.friendships where $1 in (user_a, user_b) order by 1, 2', [uid])

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana', avatar_url: 'https://img.test/ana.png', weight_kg: 61.5 })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
})

describe('create_invite', () => {
  it('gives a 10-character base62 code that expires in 7 days', async () => {
    const r = await invite(A)
    expect(r.code).toMatch(/^[0-9A-Za-z]{10}$/)
    expect(new Date(r.expires_at).toISOString()).toBe('2026-10-12T15:00:00.000Z')
  })

  it('never repeats a code', async () => {
    const codes = new Set<string>()
    for (let i = 0; i < 5; i++) codes.add((await invite(A)).code)
    expect(codes.size).toBe(5)
  })

  it('allows five open invites at a time', async () => {
    for (let i = 0; i < 5; i++) await invite(A)
    await expect(invite(A)).rejects.toThrow('invite_limit')
    await setClock(db, '2026-10-12T15:00:01Z')   // all five expired
    await expect(invite(A)).resolves.toMatchObject({ code: expect.any(String) })
  })

  it('does not count used invites', async () => {
    const first = await invite(A)
    for (let i = 0; i < 4; i++) await invite(A)
    await accept(B, first.code)
    await expect(invite(A)).resolves.toMatchObject({ code: expect.any(String) })
  })

  it('needs a session and a profile', async () => {
    await expect(rows(db, null, 'select public.create_invite()')).rejects.toThrow(/permission denied/)
    await addUser(db, D)
    await expect(invite(D)).rejects.toThrow('no_profile')
  })
})

describe('get_invite', () => {
  it('shows anyone, even without a session, only who invited', async () => {
    const { code, expires_at } = await invite(A)
    expect(await info(null, code)).toEqual({
      status: 'open',
      expires_at,
      inviter: { name: 'Ana', avatar_url: 'https://img.test/ana.png' }
    })
  })

  it('tells the person opening it what state it is in', async () => {
    const { code } = await invite(A)
    expect((await info(A, code)).status).toBe('self')
    expect((await info(B, code)).status).toBe('open')
    await accept(B, code)
    expect((await info(B, code)).status).toBe('already_friends')
    expect((await info(C, code)).status).toBe('used')
    const other = await invite(A)
    await setClock(db, '2026-10-12T15:00:00Z')
    expect((await info(C, other.code)).status).toBe('expired')
  })

  it('answers the same for a malformed and an unknown code', async () => {
    await expect(info(null, 'abc')).rejects.toThrow('invite_not_found')
    await expect(info(null, 'ZZZZZZZZZZ')).rejects.toThrow('invite_not_found')
    await expect(info(null, "x' or '1'='1")).rejects.toThrow('invite_not_found')
  })
})

describe('accept_invite', () => {
  it('makes both people friends and uses the invite', async () => {
    const { code } = await invite(A)
    expect(await accept(B, code)).toEqual({ friend: { id: A, name: 'Ana', avatar_url: 'https://img.test/ana.png' } })
    expect(await pairs(A)).toEqual([{ a: A, b: B }])
    const [row] = await sql(db, 'select used_by, used_at is not null as used from public.friend_invites where code = $1', [code])
    expect(row).toEqual({ used_by: B, used: true })
  })

  it('pays first_friend once to each side and counts friends in the stats', async () => {
    await accept(B, (await invite(A)).code)
    await accept(C, (await invite(A)).code)
    for (const uid of [A, B, C]) {
      expect((await ledger(db, uid)).filter(r => r.reason === 'achievement:first_friend').map(r => r.amount), uid).toEqual([50])
    }
    const p = await one(db, A, 'select public.get_my_progress() as v')
    expect(p.stats.friends).toBe(2)
    expect(p.achievements.map((a: { code: string }) => a.code)).toContain('first_friend')
  })

  it('refuses your own invite', async () => {
    const { code } = await invite(A)
    await expect(accept(A, code)).rejects.toThrow('self_invite')
  })

  it('refuses people who are already friends', async () => {
    await befriend(db, A, B)
    const { code } = await invite(A)
    await expect(accept(B, code)).rejects.toThrow('already_friends')
  })

  it('refuses an invite someone already used', async () => {
    const { code } = await invite(A)
    await accept(B, code)
    await expect(accept(C, code)).rejects.toThrow('invite_used')
  })

  it('refuses an expired invite', async () => {
    const { code } = await invite(A)
    await setClock(db, '2026-10-12T15:00:00Z')
    await expect(accept(B, code)).rejects.toThrow('invite_expired')
  })

  it('refuses an unknown code', async () => {
    await expect(accept(B, 'ZZZZZZZZZZ')).rejects.toThrow('invite_not_found')
  })

  it('needs a session and a profile', async () => {
    const { code } = await invite(A)
    await expect(accept(null, code)).rejects.toThrow(/permission denied/)
    await addUser(db, D)
    await expect(accept(D, code)).rejects.toThrow('no_profile')
  })
})

describe('privacy of invites and friendships', () => {
  it('lets people see and cancel only their own open invites', async () => {
    const open = await invite(A)
    const used = await invite(A)
    await accept(B, used.code)
    expect(await rows(db, A, 'select code from public.friend_invites')).toHaveLength(2)
    expect(await rows(db, B, 'select code from public.friend_invites')).toEqual([])
    await rows(db, B, 'delete from public.friend_invites')
    await rows(db, A, 'delete from public.friend_invites where code = $1', [used.code])
    await rows(db, A, 'delete from public.friend_invites where code = $1', [open.code])
    expect((await sql<{ code: string }>(db, 'select code from public.friend_invites')).map(r => r.code)).toEqual([used.code])
  })

  it('never lets clients write invites or friendships directly', async () => {
    for (const q of [
      `insert into public.friend_invites (code) values ('AAAAAAAAAA')`,
      `update public.friend_invites set used_at = now()`,
      `insert into public.friendships (user_a, user_b) values ('${A}', '${B}')`,
      `update public.friendships set created_at = now()`
    ]) await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
  })

  it('lets either friend end the friendship, and nobody else', async () => {
    await befriend(db, A, B)
    expect(await rows(db, B, 'select user_a from public.friendships')).toHaveLength(1)
    expect(await rows(db, C, 'select user_a from public.friendships')).toEqual([])
    await rows(db, C, 'delete from public.friendships')
    expect(await pairs(A)).toHaveLength(1)
    await rows(db, B, 'delete from public.friendships where user_a = $1 and user_b = $2', [A, B])
    expect(await pairs(A)).toEqual([])
  })

  it('keeps the helpers away from clients', async () => {
    for (const q of [
      `select public.are_friends('${A}', '${B}')`,
      `select public.friend_ids('${A}')`,
      `select public.lock_users(array['${A}'::uuid])`,
      `select public.new_invite_code()`,
      `select public.achievement_stats('${A}')`
    ]) await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
  })
})
