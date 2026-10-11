import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql } from './helpers/game'
import { befriend, one } from './helpers/social'
import { addCheckin } from './helpers/checkin'

// Phase 1c, final review (Important 1 and Minor 8): the default visibility of a new check-in is its
// own column, profiles.checkin_visibility, and share_activity keeps its first meaning: friends see
// my workouts from before the check-ins, as the old feed items. Today is Wednesday 2026-10-07 in
// Sao Paulo; the cutover is Monday 2026-10-05. Ana and Bia are friends.

let db: PGlite

const feed = (uid: string) => one<{ items: any[] }>(db, uid, 'select public.get_checkin_feed() as v')
const visibilityOf = async (uid: string) =>
  (await sql<{ v: string }>(db, 'select checkin_visibility as v from public.profiles where id = $1', [uid]))[0].v

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-07T15:00:00Z')
  await sql(db, `update public.app_settings set value = to_jsonb('2026-10-05'::date) where key = 'training_checkin_since'`)
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await befriend(db, A, B)
})

describe('profiles.checkin_visibility', () => {
  it('exists, is not null and starts on friends for every profile, whatever share_activity says', async () => {
    const [col] = await sql<{ is_nullable: string; column_default: string }>(db,
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'checkin_visibility'`)
    expect(col).toEqual({ is_nullable: 'NO', column_default: "'friends'::text" })
    expect(await visibilityOf(A)).toBe('friends')   // share_activity defaults to false
    expect((await sql(db, 'select share_activity from public.profiles where id = $1', [A]))[0].share_activity).toBe(false)
  })

  it('takes only friends or private', async () => {
    await expect(sql(db, `update public.profiles set checkin_visibility = 'public' where id = $1`, [A])).rejects.toThrow(/violates check/)
    await expect(sql(db, 'update public.profiles set checkin_visibility = null where id = $1', [A])).rejects.toThrow(/violates not-null/)
  })

  it('lets the owner change it and nobody else', async () => {
    await asUser(db, A, () => db.query(`update public.profiles set checkin_visibility = 'private' where id = $1`, [A]))
    expect(await visibilityOf(A)).toBe('private')
    await asUser(db, B, () => db.query(`update public.profiles set checkin_visibility = 'friends' where id = $1`, [A]))
    expect(await visibilityOf(A)).toBe('private')
    await asUser(db, B, () => db.query(`update public.profiles set checkin_visibility = 'private'`))
    expect(await visibilityOf(A)).toBe('private')
    expect(await visibilityOf(B)).toBe('private')   // the update reached only Bia's own row
  })

  it('does not touch share_activity, and share_activity does not touch it', async () => {
    await asUser(db, A, () => db.query(`update public.profiles set checkin_visibility = 'private'`))
    expect((await sql(db, 'select share_activity from public.profiles where id = $1', [A]))[0].share_activity).toBe(false)
    await asUser(db, A, () => db.query('update public.profiles set share_activity = true'))
    expect(await visibilityOf(A)).toBe('private')
  })
})

describe('share_activity after the decoupling', () => {
  it('still decides alone whether friends see the workouts from before the cutover', async () => {
    await event(db, A, 'workout_completed', '2026-10-02', 'a1', { sets: 12 })
    // Ana posts for friends by default but never shared her old workouts.
    expect(await visibilityOf(A)).toBe('friends')
    expect((await feed(B)).items).toEqual([])
    await asUser(db, A, () => db.query('update public.profiles set share_activity = true'))
    expect((await feed(B)).items.map(i => i.type)).toEqual(['workout'])
    // The check-in default has no say over the old items.
    await asUser(db, A, () => db.query(`update public.profiles set checkin_visibility = 'private'`))
    expect((await feed(B)).items.map(i => i.type)).toEqual(['workout'])
    await asUser(db, A, () => db.query('update public.profiles set share_activity = false'))
    expect((await feed(B)).items).toEqual([])
  })

  it('has no say over a new check-in: a post for friends shows with share_activity off', async () => {
    const id = await addCheckin(db, A, { visibility: 'friends' })
    expect((await feed(B)).items.map(i => i.key)).toEqual(['checkin:' + id])
    await asUser(db, A, () => db.query('update public.profiles set share_activity = true'))
    const priv = await addCheckin(db, A, { visibility: 'private' })
    expect((await feed(B)).items.map(i => i.key)).toEqual(['checkin:' + id])
    expect((await feed(A)).items.map(i => i.key).sort()).toEqual(['checkin:' + id, 'checkin:' + priv].sort())
  })
})
