import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, addUser, asUser } from './helpers/db'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

const today = async () => (await db.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`)).rows[0].d
const emit = (kind: string, occurredOn: string, ref = 'r1', payload: unknown = {}) =>
  db.query(`insert into activity_events (pillar, kind, occurred_on, payload, source_ref) values ('strength', $1, $2, $3::jsonb, $4)`,
    [kind, occurredOn, JSON.stringify(payload), ref])

beforeEach(async () => {
  db = await freshDb()
  await addUser(db, A)
  await addUser(db, B)
  await asUser(db, A, () => db.query(`insert into profiles (id, display_name) values ($1, 'Ana')`, [A]))
})

describe('activity_events', () => {
  it('accepts the Phase 0 kinds and stamps the caller as owner', async () => {
    const d = await today()
    for (const k of ['workout_completed', 'pr', 'weight_logged']) await asUser(db, A, () => emit(k, d, k))
    const rows = await asUser(db, A, () => db.query<any>('select user_id, kind from activity_events order by id'))
    expect(rows.rows.map(r => r.kind)).toEqual(['workout_completed', 'pr', 'weight_logged'])
    expect(rows.rows.every(r => r.user_id === A)).toBe(true)
  })

  it('is idempotent per (user, kind, source_ref)', async () => {
    const d = await today()
    await asUser(db, A, () => emit('workout_completed', d, 's1'))
    await expect(asUser(db, A, () => emit('workout_completed', d, 's1'))).rejects.toThrow(/duplicate key/)
  })

  it('rejects unknown kinds', async () => {
    await expect(asUser(db, A, () => emit('sleep_logged', '2026-01-01'))).rejects.toThrow('unknown_kind')
  })

  it('rejects dates in the future or older than 14 days', async () => {
    const future = (await db.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date + 1, 'YYYY-MM-DD') as d`)).rows[0].d
    const old = (await db.query<{ d: string }>(`select to_char((now() at time zone 'America/Sao_Paulo')::date - 15, 'YYYY-MM-DD') as d`)).rows[0].d
    await expect(asUser(db, A, () => emit('pr', future))).rejects.toThrow('out_of_window')
    await expect(asUser(db, A, () => emit('pr', old))).rejects.toThrow('out_of_window')
  })

  it('rejects payloads over 4 KB', async () => {
    const d = await today()
    await expect(asUser(db, A, () => emit('pr', d, 'x', { s: 'x'.repeat(5000) }))).rejects.toThrow('payload_too_large')
  })

  it('hides other users events', async () => {
    const d = await today()
    await asUser(db, A, () => emit('pr', d, 'mine'))
    const seen = await asUser(db, B, () => db.query('select * from activity_events'))
    expect(seen.rows).toEqual([])
  })

  it('keeps the kind catalogue read-only for clients', async () => {
    const kinds = await asUser(db, A, () => db.query('select * from event_kinds'))
    expect(kinds.rows).toHaveLength(6)
    await expect(asUser(db, A, () => db.query(`insert into event_kinds values ('sleep', 'sleep_logged')`))).rejects.toThrow(/row-level security/)
  })

  it('does not let users edit or delete their events', async () => {
    const d = await today()
    await asUser(db, A, () => emit('pr', d, 'mine'))
    await expect(asUser(db, A, () => db.query(`update activity_events set kind = 'x'`))).resolves.toMatchObject({ affectedRows: 0 })
    await expect(asUser(db, A, () => db.query('delete from activity_events'))).resolves.toMatchObject({ affectedRows: 0 })
  })
})
