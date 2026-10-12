import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './db'

export const S = '00000000-0000-0000-0000-00000000000f'

// Turns the pillar on or off the way the app does: the owner updates their own profile.
export async function enableSleep(db: PGlite, uid: string, on = true) {
  await asUser(db, uid, () =>
    db.query('update public.profiles set sleep_enabled = $1 where id = $2', [on, uid]))
}

// Inserts a target as the database owner (the way the server or a test fixture would).
export async function setSleepTarget(
  db: PGlite, uid: string, validFrom: string, goalMin = 480, bedTarget = '23:00',
) {
  await db.query(
    'insert into public.sleep_targets (user_id, valid_from, goal_min, bed_target) values ($1, $2, $3, $4)',
    [uid, validFrom, goalMin, bedTarget])
}

export type NightOptions = {
  quality?: number | null
  note?: string | null
  updatedAt?: string
  asOwner?: boolean
}

// Logs a night as the signed-in person, the way the client does, or as the database owner with
// asOwner (for nights the client could no longer write).
export async function logNight(
  db: PGlite, uid: string, night: string, bed: string, wake: string, over: NightOptions = {},
) {
  const cols = ['user_id', 'night', 'bed_time', 'wake_time', 'quality', 'note']
  const params: unknown[] = [uid, night, bed, wake, over.quality ?? null, over.note ?? null]
  if (over.updatedAt !== undefined) {
    cols.push('updated_at')
    params.push(over.updatedAt)
  }
  const q = `insert into public.sleep_logs (${cols.join(', ')})
             values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`
  if (over.asOwner) await db.query(q, params)
  else await asUser(db, uid, () => db.query(q, params))
}
