import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { C, befriend, one, rows } from './helpers/social'
import { addCheckin } from './helpers/checkin'

let db: PGlite
const as = (uid: string, q: string, p: unknown[] = []) => asUser(db, uid, () => db.query(q, p))
const insertAs = (uid: string, cols: Record<string, unknown>) => {
  const id = (cols.id as string) ?? randomUUID()
  const row = {
    id, day: '2026-10-07', activity: 'run', title: 'Corrida', visibility: 'friends',
    photo_path: `${uid}/${id}.jpg`, ...cols,
  }
  const keys = Object.keys(row)
  return as(uid,
    `insert into public.checkins (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
    Object.values(row))
}
const canSee = (uid: string, id: string) => one<boolean>(db, uid, 'select public.can_see_checkin($1) as v', [id])
const canSeePath = (uid: string, path: string) =>
  one<boolean>(db, uid, 'select public.can_see_checkin_path($1) as v', [path])

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
})

describe('check-in rules', () => {
  it('accepts today and yesterday only', async () => {
    await addCheckin(db, A, { day: '2026-10-07' })
    await addCheckin(db, A, { day: '2026-10-06' })
    await expect(addCheckin(db, A, { day: '2026-10-05' })).rejects.toThrow(/day_closed/)
    await expect(addCheckin(db, A, { day: '2026-10-08' })).rejects.toThrow(/day_closed/)
  })

  it('stamps the owner and defaults the day to local today', async () => {
    const id = await addCheckin(db, A)
    const [r] = await sql(db, `select user_id, to_char(day, 'YYYY-MM-DD') as day from public.checkins where id = $1`, [id])
    expect(r).toEqual({ user_id: A, day: '2026-10-07' })
  })

  it('caps a day at 10 check-ins', async () => {
    for (let i = 0; i < 10; i++) await addCheckin(db, A)
    await expect(addCheckin(db, A)).rejects.toThrow(/too_many_checkins/)
    await addCheckin(db, A, { day: '2026-10-06' })
    await addCheckin(db, B)
  })

  it('keeps day, activity, photo and owner fixed', async () => {
    const id = await addCheckin(db, A)
    const upd = (set: string, p: unknown[] = []) =>
      as(A, `update public.checkins set ${set} where id = $1`, [id, ...p])
    await expect(upd(`day = '2026-10-06'`)).rejects.toThrow(/item_immutable/)
    await expect(upd(`activity = 'run'`)).rejects.toThrow(/item_immutable/)
    await expect(upd(`photo_path = $2`, [`${A}/${id}.webp`])).rejects.toThrow(/item_immutable/)
    await expect(upd(`user_id = $2`, [B])).rejects.toThrow(/item_immutable/)
  })

  it('lets the owner edit title, caption, note, visibility and detail', async () => {
    const id = await addCheckin(db, A, { day: '2026-10-06' })
    await setClock(db, '2026-10-20T15:00:00Z')   // long after the day closed
    await as(A,
      `update public.checkins set title = 'Peito', caption = 'Bom', note = 'joelho', visibility = 'private',
         detail = '{"entries":[]}'::jsonb, updated_at = now() where id = $1`, [id])
    const [r] = await sql(db, 'select title, caption, note, visibility, detail from public.checkins where id = $1', [id])
    expect(r).toEqual({ title: 'Peito', caption: 'Bom', note: 'joelho', visibility: 'private', detail: { entries: [] } })
  })

  it('keeps the newest write', async () => {
    const id = await addCheckin(db, A)
    const title = async () => (await sql(db, 'select title from public.checkins where id = $1', [id]))[0].title
    const upd = (t: string, at: string) =>
      as(A, 'update public.checkins set title = $2, updated_at = $3 where id = $1', [id, t, at])
    await upd('Velho', '2000-01-01T00:00:00Z')
    expect(await title()).toBe('Treino')
    await upd('Novo', new Date(Date.now() + 60_000).toISOString())
    expect(await title()).toBe('Novo')
    const [r] = await sql(db, 'select updated_at <= now() as ok from public.checkins where id = $1', [id])
    expect(r.ok).toBe(true)
  })

  it('refuses empty titles and titles over 60 characters', async () => {
    await expect(insertAs(A, { title: '   ' })).rejects.toThrow(/check/)
    await expect(insertAs(A, { title: 'x'.repeat(61) })).rejects.toThrow(/check/)
    await insertAs(A, { title: 'x'.repeat(60) })
  })

  it('refuses a photo outside the own folder or not named after the check-in', async () => {
    const id = randomUUID()
    await expect(insertAs(A, { id, photo_path: `${B}/${id}.jpg` })).rejects.toThrow(/check/)
    await expect(insertAs(A, { id, photo_path: `${A}/${randomUUID()}.jpg` })).rejects.toThrow(/check/)
    await expect(insertAs(A, { id, photo_path: `${A}/${id}.png` })).rejects.toThrow(/check/)
    await insertAs(A, { id, photo_path: `${A}/${id}.webp` })
  })

  it('lets the owner delete at any time', async () => {
    const id = await addCheckin(db, A, { day: '2026-10-06' })
    await setClock(db, '2026-10-20T15:00:00Z')
    await as(A, 'delete from public.checkins where id = $1', [id])
    expect(await sql(db, 'select 1 from public.checkins where id = $1', [id])).toEqual([])
  })
})

describe('check-in access', () => {
  it('keeps rows to their owner', async () => {
    await befriend(db, A, B)
    const id = await addCheckin(db, A, { note: 'privada' })
    expect(await rows(db, B, 'select id from public.checkins')).toEqual([])
    expect(await rows(db, null, 'select id from public.checkins').catch(() => [])).toEqual([])
    await as(B, `update public.checkins set title = 'x' where id = $1`, [id])
    await as(B, 'delete from public.checkins where id = $1', [id])
    const [r] = await sql(db, 'select title from public.checkins where id = $1', [id])
    expect(r.title).toBe('Treino')
    expect(await rows(db, A, 'select id from public.checkins')).toEqual([{ id }])
  })

  it('can_see_checkin: the owner, and friends on friends posts only', async () => {
    await befriend(db, A, B)
    const open = await addCheckin(db, A, { visibility: 'friends' })
    const mine = await addCheckin(db, A, { visibility: 'private' })
    expect(await canSee(A, open)).toBe(true)
    expect(await canSee(A, mine)).toBe(true)
    expect(await canSee(B, open)).toBe(true)
    expect(await canSee(B, mine)).toBe(false)
    expect(await canSee(C, open)).toBe(false)
    expect(await canSee(B, randomUUID())).toBe(false)
    await sql(db, 'delete from public.friendships')
    expect(await canSee(B, open)).toBe(false)
  })

  it('can_see_checkin_path refuses forged and malformed paths', async () => {
    await befriend(db, A, B)
    const open = await addCheckin(db, A)
    const mine = await addCheckin(db, A, { visibility: 'private' })
    expect(await canSeePath(B, `${A}/${open}.jpg`)).toBe(true)
    expect(await canSeePath(A, `${A}/${mine}.jpg`)).toBe(true)
    expect(await canSeePath(B, `${A}/${mine}.jpg`)).toBe(false)
    expect(await canSeePath(C, `${A}/${open}.jpg`)).toBe(false)
    // Another person's folder with an id that does not exist, or with someone else's id.
    expect(await canSeePath(B, `${A}/${randomUUID()}.jpg`)).toBe(false)
    expect(await canSeePath(B, `${C}/${open}.jpg`)).toBe(false)
    // Same check-in, but a path it does not hold.
    expect(await canSeePath(B, `${A}/${open}.webp`)).toBe(false)
    expect(await canSeePath(B, `${A}/${open}.png`)).toBe(false)
    expect(await canSeePath(B, `${A}/../${A}/${open}.jpg`)).toBe(false)
    expect(await canSeePath(B, `../${A}/${open}.jpg`)).toBe(false)
    expect(await canSeePath(B, `${A}/x/${open}.jpg`)).toBe(false)
    expect(await canSeePath(B, `${A.toUpperCase()}/${open}.jpg`)).toBe(false)
    expect(await canSeePath(B, '')).toBe(false)
    expect(await one<boolean>(db, B, 'select public.can_see_checkin_path(null) as v')).toBe(false)
    // A deleted check-in no longer opens its photo.
    await as(A, 'delete from public.checkins where id = $1', [open])
    expect(await canSeePath(B, `${A}/${open}.jpg`)).toBe(false)
  })

  it('keeps both helpers away from anon', async () => {
    const id = await addCheckin(db, A)
    await expect(rows(db, null, 'select public.can_see_checkin($1)', [id])).rejects.toThrow(/permission denied/)
    await expect(rows(db, null, 'select public.can_see_checkin_path($1)', [`${A}/${id}.jpg`])).rejects.toThrow(/permission denied/)
  })

  it('deletes the check-ins with the account', async () => {
    await addCheckin(db, A)
    await addCheckin(db, B)
    await rows(db, A, 'select public.delete_my_account()')
    expect(await sql(db, 'select user_id from public.checkins')).toEqual([{ user_id: B }])
  })
})

describe('hidden check-ins and app settings', () => {
  it('hides only posts the person can see, and only for themselves', async () => {
    await befriend(db, A, B)
    const open = await addCheckin(db, A)
    const mine = await addCheckin(db, A, { visibility: 'private' })
    await as(B, 'insert into public.hidden_checkins (checkin_id) values ($1)', [open])
    await expect(as(B, 'insert into public.hidden_checkins (checkin_id) values ($1)', [mine])).rejects.toThrow(/row-level security/)
    await expect(as(B, 'insert into public.hidden_checkins (user_id, checkin_id) values ($1, $2)', [C, open])).rejects.toThrow(/row-level security/)
    expect(await rows(db, B, 'select checkin_id from public.hidden_checkins')).toEqual([{ checkin_id: open }])
    expect(await rows(db, A, 'select checkin_id from public.hidden_checkins')).toEqual([])
    await as(A, 'delete from public.checkins where id = $1', [open])
    expect(await sql(db, 'select 1 from public.hidden_checkins')).toEqual([])
  })

  it('app_settings is read only for clients', async () => {
    await sql(db, `insert into public.app_settings (key, value) values ('k', '"v"')`)
    expect(await rows(db, A, `select key, value from public.app_settings where key <> 'training_checkin_since'`))
      .toEqual([{ key: 'k', value: 'v' }])
    await expect(as(A, `insert into public.app_settings (key, value) values ('x', '1')`)).rejects.toThrow(/permission denied/)
    await expect(as(A, `update public.app_settings set value = '2'`)).rejects.toThrow(/permission denied/)
    await expect(as(A, 'delete from public.app_settings')).rejects.toThrow(/permission denied/)
    await expect(rows(db, null, 'select * from public.app_settings')).rejects.toThrow(/permission denied/)
  })
})

describe('photo storage', () => {
  const upload = (uid: string, name: string) =>
    as(uid, `insert into storage.objects (bucket_id, name) values ('checkins', $1)`, [name])
  const visible = async (uid: string, name: string) =>
    (await rows(db, uid, `select 1 from storage.objects where bucket_id = 'checkins' and name = $1`, [name])).length === 1

  it('creates a private bucket for JPEG and WebP up to 600 KB', async () => {
    const [b] = await sql(db, `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'checkins'`)
    expect(b).toEqual({ public: false, file_size_limit: 614400, allowed_mime_types: ['image/jpeg', 'image/webp'] })
  })

  it('uploads and deletes only in the own folder', async () => {
    const id = randomUUID()
    await upload(A, `${A}/${id}.jpg`)
    await expect(upload(A, `${B}/${id}.jpg`)).rejects.toThrow(/row-level security/)
    await as(B, `delete from storage.objects where name = $1`, [`${A}/${id}.jpg`])
    expect(await sql(db, 'select 1 from storage.objects')).toHaveLength(1)
    await as(A, `delete from storage.objects where name = $1`, [`${A}/${id}.jpg`])
    expect(await sql(db, 'select 1 from storage.objects')).toHaveLength(0)
  })

  it('shows a friend the photo of a friends post, never of a private one', async () => {
    await befriend(db, A, B)
    const open = await addCheckin(db, A)
    const mine = await addCheckin(db, A, { visibility: 'private' })
    await upload(A, `${A}/${open}.jpg`)
    await upload(A, `${A}/${mine}.jpg`)
    expect(await visible(B, `${A}/${open}.jpg`)).toBe(true)
    expect(await visible(B, `${A}/${mine}.jpg`)).toBe(false)
    expect(await visible(C, `${A}/${open}.jpg`)).toBe(false)
    expect(await visible(A, `${A}/${mine}.jpg`)).toBe(true)
  })

  it('lets the owner see a photo whose check-in is not there yet', async () => {
    const id = randomUUID()
    await upload(A, `${A}/${id}.jpg`)
    expect(await visible(A, `${A}/${id}.jpg`)).toBe(true)
    expect(await visible(B, `${A}/${id}.jpg`)).toBe(false)
  })
})
