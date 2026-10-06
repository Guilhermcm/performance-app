import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { asUser } from './db'

export type CheckinOpts = {
  day?: string
  visibility?: 'friends' | 'private'
  activity?: string
  note?: string | null
  detail?: unknown
}

// Posts a check-in as the signed-in person, the way the client does: the id is made on the device
// and the photo sits at <user_id>/<checkin_id>.jpg. The day defaults to the person's local today.
export async function addCheckin(db: PGlite, uid: string, opts: CheckinOpts = {}): Promise<string> {
  const id = randomUUID()
  await asUser(db, uid, () => db.query(
    `insert into public.checkins (id, day, activity, title, note, visibility, photo_path, detail)
     values ($1, coalesce($2::date, public.my_local_today()), $3, 'Treino', $4, $5, $6, $7::jsonb)`,
    [id, opts.day ?? null, opts.activity ?? 'strength', opts.note ?? null, opts.visibility ?? 'friends',
      `${uid}/${id}.jpg`, opts.detail === undefined ? null : JSON.stringify(opts.detail)]))
  return id
}
