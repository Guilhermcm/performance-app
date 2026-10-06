import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './db'

export const N = '00000000-0000-0000-0000-00000000000e'

// Turns the pillar on or off the way the app does: the owner updates their own profile.
export async function enableNutrition(db: PGlite, uid: string, on = true) {
  await asUser(db, uid, () =>
    db.query('update public.profiles set nutrition_enabled = $1 where id = $2', [on, uid]))
}

// Inserts a diary item as the signed-in person, the way the client does.
export async function logItem(
  db: PGlite, uid: string, day: string, meal: string, kcal: number,
  protein = 0, carbs = 0, fat = 0, id: string = randomUUID(),
) {
  await asUser(db, uid, () => db.query(
    `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
     values ($1, $2, $3, $4, 'Item', 'quick', $5, $6, $7, $8)`,
    [id, uid, day, meal, kcal, protein, carbs, fat]))
  return id
}

export type TargetValues = { kcal: number; protein_g: number; carbs_g: number; fat_g: number }

// Inserts a target as the database owner (the way the server or a test fixture would).
export async function setTarget(
  db: PGlite, uid: string, validFrom: string, t: TargetValues, mode: 'auto' | 'manual' = 'auto',
) {
  await db.query(
    `insert into public.nutrition_targets (user_id, valid_from, kcal, protein_g, carbs_g, fat_g, mode)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [uid, validFrom, t.kcal, t.protein_g, t.carbs_g, t.fat_g, mode])
}

// Closes the pending days of a person the way the server does (as the database owner) and returns
// how many days it closed.
export async function closeAs(db: PGlite, uid: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>('select public.close_nutrition_days($1) as n', [uid])
  return rows[0].n
}
