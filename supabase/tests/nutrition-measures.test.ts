import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'

let db: PGlite
const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))
const asB = (q: string, p: unknown[] = []) => asUser(db, B, () => db.query(q, p))
const add = (key = 'taco:12', label = 'concha', grams = 120, id = randomUUID()) =>
  asA(`insert into public.food_measures (id, food_key, label, grams) values ($1, $2, $3, $4)`,
    [id, key, label, grams]).then(() => id)
// The server side (database owner) fills a person up without going through the guard.
const seed = (uid: string, key: string, n: number) =>
  sql(db, `insert into public.food_measures (id, user_id, food_key, label, grams)
           select gen_random_uuid(), $1, $2, 'm' || i, 10 from generate_series(1, $3) i`, [uid, key, n])

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('food_measures access', () => {
  it('lets each person read and write only their own', async () => {
    const id = await add()
    expect((await asA('select id from public.food_measures')).rows).toHaveLength(1)
    expect((await asB('select id from public.food_measures')).rows).toHaveLength(0)
    await asB('update public.food_measures set grams = 1 where id = $1', [id])
    await asB('delete from public.food_measures where id = $1', [id])
    const [r] = await sql(db, 'select grams from public.food_measures where id = $1', [id])
    expect(Number(r.grams)).toBe(120)
    await expect(asB(
      `insert into public.food_measures (id, user_id, food_key, label, grams) values ($1, $2, 'taco:1', 'x', 5)`,
      [randomUUID(), A])).rejects.toThrow(/row-level security/)
  })

  it('lets the owner edit and delete', async () => {
    const id = await add()
    await asA(`update public.food_measures set label = 'concha cheia' where id = $1`, [id])
    expect((await sql(db, 'select label from public.food_measures where id = $1', [id]))[0].label).toBe('concha cheia')
    await asA('delete from public.food_measures where id = $1', [id])
    expect(await sql(db, 'select 1 from public.food_measures')).toHaveLength(0)
  })

  it('is closed to anonymous callers', async () => {
    await expect(db.query('set role anon').then(() => db.query('select * from public.food_measures')))
      .rejects.toThrow(/permission denied/)
    await db.query('reset role')
  })
})

describe('food_measures checks', () => {
  it('accepts the three food key shapes', async () => {
    await add('taco:12')
    await add('off:7891000100103')
    await add(`custom:${randomUUID()}`)
  })

  it('refuses an invalid food key', async () => {
    for (const k of ['quick:1', 'taco:', 'taco', 'taco:a b', 'TACO:1', `taco:${'a'.repeat(65)}`]) {
      await expect(add(k)).rejects.toThrow(/food_key|check constraint/)
    }
  })

  it('refuses an empty or too long name', async () => {
    await expect(add('taco:1', '')).rejects.toThrow(/check constraint/)
    await expect(add('taco:1', '   ')).rejects.toThrow(/check constraint/)
    await expect(add('taco:1', 'x'.repeat(31))).rejects.toThrow(/check constraint/)
    await add('taco:1', 'x'.repeat(30))
  })

  it('keeps grams between 1 and 2000', async () => {
    await expect(add('taco:1', 'a', 0)).rejects.toThrow(/check constraint/)
    await expect(add('taco:1', 'a', 2001)).rejects.toThrow(/check constraint/)
    await add('taco:1', 'b', 1)
    await add('taco:1', 'c', 2000)
  })
})

describe('food_measures limits', () => {
  it('allows 10 per food and refuses the 11th', async () => {
    for (let i = 0; i < 10; i++) await add('taco:5', 'm' + i, 10)
    await expect(add('taco:5', 'm11', 10)).rejects.toThrow(/too_many_measures/)
    await add('taco:6', 'other', 10)   // another food is unaffected
  })

  it('lets an upsert of an existing measure pass on a full set', async () => {
    const first = randomUUID()
    await add('taco:5', 'first', 10, first)
    for (let i = 1; i < 10; i++) await add('taco:5', 'm' + i, 10)
    await asA(
      `insert into public.food_measures (id, food_key, label, grams) values ($1, 'taco:5', 'edited', 33)
       on conflict (id) do update set label = excluded.label, grams = excluded.grams,
         updated_at = excluded.updated_at`, [first])
    const [r] = await sql(db, 'select label from public.food_measures where id = $1', [first])
    expect(r.label).toBe('edited')
  })

  it('allows 500 per person and refuses the 501st', async () => {
    for (let k = 0; k < 50; k++) await seed(A, `taco:k${k}`, 10)
    await expect(add('taco:new')).rejects.toThrow(/too_many_measures/)
    await seed(B, 'taco:k0', 1)   // the count is per person
    await asB(`insert into public.food_measures (id, food_key, label, grams) values ($1, 'taco:z', 'z', 5)`, [randomUUID()])
  })

  it('does not apply to the server', async () => {
    await seed(A, 'taco:5', 12)
    expect(await sql(db, 'select 1 from public.food_measures')).toHaveLength(12)
  })
})

describe('food_measures immutability', () => {
  it('refuses a client moving a measure to another food or person', async () => {
    const id = await add('taco:5', 'a', 100)
    for (let i = 0; i < 10; i++) await add('taco:6', 'm' + i, 10)
    await expect(asA(`update public.food_measures set food_key = 'taco:6' where id = $1`, [id]))
      .rejects.toThrow(/item_immutable/)
    await expect(asA('update public.food_measures set user_id = $2 where id = $1', [id, B]))
      .rejects.toThrow(/item_immutable|row-level security/)
    const [r] = await sql(db, 'select food_key, user_id from public.food_measures where id = $1', [id])
    expect(r).toEqual({ food_key: 'taco:5', user_id: A })
    expect((await sql(db, `select 1 from public.food_measures where food_key = 'taco:6'`))).toHaveLength(10)
  })

  it('still lets the client edit label and grams', async () => {
    const id = await add('taco:5', 'a', 100)
    await asA(`update public.food_measures set label = 'b', grams = 55 where id = $1`, [id])
    const [r] = await sql(db, 'select label, grams from public.food_measures where id = $1', [id])
    expect(r.label).toBe('b')
    expect(Number(r.grams)).toBe(55)
  })

  it('does not apply to the server', async () => {
    const id = await add('taco:5', 'a', 100)
    await sql(db, `update public.food_measures set food_key = 'taco:6' where id = $1`, [id])
    expect((await sql(db, 'select food_key from public.food_measures where id = $1', [id]))[0].food_key).toBe('taco:6')
  })
})

describe('food_measures last write wins', () => {
  it('ignores an older update and clamps the clock', async () => {
    const id = await add('taco:5', 'a', 100)
    const grams = async () => Number((await sql(db, 'select grams from public.food_measures where id = $1', [id]))[0].grams)
    const upd = (g: number, at: string) =>
      asA('update public.food_measures set grams = $2, updated_at = $3 where id = $1', [id, g, at])
    await upd(111, '2000-01-01T00:00:00Z')
    expect(await grams()).toBe(100)
    await upd(222, new Date(Date.now() + 60_000).toISOString())
    expect(await grams()).toBe(222)
    const [r] = await sql(db, 'select updated_at <= now() as ok from public.food_measures where id = $1', [id])
    expect(r.ok).toBe(true)
    await upd(333, new Date(Date.now() + 86_400_000 * 30).toISOString())
    expect(await grams()).toBe(333)
  })
})
