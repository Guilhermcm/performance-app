import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { rows } from './helpers/social'
import { logItem, setTarget } from './helpers/nutrition'

let db: PGlite
const T = { kcal: 2200, protein_g: 150, carbs_g: 250, fat_g: 70 }
const ownerItem = (uid: string, day: string, id = randomUUID()) =>
  db.query(
    `insert into public.food_logs (id, user_id, day, meal, name, source, kcal)
     values ($1, $2, $3, 'lunch', 'Item', 'quick', 100)`, [id, uid, day]).then(() => id)
const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('food diary window', () => {
  it('accepts items for today and yesterday only', async () => {
    await logItem(db, A, '2026-10-07', 'lunch', 500)
    await logItem(db, A, '2026-10-06', 'lunch', 500)
    await expect(logItem(db, A, '2026-10-05', 'lunch', 500)).rejects.toThrow(/day_closed/)
    await expect(logItem(db, A, '2026-10-08', 'lunch', 500)).rejects.toThrow(/day_closed/)
    const old = await ownerItem(A, '2026-10-05')
    await expect(asA(`update public.food_logs set kcal = 1 where id = $1`, [old])).rejects.toThrow(/day_closed/)
    await expect(asA(`delete from public.food_logs where id = $1`, [old])).rejects.toThrow(/day_closed/)
  })

  it('uses the profile time zone', async () => {
    await sql(db, `update public.profiles set timezone = 'Asia/Tokyo' where id = $1`, [A])
    await setClock(db, '2026-10-07T16:00:00Z')   // already 08/10 in Tokyo
    await logItem(db, A, '2026-10-08', 'lunch', 500)
    await expect(logItem(db, A, '2026-10-06', 'lunch', 500)).rejects.toThrow(/day_closed/)
  })

  it('refuses moving an item to another day or person', async () => {
    const id = await logItem(db, A, '2026-10-07', 'lunch', 500)
    await expect(asA(`update public.food_logs set day = '2026-10-06' where id = $1`, [id])).rejects.toThrow()
    await expect(asA(`update public.food_logs set user_id = $2 where id = $1`, [id, B])).rejects.toThrow()
  })

  it('refuses import items from clients', async () => {
    await expect(asA(
      `insert into public.food_logs (id, day, meal, name, source, kcal)
       values ($1, '2026-10-07', 'lunch', 'x', 'import', 10)`, [randomUUID()])).rejects.toThrow()
  })

  it('caps a day at 200 items without blocking edits', async () => {
    const first = randomUUID()
    await ownerItem(A, '2026-10-07', first)
    for (let i = 1; i < 200; i++) await ownerItem(A, '2026-10-07')
    await expect(logItem(db, A, '2026-10-07', 'lunch', 1)).rejects.toThrow(/too_many_items/)
    await asA(
      `insert into public.food_logs (id, day, meal, name, source, kcal)
       values ($1, '2026-10-07', 'lunch', 'Edited', 'quick', 5)
       on conflict (id) do update set name = excluded.name, kcal = excluded.kcal,
         updated_at = excluded.updated_at`, [first])
    const [r] = await sql(db, 'select name from public.food_logs where id = $1', [first])
    expect(r.name).toBe('Edited')
  })

  it('keeps the newest write', async () => {
    const id = await logItem(db, A, '2026-10-07', 'lunch', 500)
    const kcal = async () => Number((await sql(db, 'select kcal from public.food_logs where id = $1', [id]))[0].kcal)
    const upd = (k: number, at: string) =>
      asA(`update public.food_logs set kcal = $2, updated_at = $3 where id = $1`, [id, k, at])
    await upd(111, '2000-01-01T00:00:00Z')
    expect(await kcal()).toBe(500)
    await upd(222, new Date(Date.now() + 60_000).toISOString())
    expect(await kcal()).toBe(222)
    const [r] = await sql(db, 'select updated_at <= now() as ok from public.food_logs where id = $1', [id])
    expect(r.ok).toBe(true)
    await upd(333, new Date(Date.now() + 86_400_000 * 30).toISOString())
    expect(await kcal()).toBe(333)
    const [r2] = await sql(db, `select updated_at <= now() as ok from public.food_logs where id = $1`, [id])
    expect(r2.ok).toBe(true)
  })

  it('lets account deletion remove old items', async () => {
    await ownerItem(A, '2026-09-27')
    await ownerItem(B, '2026-09-27')
    await asA('select public.delete_my_account()')
    expect(await sql(db, 'select 1 from public.food_logs where user_id = $1', [A])).toHaveLength(0)
    await sql(db, 'delete from auth.users where id = $1', [B])
    expect(await sql(db, 'select 1 from public.food_logs where user_id = $1', [B])).toHaveLength(0)
  })

  it('lets server functions write any day', async () => {
    await db.exec(`
      create function public.test_server_log(p uuid) returns void
      language plpgsql security definer set search_path = public as $$
      begin
        insert into public.food_logs (id, user_id, day, meal, name, source, kcal)
        values (gen_random_uuid(), p, '2026-09-27', 'lunch', 'Old', 'import', 100);
      end $$;`)
    await asA('select public.test_server_log($1)', [A])
    expect(await sql(db, 'select 1 from public.food_logs where user_id = $1', [A])).toHaveLength(1)
  })
})

describe('privacy and targets', () => {
  it('keeps people apart', async () => {
    const id = await logItem(db, A, '2026-10-07', 'lunch', 500)
    await setTarget(db, A, '2026-10-07', T)
    const food = randomUUID()
    await asA(`insert into public.user_foods (id, source, name, kcal_100g) values ($1, 'custom', 'Pao', 250)`, [food])
    expect(await rows(db, B, 'select 1 from public.food_logs')).toHaveLength(0)
    expect(await rows(db, B, 'select 1 from public.nutrition_targets')).toHaveLength(0)
    expect(await rows(db, B, 'select 1 from public.user_foods')).toHaveLength(0)
    expect(await rows(db, B, `update public.food_logs set kcal = 1 where id = $1 returning 1`, [id])).toHaveLength(0)
    expect(await rows(db, B, `delete from public.food_logs where id = $1 returning 1`, [id])).toHaveLength(0)
    expect(await rows(db, B, `update public.user_foods set favorite = true where id = $1 returning 1`, [food])).toHaveLength(0)
    expect(await rows(db, B, `delete from public.user_foods where id = $1 returning 1`, [food])).toHaveLength(0)
    await expect(rows(db, B, `delete from public.nutrition_targets`)).rejects.toThrow(/permission denied/)
    expect(await sql(db, 'select 1 from public.food_logs where id = $1', [id])).toHaveLength(1)
    expect(await rows(db, null, 'select 1 from public.food_logs').catch(() => [])).toHaveLength(0)
  })

  const insTarget = (day: string) =>
    asA(`insert into public.nutrition_targets (valid_from, kcal, protein_g, carbs_g, fat_g, mode)
         values ($1, 2000, 100, 200, 60, 'manual')`, [day])

  it('lets the first target start today and later ones tomorrow', async () => {
    await insTarget('2026-10-07')
    await expect(insTarget('2026-10-07')).rejects.toThrow()
    await expect(insTarget('2026-10-06')).rejects.toThrow()
    await insTarget('2026-10-08')
    const upd = await rows(db, A, `update public.nutrition_targets set kcal = 2100 where valid_from = '2026-10-07' returning 1`)
    expect(upd).toHaveLength(0)
    const fut = await rows(db, A, `update public.nutrition_targets set kcal = 2100 where valid_from = '2026-10-08' returning 1`)
    expect(fut).toHaveLength(1)
    await expect(asA(`update public.nutrition_targets set valid_from = '2026-10-07' where valid_from = '2026-10-08'`)).rejects.toThrow()
    await expect(rows(db, A, `delete from public.nutrition_targets`)).rejects.toThrow(/permission denied/)
  })

  it('does not let a first target start in the past', async () => {
    await expect(insTarget('2026-10-06')).rejects.toThrow()
  })

  it('checks target ranges', async () => {
    await expect(asA(
      `insert into public.nutrition_targets (valid_from, kcal, protein_g, carbs_g, fat_g, mode)
       values ('2026-10-08', 999, 100, 200, 60, 'manual')`)).rejects.toThrow(/check/)
  })

  it('caps saved foods at 500', async () => {
    await db.query(
      `insert into public.user_foods (id, user_id, source, name, kcal_100g)
       select gen_random_uuid(), $1, 'custom', 'F' || g, 100 from generate_series(1, 500) g`, [A])
    await expect(asA(
      `insert into public.user_foods (id, source, name, kcal_100g) values ($1, 'custom', 'X', 1)`, [randomUUID()])).rejects.toThrow(/too_many_foods/)
    const id = (await sql(db, 'select id from public.user_foods limit 1'))[0].id
    await asA(`insert into public.user_foods (id, source, name, kcal_100g) values ($1, 'custom', 'Y', 1)
               on conflict (id) do update set name = excluded.name`, [id])
  })

  it('target_on returns the latest target up to the day', async () => {
    await setTarget(db, A, '2026-10-01', T)
    await setTarget(db, A, '2026-10-08', { ...T, kcal: 2400 }, 'manual')
    const k = async (d: string) => (await sql(db, 'select kcal from public.target_on($1, $2)', [A, d]))[0]?.kcal
    expect(await k('2026-10-07')).toBe(2200)
    expect(await k('2026-10-08')).toBe(2400)
    expect(await k('2026-09-30')).toBeNull()
  })
})
