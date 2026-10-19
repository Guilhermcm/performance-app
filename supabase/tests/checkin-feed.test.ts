import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'
import { addCheckin } from './helpers/checkin'

// Phase 1c, Task 4 (0020_checkin_feed.sql): the check-in feed, the challenge feed, the training
// days challenge, and the fixes from the review of Tasks 1 to 3 (A to F of the task brief).
// Today is Wednesday 2026-10-07 in Sao Paulo; the cutover is Monday 2026-10-05. Ana and Bia are
// friends, Ana and Caio are friends, Bia and Caio are not, Duda knows nobody.

let db: PGlite

type Next = { before: string; before_key: string } | null
type Feed = { items: any[]; next: Next }

const DETAIL = { entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true }] }] }
// run_type and distance_km since 0032 (null off a run).
const CHECKIN_KEYS = ['activity', 'at', 'caption', 'comments_count', 'context', 'day', 'distance_km', 'duration_min',
  'key', 'photo_path', 'reactions', 'run_type', 'title', 'type', 'user', 'visibility']

const feed = (uid: string | null, next: Next = null) => next
  ? one<Feed>(db, uid, 'select public.get_checkin_feed($1::timestamptz, $2) as v', [next.before, next.before_key])
  : one<Feed>(db, uid, 'select public.get_checkin_feed() as v')
const challengeFeed = (uid: string, id: string, next: Next = null) => next
  ? one<Feed>(db, uid, 'select public.get_challenge_feed($1, $2::timestamptz, $3) as v', [id, next.before, next.before_key])
  : one<Feed>(db, uid, 'select public.get_challenge_feed($1) as v', [id])

// Every page, following next until it ends.
async function allPages(read: (next: Next) => Promise<Feed>): Promise<any[][]> {
  const pages: any[][] = []
  let next: Next = null
  do {
    const page = await read(next)
    pages.push(page.items)
    next = page.next
  } while (next && pages.length < 10)
  return pages
}

// A check-in straight into the table as the owner, so any day and time can be set.
async function post(uid: string, day: string, over: {
  visibility?: 'friends' | 'private'; at?: string; title?: string; detail?: unknown
} = {}): Promise<string> {
  const id = randomUUID()
  await sql(db,
    `insert into public.checkins (id, user_id, day, activity, title, caption, note, duration_min, visibility,
                                  photo_path, detail, created_at)
     values ($1, $2, $3, 'run', $4, 'Legenda publica', 'Nota privada', 45, $5, $6, $7::jsonb,
             coalesce($8::timestamptz, now()))`,
    [id, uid, day, over.title ?? 'Corrida', over.visibility ?? 'friends', `${uid}/${id}.jpg`,
      over.detail === undefined ? null : JSON.stringify(over.detail), over.at ?? null])
  return id
}

const setCutoff = (day: string) =>
  sql(db, `update public.app_settings set value = to_jsonb($1::date) where key = 'training_checkin_since'`, [day])
const closeDays = (uid: string) => sql(db, 'select public.close_training_days($1)', [uid])
const hide = (uid: string, id: string) =>
  asUser(db, uid, () => db.query('insert into public.hidden_checkins (checkin_id) values ($1)', [id]))
const react = (uid: string, id: string, emoji: string, on = true) =>
  asUser(db, uid, () => db.query('select public.react_checkin($1, $2, $3)', [id, emoji, on]))

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-07T15:00:00Z')
  await setCutoff('2026-10-05')
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia', share_activity: true })
  await makeUser(db, C, { display_name: 'Caio', share_activity: true })
  await makeUser(db, D, { display_name: 'Duda', share_activity: true })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('get_checkin_feed', () => {
  it("shows a friend's posts for friends and not their private ones", async () => {
    const open = await post(A, '2026-10-07', { at: '2026-10-07T12:00:00Z' })
    await post(A, '2026-10-07', { visibility: 'private', at: '2026-10-07T13:00:00Z' })
    const { items, next } = await feed(B)
    expect(next).toBeNull()
    expect(items).toHaveLength(1)
    expect(Object.keys(items[0]).sort()).toEqual(CHECKIN_KEYS)
    expect(items[0]).toMatchObject({
      type: 'checkin', key: 'checkin:' + open, day: '2026-10-07',
      user: { id: A, name: 'Ana', avatar_url: null }, activity: 'run', title: 'Corrida', caption: 'Legenda publica',
      duration_min: 45, visibility: 'friends', photo_path: `${A}/${open}.jpg`,
      reactions: [], comments_count: 0,
    })
    expect(new Date(items[0].at).toISOString()).toBe('2026-10-07T12:00:00.000Z')
  })

  it('shows the caller all of their own posts, private ones included, newest first', async () => {
    const open = await post(A, '2026-10-06', { at: '2026-10-06T12:00:00Z' })
    const priv = await post(A, '2026-10-07', { visibility: 'private', at: '2026-10-07T12:00:00Z' })
    const { items } = await feed(A)
    expect(items.map(i => [i.key, i.visibility])).toEqual([['checkin:' + priv, 'private'], ['checkin:' + open, 'friends']])
    expect(items[0].photo_path).toBe(`${A}/${priv}.jpg`)
  })

  it('never carries the private note or the workout detail', async () => {
    await post(A, '2026-10-07', { detail: DETAIL })
    await post(A, '2026-10-07', { visibility: 'private', detail: DETAIL })
    for (const uid of [A, B]) {
      const { items } = await feed(uid)
      for (const item of items) {
        expect(item).not.toHaveProperty('note')
        expect(item).not.toHaveProperty('detail')
      }
      const text = JSON.stringify(items)
      for (const leak of ['Nota privada', 'bench', '"note"', '"detail"']) expect(text, leak).not.toContain(leak)
    }
  })

  it('leaves out a hidden post for the person who hid it only', async () => {
    const id = await post(A, '2026-10-07')
    await hide(B, id)
    expect((await feed(B)).items).toEqual([])
    expect((await feed(C)).items.map(i => i.key)).toEqual(['checkin:' + id])
    expect((await feed(A)).items.map(i => i.key)).toEqual(['checkin:' + id])
  })

  it('drops the posts of a friend at once when the friendship ends', async () => {
    await post(A, '2026-10-07')
    expect((await feed(B)).items).toHaveLength(1)
    await sql(db, 'delete from public.friendships')
    expect((await feed(B)).items).toEqual([])
  })

  it('shows nothing of people who are not friends', async () => {
    await post(A, '2026-10-07')
    await event(db, A, 'workout_completed', '2026-10-01', 'a1', { sets: 10 })
    expect((await feed(D)).items).toEqual([])
  })

  it('shows workouts from before the cutover as the old items, from friends who share', async () => {
    await event(db, B, 'workout_completed', '2026-10-02', 'b1', { sets: 18, vol: 12345.5, hour: 6 })
    await event(db, B, 'pr', '2026-10-02', 'b1:0025', { ex: '0025' })
    await event(db, B, 'workout_completed', '2026-10-06', 'b2', { sets: 12 })   // after the cutover
    await sql(db, 'update public.profiles set share_activity = false where id = $1', [C])
    await event(db, C, 'workout_completed', '2026-10-02', 'c1', { sets: 9 })    // does not share
    const { items } = await feed(A)
    expect(items).toHaveLength(1)
    const [w] = items
    const [{ id }] = await sql<{ id: number }>(db, `select id from public.activity_events where source_ref = 'b1'`)
    expect(Object.keys(w).sort()).toEqual(['at', 'day', 'key', 'prs', 'sets', 'type', 'user'])
    expect(w).toMatchObject({
      type: 'workout', key: 'workout:' + id, day: '2026-10-02', user: { id: B, name: 'Bia' }, sets: 18, prs: ['0025'],
    })
    for (const leak of ['12345', 'vol', 'hour']) expect(JSON.stringify(items), leak).not.toContain(leak)
  })

  it('pages by 20 on the composite key, without repeats or gaps, also when posts arrive between pages', async () => {
    const at = '2026-10-07T12:00:00Z'
    // 13 check-ins and 12 old workouts at the very same instant, so only the key orders them.
    const keys: string[] = []
    for (let i = 0; i < 7; i++) keys.push('checkin:' + await post(A, '2026-10-07', { at }))
    for (let i = 0; i < 6; i++) keys.push('checkin:' + await post(C, '2026-10-06', { at }))
    for (let i = 0; i < 12; i++) await event(db, B, 'workout_completed', '2026-10-01', 'w' + i, { sets: i })
    await sql(db, `update public.activity_events set created_at = $1 where kind = 'workout_completed'`, [at])
    for (const r of await sql<{ id: number }>(db, `select id from public.activity_events where kind = 'workout_completed'`))
      keys.push('workout:' + r.id)

    const first = await feed(A)
    expect(first.items).toHaveLength(20)
    expect(first.next).toEqual({ before: first.items[19].at, before_key: first.items[19].key })
    // A newer post lands between the two pages: the second page carries on where the first stopped.
    await post(A, '2026-10-07', { at: '2026-10-07T14:00:00Z' })
    const second = await feed(A, first.next)
    expect(second.items).toHaveLength(5)
    expect(second.next).toBeNull()
    const seen = [...first.items, ...second.items].map(i => i.key)
    expect(new Set(seen).size).toBe(25)
    expect([...seen].sort()).toEqual([...keys].sort())
    // Newest first, then the key from the highest down.
    expect(seen).toEqual([...keys].sort().reverse())
  })

  it('pages across different times too', async () => {
    for (let i = 0; i < 23; i++) {
      const d = i < 10 ? '2026-10-06' : '2026-10-07'
      await post(i % 2 ? A : B, d, { at: new Date(Date.parse('2026-10-06T10:00:00Z') + i * 60_000).toISOString() })
    }
    const pages = await allPages(n => feed(A, n))
    expect(pages.map(p => p.length)).toEqual([20, 3])
    const times = pages.flat().map(i => Date.parse(i.at))
    expect(times).toEqual([...times].sort((x, y) => y - x))
  })

  it('carries the reactions grouped by emoji and the number of comments', async () => {
    const id = await post(A, '2026-10-07')
    await react(B, id, '💪')
    await react(C, id, '💪')
    await react(C, id, '🔥')
    await asUser(db, B, () => db.query(`select public.comment_checkin($1, 'Boa!')`, [id]))
    const [mine] = (await feed(A)).items
    expect(mine.reactions).toEqual([{ emoji: '💪', count: 2, mine: false }, { emoji: '🔥', count: 1, mine: false }])
    expect(mine.comments_count).toBe(1)
    const [theirs] = (await feed(B)).items
    expect(theirs.reactions).toEqual([{ emoji: '💪', count: 2, mine: true }, { emoji: '🔥', count: 1, mine: false }])
  })

  it('gives each post its context: the training day of the week and the current streak', async () => {
    await sql(db, `insert into public.streaks (user_id, kind, current, best, shields, last_period) values ($1, 'training_week', 4, 6, 1, '2026-09-28')`, [A])
    const mon = await post(A, '2026-10-05', { at: '2026-10-05T12:00:00Z' })
    const tue1 = await post(A, '2026-10-06', { at: '2026-10-06T12:00:00Z', visibility: 'private' })
    const tue2 = await post(A, '2026-10-06', { at: '2026-10-06T13:00:00Z' })
    const lastSun = await post(A, '2026-10-04', { at: '2026-10-04T12:00:00Z' })
    const byKey = Object.fromEntries((await feed(A)).items.map(i => [i.key, i.context]))
    expect(byKey['checkin:' + mon]).toEqual({ week_count: 1, streak: 4 })
    expect(byKey['checkin:' + tue1]).toEqual({ week_count: 2, streak: 4 })
    expect(byKey['checkin:' + tue2]).toEqual({ week_count: 2, streak: 4 })
    expect(byKey['checkin:' + lastSun]).toEqual({ week_count: 1, streak: 4 })
    // A friend sees the same line, the private day still counted.
    const [b] = (await feed(B)).items
    expect(b).toMatchObject({ key: 'checkin:' + tue2, context: { week_count: 2, streak: 4 } })
  })

  it('counts a workout day from before the cutover in the week', async () => {
    await setCutoff('2026-10-06')
    await event(db, A, 'workout_completed', '2026-10-05', 'a1')
    await post(A, '2026-10-06')
    const [item] = (await feed(A)).items
    expect(item.context.week_count).toBe(2)
  })

  it("closes the caller's pending training days, as get_my_progress does", async () => {
    await post(A, '2026-10-05')
    await feed(A)
    expect(await sql(db, `select to_char(day, 'YYYY-MM-DD') as day, checked from public.training_days where user_id = $1`, [A]))
      .toEqual([{ day: '2026-10-05', checked: true }])
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_checkin_feed()')).rejects.toThrow(/permission denied/)
  })

  it('leaves get_feed as it was for the client still out there', async () => {
    await sql(db, 'update public.app_settings set value = $1 where key = $2', ['"2999-12-31"', 'training_checkin_since'])
    await event(db, B, 'workout_completed', '2026-10-06', 'b1', { sets: 18 })
    const old = await one<Feed>(db, A, 'select public.get_feed() as v')
    expect(Object.keys(old.items[0]).sort()).toEqual(['at', 'day', 'id', 'prs', 'sets', 'user'])
  })
})

// Training days challenges ------------------------------------------------------------------------

type ChallengeOver = { template?: string; mode?: string; target?: number; starts_on?: string; ends_on?: string; invitees?: string[] }

const createCh = async (uid: string, over: ChallengeOver = {}): Promise<string> => {
  const a = { template: 'checkin_days', mode: 'team', target: 5, starts_on: '2026-10-07', ends_on: '2026-10-13', invitees: [B], ...over }
  const r = await one<{ id: string }>(db, uid,
    `select public.create_challenge(p_template => $1, p_title => 'Dias de treino', p_mode => $2, p_target => $3::numeric,
            p_starts_on => $4::date, p_ends_on => $5::date, p_invitees => $6::uuid[],
            p_share_volume => false, p_share_nutrition => false) as v`,
    [a.template, a.mode, a.target, a.starts_on, a.ends_on, '{' + a.invitees.join(',') + '}'])
  return r.id
}
const join = (uid: string, id: string) =>
  rows(db, uid, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => false)', [id])
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const progressByName = (c: { members: { name: string; progress: number | null }[] }) =>
  Object.fromEntries(c.members.map(m => [m.name, m.progress]))
const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)
const statusOf = async (id: string) => (await sql<{ status: string }>(db, 'select status from public.challenges where id = $1', [id]))[0].status
const closeAll = async () => (await sql<{ n: number }>(db, 'select public.close_all_challenges() as n'))[0].n

describe('get_challenge_feed', () => {
  it("shows the members' posts in the period, a private one as a bare private check-in", async () => {
    const id = await createCh(A, { invitees: [B, C] })
    await join(B, id)
    const open = await post(A, '2026-10-07', { at: '2026-10-07T12:00:00Z' })
    const priv = await post(A, '2026-10-08', { visibility: 'private', at: '2026-10-08T12:00:00Z' })
    await post(A, '2026-10-06', { at: '2026-10-06T12:00:00Z' })   // before the period
    const bia = await post(B, '2026-10-07', { at: '2026-10-07T13:00:00Z' })
    await post(C, '2026-10-07', { at: '2026-10-07T14:00:00Z' })    // invited, never joined
    await post(D, '2026-10-07')                                      // not a member
    await setClock(db, '2026-10-08T15:00:00Z')

    const { items, next } = await challengeFeed(B, id)
    expect(next).toBeNull()
    expect(items.map(i => i.key)).toEqual(['checkin:' + priv, 'checkin:' + bia, 'checkin:' + open])
    expect(Object.keys(items[0]).sort()).toEqual(['at', 'day', 'key', 'private', 'type', 'user'])
    expect(items[0]).toMatchObject({ type: 'checkin', private: true, day: '2026-10-08', user: { id: A, name: 'Ana' } })
    expect(items[2]).toMatchObject({
      type: 'checkin', private: false, title: 'Corrida', caption: 'Legenda publica', photo_path: `${A}/${open}.jpg`,
    })
    expect(Object.keys(items[2]).sort()).toEqual([...CHECKIN_KEYS, 'private'].sort())
    const text = JSON.stringify(items[0])
    for (const leak of [priv + '.jpg', 'Corrida', 'Legenda', 'Nota privada', 'run']) expect(text, leak).not.toContain(leak)
    expect(JSON.stringify(items)).not.toContain('Nota privada')
  })

  it('shows the owner their own private post in full', async () => {
    const id = await createCh(A)
    await join(B, id)
    const priv = await post(A, '2026-10-07', { visibility: 'private' })
    const [item] = (await challengeFeed(A, id)).items
    expect(item).toMatchObject({ key: 'checkin:' + priv, private: false, visibility: 'private', photo_path: `${A}/${priv}.jpg` })
  })

  it('shows the post of a member who is not my friend as a private check-in', async () => {
    const id = await createCh(A, { invitees: [B, C] })
    await join(B, id)
    await join(C, id)
    const caio = await post(C, '2026-10-07')
    const [item] = (await challengeFeed(B, id)).items
    expect(item).toEqual(expect.objectContaining({ key: 'checkin:' + caio, private: true }))
    expect(item).not.toHaveProperty('photo_path')
    expect(item).not.toHaveProperty('title')
  })

  it('answers challenge_not_found to someone outside the challenge', async () => {
    const id = await createCh(A)
    await expect(challengeFeed(D, id)).rejects.toThrow(/challenge_not_found/)
    await expect(rows(db, null, 'select public.get_challenge_feed($1)', [id])).rejects.toThrow(/permission denied/)
  })

  it('pages by 20 on the composite key', async () => {
    const id = await createCh(A)
    await join(B, id)
    const at = '2026-10-07T12:00:00Z'
    for (let i = 0; i < 10; i++) await post(A, '2026-10-07', { at })
    for (let i = 0; i < 10; i++) await post(A, '2026-10-08', { at, visibility: 'private' })
    for (let i = 0; i < 5; i++) await post(B, '2026-10-08', { at })
    const pages = await allPages(n => challengeFeed(B, id, n))
    expect(pages.map(p => p.length)).toEqual([20, 5])
    const keys = pages.flat().map(i => i.key)
    expect(new Set(keys).size).toBe(25)
    expect(keys).toEqual([...keys].sort().reverse())
  })
})

describe('creating a checkin_days challenge', () => {
  const tryCreate = async (over: ChallengeOver) => {
    try {
      await createCh(A, over)
      return 'ok'
    } catch (e) {
      return (e as Error).message
    } finally {
      await sql(db, 'delete from public.challenges')
    }
  }

  it('takes the limits of workouts_count: team or solo, 7 to 92 days, 1 to 500, 2 to 20 people', async () => {
    for (const mode of ['team', 'solo']) {
      expect(await tryCreate({ mode, target: 1 })).toBe('ok')
      expect(await tryCreate({ mode, target: 500 })).toBe('ok')
      expect(await tryCreate({ mode, target: 501 })).toBe('invalid_challenge')
      expect(await tryCreate({ mode, target: 0 })).toBe('invalid_challenge')
      expect(await tryCreate({ mode, target: 2.5 })).toBe('invalid_challenge')
    }
    expect(await tryCreate({ ends_on: '2026-10-12' })).toBe('invalid_challenge')   // 6 days
    expect(await tryCreate({ ends_on: '2027-01-06' })).toBe('ok')                  // 92 days
    expect(await tryCreate({ ends_on: '2027-01-07' })).toBe('invalid_challenge')   // 93 days
    expect(await tryCreate({ invitees: [] })).toBe('invalid_challenge')
    expect(await tryCreate({ invitees: [D] })).toBe('not_friends')
    expect(await tryCreate({ mode: 'pairs' })).toBe('invalid_challenge')
  })

  it('needs no opt-in and is stored as checkin_days', async () => {
    const id = await createCh(A)
    await join(B, id)
    const [c] = await list(B)
    expect(c).toMatchObject({ id, template: 'checkin_days', mode: 'team', target: 5, me: { joined: true } })
  })
})

describe('training days challenge progress', () => {
  it('counts closed days with a check-in, not posts', async () => {
    const id = await createCh(A)
    await join(B, id)
    await post(A, '2026-10-07')
    await post(A, '2026-10-07', { visibility: 'private' })
    await post(A, '2026-10-08')
    await post(A, '2026-10-06')   // before the period
    await post(B, '2026-10-08')
    // Days count once closed (D+2).
    expect(progressByName((await list(A))[0])).toEqual({ Ana: 0, Bia: 0 })
    await setClock(db, '2026-10-10T15:00:00Z')
    await closeDays(A)
    await closeDays(B)
    const [c] = await list(A)
    expect(progressByName(c)).toEqual({ Ana: 2, Bia: 1 })
    expect(c.total).toBe(3)
  })

  it('makes workouts_count count training days, legacy workout days included', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    await setCutoff('2026-10-07')
    const id = await createCh(A, { template: 'workouts_count', starts_on: '2026-10-05', ends_on: '2026-10-11' })
    await join(B, id)
    await event(db, A, 'workout_completed', '2026-10-05', 'a1')
    await event(db, A, 'workout_completed', '2026-10-05', 'a2')   // same day
    await post(A, '2026-10-06')
    await event(db, A, 'workout_completed', '2026-10-06', 'a3')   // same day as the check-in
    await post(A, '2026-10-08')
    await post(A, '2026-10-08')
    await event(db, A, 'workout_completed', '2026-10-09', 'a4')   // after the cutover: no check-in, no day
    await setClock(db, '2026-10-12T15:00:00Z')
    await closeDays(A)
    expect(progressByName((await list(A))[0])).toMatchObject({ Ana: 3 })
  })

  it('closes at ends_on + 2, after closing the members\' last days, and pays the bonus', async () => {
    const id = await createCh(A, { target: 3, ends_on: '2026-10-13' })
    await join(B, id)
    await post(A, '2026-10-07')
    await post(B, '2026-10-12')
    await post(A, '2026-10-13')   // the last day
    await setClock(db, '2026-10-14T15:00:00Z')   // ends_on + 1
    expect(await closeAll()).toBe(0)
    await setClock(db, '2026-10-16T02:59:00Z')   // 23:59 on ends_on + 2
    expect(await closeAll()).toBe(0)
    expect(await statusOf(id)).toBe('active')
    await setClock(db, '2026-10-16T03:01:00Z')   // 00:01 on ends_on + 3
    expect(await closeAll()).toBe(1)
    expect(await statusOf(id)).toBe('won')
    const [c] = await list(A)
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 2, true], ['Bia', 1, true]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([300])
  })

  it('waits two days for every training template and none for volume', async () => {
    const grace = await sql<{ t: string; g: number }>(db,
      `select t, public.challenge_grace(t) as g
         from unnest(array['checkin_days', 'workouts_count', 'weeks_on_target', 'nutrition_days_on_target', 'volume_total']) t`)
    expect(Object.fromEntries(grace.map(r => [r.t, r.g]))).toEqual({
      checkin_days: 2, workouts_count: 2, weeks_on_target: 2, nutrition_days_on_target: 2, volume_total: 0,
    })
  })
})

// Fixes from the review of Tasks 1 to 3 -------------------------------------------------------------

describe('A: weeks_on_target waits for its last days', () => {
  it('counts a weekly target met on ends_on, in the result and the bonus', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    const id = await createCh(A, { template: 'weeks_on_target', mode: 'solo', target: 2, starts_on: '2026-10-05', ends_on: '2026-10-18' })
    await join(B, id)
    // T = 3 a week; the third day of the second week is Sunday, ends_on.
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-14', '2026-10-18']) await post(A, d)
    await setClock(db, '2026-10-19T15:00:00Z')   // ends_on + 1: the old close day
    await closeDays(A)
    expect(await closeAll()).toBe(0)
    await setClock(db, '2026-10-21T15:00:00Z')   // ends_on + 3, nobody opened the app
    expect(await closeAll()).toBe(1)
    expect(await statusOf(id)).toBe('won')
    const [c] = await list(A)
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 2, true], ['Bia', 0, false]])
    expect(await bonus(A)).toEqual([300])
  })
})

describe('B: the Treino pillar pays at most 960 a week', () => {
  it('pays exactly 960 for a full week after the cutover with PRs and weigh-ins', async () => {
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']) {
      await post(A, d, { detail: DETAIL })
      await event(db, A, 'pr', d, 's' + d + ':bench', { ex: 'bench' })
      await event(db, A, 'weight_logged', d, d, { w: 80 })
    }
    await setClock(db, '2026-10-13T15:00:00Z')
    await closeDays(A)
    const strength = (await ledger(db, A)).filter(r => r.pillar === 'strength')
    expect(strength.filter(r => r.reason === 'pr' || r.reason === 'weight')).toEqual([])
    expect(strength.reduce((s, r) => s + r.amount, 0)).toBe(960)
    // The events are kept and the PR badge still comes.
    expect((await sql(db, `select count(*)::int as n from public.activity_events where user_id = $1 and kind in ('pr', 'weight_logged')`, [A]))[0].n).toBe(14)
    expect((await sql(db, `select code from public.user_achievements where user_id = $1 and code = 'first_pr'`, [A]))).toHaveLength(1)
    const p = await one<any>(db, A, 'select public.get_my_progress() as v')
    expect(p.week.max).toBe(960)
  })

  it('keeps paying PRs and weigh-ins from before the cutover', async () => {
    await event(db, A, 'pr', '2026-10-02', 's1:bench', { ex: 'bench' })
    await event(db, A, 'weight_logged', '2026-10-02', '2026-10-02', { w: 80 })
    expect((await ledger(db, A)).map(r => [r.reason, r.amount])).toEqual(
      expect.arrayContaining([['pr', 30], ['weight', 10]]))
  })
})

describe('C: a training day is counted once in the metrics', () => {
  it('does not add a late workout to a day its check-in already paid', async () => {
    await setCutoff('2026-10-08')
    await post(A, '2026-10-05')
    await closeDays(A)   // 2026-10-05 closes paid by the check-in
    await event(db, A, 'workout_completed', '2026-10-05', 'late')
    await event(db, A, 'workout_completed', '2026-10-04', 'legacy')
    const stats = await one<any>(db, A, 'select public.get_my_progress() as v')
    expect(stats.stats.workouts).toBe(2)
  })
})

describe('D and E: the check-in guard', () => {
  it('refuses a check-in on a day that already closed', async () => {
    await sql(db, `insert into public.training_days (user_id, day, checked, detailed) values ($1, '2026-10-06', false, false)`, [A])
    await expect(addCheckin(db, A, { day: '2026-10-06' })).rejects.toThrow(/day_closed/)
    await addCheckin(db, A, { day: '2026-10-07' })
  })

  it('takes a lock per person and day before counting the ten of the day', async () => {
    const id = randomUUID()
    await db.exec('begin')
    try {
      await db.exec('set local role authenticated')
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A])
      await db.query(
        `insert into public.checkins (id, day, activity, title, visibility, photo_path)
         values ($1, '2026-10-07', 'run', 'Treino', 'friends', $2)`, [id, `${A}/${id}.jpg`])
      await db.exec('reset role')
      const [r] = await sql<{ held: boolean }>(db,
        `with k as (select hashtextextended('checkin-day:' || $1 || ':2026-10-07', 0) as v)
         select exists (
           select 1 from pg_locks, k
            where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 1
              and classid::bigint = ((k.v >> 32) & 4294967295) and objid::bigint = (k.v & 4294967295)) as held`, [A])
      expect(r.held).toBe(true)
    } finally {
      await db.exec('rollback')
    }
  })
})

describe('F: toggling a reaction does not flood the notices', () => {
  const notices = async () => (await sql<{ n: number }>(db,
    `select count(*)::int as n from public.social_notices where user_id = $1 and kind = 'reaction'`, [A]))[0].n

  it('adds no notice while an unread one from the same person on the same post is there', async () => {
    const id = await post(A, '2026-10-07')
    await react(B, id, '💪')
    await react(B, id, '💪', false)
    await react(B, id, '💪')
    await react(B, id, '🔥')
    expect(await notices()).toBe(1)
    await react(C, id, '💪')
    expect(await notices()).toBe(2)
    await asUser(db, A, () => db.query('select public.mark_notices_read(9223372036854775807)'))
    await react(B, id, '👏')
    expect(await notices()).toBe(3)
  })

  it('still notifies every comment', async () => {
    const id = await post(A, '2026-10-07')
    for (const body of ['Boa', 'Forte']) await asUser(db, B, () => db.query('select public.comment_checkin($1, $2)', [id, body]))
    expect((await sql<{ n: number }>(db,
      `select count(*)::int as n from public.social_notices where user_id = $1 and kind = 'comment'`, [A]))[0].n).toBe(2)
  })
})
