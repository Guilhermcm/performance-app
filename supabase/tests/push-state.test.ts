import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser, asUser } from './helpers/db'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

const push = (state: unknown, baseRev: number | null) =>
  db.query<{ r: any }>('select public.push_state($1::jsonb, $2) as r', [JSON.stringify(state), baseRev]).then(x => x.rows[0].r)

beforeEach(async () => {
  db = await freshDb()
  await addUser(db, A)
  await addUser(db, B)
})

describe('push_state', () => {
  it('creates the row on the first push from rev 0', async () => {
    const r = await asUser(db, A, () => push({ workouts: [], routines: [], _ts: 5 }, 0))
    expect(r).toEqual({ ok: true, rev: 1, ts: 5 })
    const row = await asUser(db, A, () => db.query<any>('select data, rev from app_state'))
    expect(row.rows[0].rev).toBe(1)
    expect(row.rows[0].data._rev).toBe(1)
  })

  it('refuses a stale base revision and returns the stored document', async () => {
    await asUser(db, A, () => push({ workouts: [{ id: 'w1' }], _ts: 1 }, 0))
    const r = await asUser(db, A, () => push({ workouts: [], _ts: 2 }, 0))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('conflict')
    expect(r.rev).toBe(1)
    expect(r.state.workouts).toEqual([{ id: 'w1' }])
  })

  it('overwrites when no base revision is given', async () => {
    await asUser(db, A, () => push({ workouts: [{ id: 'w1' }] }, 0))
    const r = await asUser(db, A, () => push({ workouts: [] }, null))
    expect(r).toMatchObject({ ok: true, rev: 2 })
  })

  it('drops the in-progress workout and non-object entries', async () => {
    await asUser(db, A, () => push({ active: { x: 1 }, workouts: [{ id: 'a' }, 3, null, { id: 'b' }] }, 0))
    const row = await asUser(db, A, () => db.query<any>('select data from app_state'))
    expect(row.rows[0].data.active).toBeUndefined()
    expect(row.rows[0].data.workouts).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('never moves the reset stamp backwards', async () => {
    await asUser(db, A, () => push({ routines: [], resetAt: 100, resetIds: { w: ['x'] } }, 0))
    await asUser(db, A, () => push({ routines: [], resetAt: 50 }, 1))
    const row = await asUser(db, A, () => db.query<any>('select data from app_state'))
    expect(row.rows[0].data.resetAt).toBe(100)
    expect(row.rows[0].data.resetIds).toEqual({ w: ['x'] })
  })

  it.each([
    [{}, 'state_required'],
    [{ _rev: 3, _ts: 1 }, 'state_required'],
    [[1, 2], 'invalid_state'],
    [{ workouts: 'x' }, 'invalid_state']
  ])('rejects %j with %s', async (state, message) => {
    await expect(asUser(db, A, () => push(state, 0))).rejects.toThrow(message)
  })

  it('rejects a document over 2 MB', async () => {
    const big = { routines: [], blob: 'x'.repeat(2 * 1024 * 1024) }
    await expect(asUser(db, A, () => push(big, 0))).rejects.toThrow('state_too_large')
  })

  it('refuses anonymous callers', async () => {
    await expect(asUser(db, null, () => push({ routines: [] }, 0))).rejects.toThrow()
  })

  it('keeps users apart', async () => {
    await asUser(db, A, () => push({ routines: [{ id: 'mine' }] }, 0))
    const seen = await asUser(db, B, () => db.query<any>('select * from app_state'))
    expect(seen.rows).toEqual([])
    await expect(asUser(db, B, () => db.query(`update app_state set rev = 99`))).resolves.toMatchObject({ affectedRows: 0 })
  })

  it('only changes through push_state', async () => {
    await asUser(db, A, () => push({ routines: [] }, 0))
    await expect(asUser(db, A, () => db.query(`update app_state set rev = 99`))).resolves.toMatchObject({ affectedRows: 0 })
    await expect(asUser(db, A, () => db.query('delete from app_state'))).resolves.toMatchObject({ affectedRows: 0 })
    await expect(asUser(db, B, () => db.query(`insert into app_state (user_id, data) values ($1, '{}')`, [B]))).rejects.toThrow(/row-level security/)
  })
})
