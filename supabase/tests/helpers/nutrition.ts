import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './db'

export const N = '00000000-0000-0000-0000-00000000000e'

// Turns the pillar on or off the way the app does: the owner updates their own profile.
export async function enableNutrition(db: PGlite, uid: string, on = true) {
  await asUser(db, uid, () =>
    db.query('update public.profiles set nutrition_enabled = $1 where id = $2', [on, uid]))
}
