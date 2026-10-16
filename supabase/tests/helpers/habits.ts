import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { asUser } from './db'

export const H = '00000000-0000-0000-0000-000000000010'

// Turns the pillar on or off the way the app does: the owner updates their own profile.
export async function enableHabits(db: PGlite, uid: string, on = true) {
  await asUser(db, uid, () =>
    db.query('update public.profiles set habits_enabled = $1 where id = $2', [on, uid]))
}

export type HabitOptions = {
  id?: string
  name?: string
  icon?: string
  perWeek?: number
  sort?: number
  asOwner?: boolean
  createdAt?: string
}

// Creates a habit as the signed-in person, the way the client does (or as the database owner with
// asOwner), and returns its id. created_at defaults to the pinned clock so the freezing rules,
// which read it, see the test's dates rather than the real ones.
export async function addHabit(db: PGlite, uid: string, over: HabitOptions = {}): Promise<string> {
  const id = over.id ?? randomUUID()
  const q = `insert into public.habits (id, user_id, name, icon, per_week, sort, created_at)
             values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, public.app_now()))`
  const params = [id, uid, over.name ?? 'Ler', over.icon ?? 'book', over.perWeek ?? 7, over.sort ?? 0,
    over.createdAt ?? null]
  if (over.asOwner) await db.query(q, params)
  else await asUser(db, uid, () => db.query(q, params))
  return id
}

// Archives (or reactivates) a habit as its owner, the way the client does.
export async function archiveHabit(db: PGlite, uid: string, id: string, archived = true) {
  await asUser(db, uid, () =>
    db.query(`update public.habits set archived_at = case when $1 then now() end where id = $2`, [archived, id]))
}

// Writes a week's target as the database owner (the way the server or a test fixture would).
export async function setHabitTarget(db: PGlite, habitId: string, uid: string, week: string, target: number) {
  await db.query(
    `insert into public.habit_targets (habit_id, user_id, week_start, target) values ($1, $2, $3, $4)
     on conflict (habit_id, week_start) do update set target = excluded.target`,
    [habitId, uid, week, target])
}

// Checks a habit on a day as the signed-in person, or as the database owner with asOwner (for days
// the client could no longer write).
export async function checkHabit(
  db: PGlite, uid: string, habitId: string, day: string, over: { asOwner?: boolean } = {},
) {
  const q = 'insert into public.habit_checks (habit_id, user_id, day) values ($1, $2, $3)'
  if (over.asOwner) await db.query(q, [habitId, uid, day])
  else await asUser(db, uid, () => db.query(q, [habitId, uid, day]))
}

export async function uncheckHabit(db: PGlite, uid: string, habitId: string, day: string) {
  await asUser(db, uid, () =>
    db.query('delete from public.habit_checks where habit_id = $1 and day = $2', [habitId, day]))
}

export async function targetOf(db: PGlite, habitId: string, week: string): Promise<number | null> {
  const { rows } = await db.query<{ target: number }>(
    'select target from public.habit_targets where habit_id = $1 and week_start = $2', [habitId, week])
  return rows[0]?.target ?? null
}

// Closes the pending days of a person the way the server does (as the database owner) and returns
// how many days it closed.
export async function closeHabitsAs(db: PGlite, uid: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>('select public.close_habit_days($1) as n', [uid])
  return rows[0].n
}
