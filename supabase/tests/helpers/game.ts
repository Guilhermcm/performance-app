import type { PGlite } from '@electric-sql/pglite'
import { addUser } from './db'

export const A = '00000000-0000-0000-0000-00000000000a'
export const B = '00000000-0000-0000-0000-00000000000b'

export async function sql<T = Record<string, any>>(db: PGlite, q: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(q, params)).rows
}

// Pins the clock app_now() reads (superuser sessions only, which the tests are). null unpins it.
export async function setClock(db: PGlite, at: string | null) {
  await db.query(`select set_config('app.now', $1, false)`, [at ?? ''])
}

// validate_activity_event checks the 14-day window against the real clock. Tests that live on
// fixed dates switch that one check off; the XP trigger stays on.
export async function withoutEventWindow(db: PGlite) {
  await db.exec('alter table public.activity_events disable trigger activity_events_validate')
}

export async function makeUser(db: PGlite, uid: string, over: Record<string, unknown> = {}) {
  await addUser(db, uid)
  const row = { id: uid, display_name: 'Ana', days_per_week: 3, ...over }
  const cols = Object.keys(row)
  await db.query(
    `insert into public.profiles (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`,
    Object.values(row)
  )
}

// Inserted as the database owner with user_id set, which is what the triggers see from a client.
export async function event(db: PGlite, uid: string, kind: string, on: string, ref: string, payload: Record<string, unknown> = {}) {
  await db.query(
    `insert into public.activity_events (user_id, pillar, kind, occurred_on, payload, source_ref)
     values ($1, 'strength', $2, $3, $4::jsonb, $5)`,
    [uid, kind, on, JSON.stringify(payload), ref]
  )
}

export type LedgerRow = { reason: string; amount: number; week_start: string; pillar: string | null }

export async function ledger(db: PGlite, uid: string): Promise<LedgerRow[]> {
  return sql<LedgerRow>(db,
    `select reason, amount, to_char(week_start, 'YYYY-MM-DD') as week_start, pillar::text as pillar
       from public.xp_ledger where user_id = $1 order by id`, [uid])
}

// The phase 1c cutover (app_settings.training_checkin_since) is the day the migrations ran, so a
// fixed test date may fall on either side of it depending on when the suite runs. Tests about the
// workout rules from before check-ins move it far ahead: every workout_completed pays as it used to.
export async function legacyTraining(db: PGlite) {
  await db.query(`update public.app_settings set value = '"2999-12-31"' where key = 'training_checkin_since'`)
}
