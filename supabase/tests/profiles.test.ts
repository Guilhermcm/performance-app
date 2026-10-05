import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser, asUser } from './helpers/db'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

const insert = (id: string, over: Record<string, unknown> = {}) => {
  const row = { id, display_name: 'Ana', days_per_week: 3, ...over }
  const cols = Object.keys(row)
  return db.query(`insert into profiles (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row))
}

beforeEach(async () => {
  db = await freshDb()
  await addUser(db, A)
  await addUser(db, B)
})

describe('profiles', () => {
  it('lets a user create and read only their own profile', async () => {
    await asUser(db, A, () => insert(A))
    const mine = await asUser(db, A, () => db.query<any>('select display_name, locale, timezone, unit from profiles'))
    expect(mine.rows).toEqual([{ display_name: 'Ana', locale: 'pt-BR', timezone: 'America/Sao_Paulo', unit: 'kg' }])
    const theirs = await asUser(db, B, () => db.query('select * from profiles'))
    expect(theirs.rows).toEqual([])
  })

  it('refuses a profile for someone else', async () => {
    await expect(asUser(db, B, () => insert(A))).rejects.toThrow()
  })

  it.each([
    [{ display_name: '' }],
    [{ height_cm: 20 }],
    [{ weight_kg: 500 }],
    [{ days_per_week: 0 }],
    [{ goal: 'bulk' }],
    [{ level: 'pro' }],
    [{ unit: 'st' }],
    [{ locale: 'de' }]
  ])('rejects out-of-range values %j', async over => {
    await expect(asUser(db, A, () => insert(A, over))).rejects.toThrow()
  })

  it('bumps updated_at on update', async () => {
    await asUser(db, A, () => insert(A))
    const before = await asUser(db, A, () => db.query<any>('select updated_at from profiles'))
    await new Promise(r => setTimeout(r, 5))
    await asUser(db, A, () => db.query(`update profiles set display_name = 'Bia'`))
    const after = await asUser(db, A, () => db.query<any>('select updated_at from profiles'))
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(new Date(before.rows[0].updated_at).getTime())
  })
})
