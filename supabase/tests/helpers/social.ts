import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './db'
import { sql } from './game'

export const C = '00000000-0000-0000-0000-00000000000c'
export const D = '00000000-0000-0000-0000-00000000000d'

// Runs a statement as a signed-in user (or anon with null), the way PostgREST would.
export async function rows<T = any>(db: PGlite, uid: string | null, text: string, params: unknown[] = []): Promise<T[]> {
  return (await asUser(db, uid, () => db.query<T>(text, params))).rows
}

// The value of a `select ... as v` run as that user.
export async function one<T = any>(db: PGlite, uid: string | null, text: string, params: unknown[] = []): Promise<T> {
  const [r] = await rows<{ v: T }>(db, uid, text, params)
  return r.v
}

// A friendship straight into the table (as the owner), for tests that are not about invites.
export async function befriend(db: PGlite, a: string, b: string, at = '2026-10-01T12:00:00Z') {
  const [x, y] = a < b ? [a, b] : [b, a]
  await sql(db, 'insert into public.friendships (user_a, user_b, created_at) values ($1, $2, $3)', [x, y, at])
}

// A general XP row in a given week, for ranking tests that need exact numbers.
export async function xp(db: PGlite, uid: string, amount: number, week: string, reason: string) {
  await sql(db,
    `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start) values ($1, null, $2, $3, null, $4)`,
    [uid, amount, reason, week])
}
