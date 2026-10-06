import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { C, D, befriend, createChallenge, one, rows } from './helpers/social'
import { addCheckin } from './helpers/checkin'

let db: PGlite
const as = (uid: string, q: string, p: unknown[] = []) => asUser(db, uid, () => db.query(q, p))
const react = (uid: string, id: string, emoji: string, on = true) =>
  as(uid, 'select public.react_checkin($1, $2, $3)', [id, emoji, on])
const comment = (uid: string, id: string, body: string) =>
  one<number>(db, uid, 'select public.comment_checkin($1, $2) as v', [id, body])
const delComment = (uid: string, id: number) => as(uid, 'select public.delete_comment($1)', [id])
const getCheckin = (uid: string, id: string) => one<any>(db, uid, 'select public.get_checkin($1) as v', [id])
const notices = (uid: string, limit?: number) => limit === undefined
  ? one<any>(db, uid, 'select public.get_notices() as v')
  : one<any>(db, uid, 'select public.get_notices($1) as v', [limit])
const reactions = (id: string) => sql<{ user_id: string; emoji: string }>(db,
  'select user_id, emoji from public.checkin_reactions where checkin_id = $1 order by user_id, emoji', [id])
const EMOJIS = ['💪', '🔥', '👏', '😂', '😮', '❤️', '🙌', '🚀', '⭐', '🏆', '🥇']

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('reactions', () => {
  it('lets a friend react to a post for friends and the owner react to their own', async () => {
    const id = await addCheckin(db, A)
    await react(B, id, '💪')
    await react(A, id, '🔥')
    expect(await reactions(id)).toEqual([{ user_id: A, emoji: '🔥' }, { user_id: B, emoji: '💪' }])
  })

  it("refuses another person's private post and a post of someone who is not a friend", async () => {
    const priv = await addCheckin(db, A, { visibility: 'private' })
    await expect(react(B, priv, '💪')).rejects.toThrow(/not_found/)
    await makeUser(db, D, { display_name: 'Duda' })
    const open = await addCheckin(db, A)
    await expect(react(D, open, '💪')).rejects.toThrow(/not_found/)
    expect(await reactions(priv)).toEqual([])
    expect(await reactions(open)).toEqual([])
  })

  it('refuses a direct insert on a post the person cannot see', async () => {
    const priv = await addCheckin(db, A, { visibility: 'private' })
    await expect(as(B, `insert into public.checkin_reactions (checkin_id, emoji) values ($1, '💪')`, [priv]))
      .rejects.toThrow(/row-level security/)
  })

  it('keeps the same emoji once per person', async () => {
    const id = await addCheckin(db, A)
    await react(B, id, '💪')
    await react(B, id, '💪')
    expect(await reactions(id)).toEqual([{ user_id: B, emoji: '💪' }])
  })

  it('takes up to 10 different emojis per person and post', async () => {
    const id = await addCheckin(db, A)
    for (const e of EMOJIS.slice(0, 10)) await react(B, id, e)
    await expect(react(B, id, EMOJIS[10])).rejects.toThrow(/too_many_reactions/)
    await react(B, id, EMOJIS[0])              // one already there is not an 11th
    await react(C, id, EMOJIS[10])             // the limit is per person
    expect((await reactions(id)).length).toBe(11)
  })

  it('checks the emoji size in bytes', async () => {
    const id = await addCheckin(db, A)
    await expect(react(B, id, 'a'.repeat(17))).rejects.toThrow(/invalid_emoji/)
    await expect(react(B, id, '')).rejects.toThrow(/invalid_emoji/)
    await react(B, id, 'a'.repeat(16))
  })

  it('removes only the own reaction', async () => {
    const id = await addCheckin(db, A)
    await react(B, id, '💪')
    await react(C, id, '💪')
    await react(B, id, '💪', false)
    expect(await reactions(id)).toEqual([{ user_id: C, emoji: '💪' }])
    await as(B, 'delete from public.checkin_reactions where checkin_id = $1', [id])
    expect(await reactions(id)).toEqual([{ user_id: C, emoji: '💪' }])
  })
})

describe('comments', () => {
  it('lets a friend and the owner comment on a visible post', async () => {
    const id = await addCheckin(db, A)
    const c1 = await comment(B, id, '  Boa!  ')
    const c2 = await comment(A, id, 'Valeu')
    expect(c2).toBeGreaterThan(c1)
    expect(await sql(db, 'select user_id, body from public.checkin_comments where checkin_id = $1 order by id', [id]))
      .toEqual([{ user_id: B, body: 'Boa!' }, { user_id: A, body: 'Valeu' }])
  })

  it('refuses a private post of someone else and a post of someone who is not a friend', async () => {
    const priv = await addCheckin(db, A, { visibility: 'private' })
    await expect(comment(B, priv, 'Oi')).rejects.toThrow(/not_found/)
    await makeUser(db, D, { display_name: 'Duda' })
    const open = await addCheckin(db, A)
    await expect(comment(D, open, 'Oi')).rejects.toThrow(/not_found/)
    await expect(as(D, `insert into public.checkin_comments (checkin_id, body) values ($1, 'Oi')`, [open]))
      .rejects.toThrow(/row-level security/)
  })

  it('takes 1 to 500 characters', async () => {
    const id = await addCheckin(db, A)
    await expect(comment(B, id, '')).rejects.toThrow(/invalid_comment/)
    await expect(comment(B, id, '   ')).rejects.toThrow(/invalid_comment/)
    await expect(comment(B, id, 'x'.repeat(501))).rejects.toThrow(/invalid_comment/)
    await comment(B, id, 'x'.repeat(500))
  })

  it('is deleted by its author or the post owner, never by a third person', async () => {
    const id = await addCheckin(db, A)
    const byB = await comment(B, id, 'Da Bia')
    const byC = await comment(C, id, 'Do Caio')
    const byC2 = await comment(C, id, 'Outro do Caio')
    await expect(delComment(B, byC)).rejects.toThrow(/not_found/)
    await as(B, 'delete from public.checkin_comments where id = $1', [byC])   // RLS: no row for Bia
    await delComment(C, byC)        // author
    await delComment(A, byB)        // post owner
    await as(A, 'delete from public.checkin_comments where id = $1', [byC2])
    expect(await sql(db, 'select id from public.checkin_comments')).toEqual([])
  })
})

describe('get_checkin', () => {
  it('never gives a friend the note or the detail', async () => {
    const id = await addCheckin(db, A, { note: 'joelho doendo', detail: { entries: [] } })
    await react(B, id, '💪')
    await react(C, id, '💪')
    await react(B, id, '🔥')
    const cid = await comment(C, id, 'Boa')
    const post = await getCheckin(B, id)
    expect(post).not.toHaveProperty('note')
    expect(post).not.toHaveProperty('detail')
    expect(JSON.stringify(post)).not.toContain('joelho')
    expect(post).toMatchObject({
      id, user: { id: A, name: 'Ana', avatar_url: null }, day: '2026-10-07', activity: 'strength',
      title: 'Treino', visibility: 'friends', photo_path: `${A}/${id}.jpg`,
      reactions: [{ emoji: '💪', count: 2, mine: true }, { emoji: '🔥', count: 1, mine: true }],
      comments: [{ id: cid, user: { id: C, name: 'Caio' }, body: 'Boa', can_delete: false }],
    })
    const asC = await getCheckin(C, id)
    expect(asC.reactions).toMatchObject([{ emoji: '💪', count: 2, mine: true }, { emoji: '🔥', count: 1, mine: false }])
    expect(asC.comments[0].can_delete).toBe(true)
  })

  it('gives the owner the note and the detail', async () => {
    const id = await addCheckin(db, A, { note: 'joelho doendo', detail: { entries: [] } })
    await comment(B, id, 'Boa')
    const post = await getCheckin(A, id)
    expect(post).toMatchObject({ note: 'joelho doendo', detail: { entries: [] } })
    expect(post.comments[0].can_delete).toBe(true)
  })

  it('answers not_found for a private post, a stranger, and a missing id', async () => {
    const priv = await addCheckin(db, A, { visibility: 'private', note: 'segredo' })
    await expect(getCheckin(B, priv)).rejects.toThrow(/not_found/)
    expect(await getCheckin(A, priv)).toMatchObject({ visibility: 'private', note: 'segredo' })
    await makeUser(db, D, { display_name: 'Duda' })
    const open = await addCheckin(db, A)
    await expect(getCheckin(D, open)).rejects.toThrow(/not_found/)
    await expect(getCheckin(B, '00000000-0000-4000-8000-000000000999')).rejects.toThrow(/not_found/)
  })

  it('cuts access when the friendship ends', async () => {
    const id = await addCheckin(db, A)
    await getCheckin(B, id)
    await sql(db, 'delete from public.friendships where $1 in (user_a, user_b) and $2 in (user_a, user_b)', [A, B])
    await expect(getCheckin(B, id)).rejects.toThrow(/not_found/)
    await expect(react(B, id, '💪')).rejects.toThrow(/not_found/)
  })
})

describe('notices', () => {
  it('tells the post owner about reactions and comments, never about their own', async () => {
    const id = await addCheckin(db, A)
    await react(A, id, '💪')
    await comment(A, id, 'Meu')
    expect((await notices(A)).items).toEqual([])
    await react(B, id, '🔥')
    await react(B, id, '🔥')          // already there: no second notice
    await comment(C, id, 'Boa')
    const n = await notices(A)
    expect(n.unread).toBe(2)
    expect(n.items).toMatchObject([
      { kind: 'comment', actor: { id: C, name: 'Caio' }, checkin_id: id, read: false },
      { kind: 'reaction', actor: { id: B, name: 'Bia' }, checkin_id: id, read: false },
    ])
    expect((await notices(B)).items).toEqual([])
    expect((await notices(C)).items).toEqual([])
  })

  it('tells each invited friend about a challenge invite, not the creator', async () => {
    const chal = await createChallenge(db, A, { invitees: [B, C], starts_on: '2026-10-08', ends_on: '2026-10-21' })
    for (const u of [B, C]) {
      expect((await notices(u)).items).toMatchObject([
        { kind: 'challenge_invite', actor: { id: A, name: 'Ana' }, challenge_id: chal, read: false }])
    }
    expect((await notices(A)).items).toEqual([])
  })

  it('marks only the own notices as read, up to the given id', async () => {
    const id = await addCheckin(db, A)
    await react(B, id, '💪')
    await react(B, id, '🔥')
    const bid = await addCheckin(db, B)
    await react(A, bid, '💪')
    const [newer, older] = (await notices(A)).items
    await as(A, 'select public.mark_notices_read($1)', [older.id])
    let n = await notices(A)
    expect(n.unread).toBe(1)
    expect(n.items.map((x: any) => x.read)).toEqual([false, true])
    // Bia passes an id far above all of them: only hers are touched.
    await as(B, 'select public.mark_notices_read($1)', [newer.id + 1000])
    n = await notices(A)
    expect(n.unread).toBe(1)
    expect((await notices(B)).unread).toBe(0)
    // Nor can she reach them straight through the table.
    await as(B, 'update public.social_notices set read_at = now() where user_id = $1', [A])
    expect((await notices(A)).unread).toBe(1)
    expect(await rows(db, B, 'select id from public.social_notices where user_id = $1', [A])).toEqual([])
    await expect(as(B, `insert into public.social_notices (user_id, actor_id, kind) values ($1, $2, 'reaction')`, [A, B]))
      .rejects.toThrow(/permission denied/)
  })

  it('caps the list at the limit, newest first', async () => {
    const id = await addCheckin(db, A)
    for (const e of EMOJIS.slice(0, 5)) await react(B, id, e)
    const n = await notices(A, 3)
    expect(n.items.length).toBe(3)
    expect(n.unread).toBe(5)
    expect(n.items[0].id).toBeGreaterThan(n.items[1].id)
  })

  it('go away with the post', async () => {
    const id = await addCheckin(db, A)
    await react(B, id, '💪')
    await comment(B, id, 'Boa')
    await as(A, 'delete from public.checkins where id = $1', [id])
    expect((await notices(A)).items).toEqual([])
    expect(await sql(db, 'select 1 from public.checkin_reactions union all select 1 from public.checkin_comments'))
      .toEqual([])
  })
})

describe('privileges', () => {
  it('keeps the RPCs away from anon', async () => {
    const id = await addCheckin(db, A)
    await expect(asUser(db, null, () => db.query('select public.get_checkin($1)', [id])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, () => db.query('select public.get_notices()')))
      .rejects.toThrow(/permission denied/)
  })
})
