// Shapes of the check-in tables (supabase/migrations/0017_checkins.sql).
export const CHECKIN_ACTIVITIES = ['strength', 'run', 'bike', 'swim', 'walk', 'sport', 'class', 'other'] as const
export type CheckinActivity = (typeof CHECKIN_ACTIVITIES)[number]

export type CheckinVisibility = 'friends' | 'private'

// What "detalhar treino" keeps: the sets that were done, per exercise (plan decision 7).
export type CheckinDetail = { entries: { id: string; sets: { w: number; r: number; done: true }[] }[] }

// A row of public.checkins as the client writes it. user_id, created_at and updated_at are
// filled by the database (user_id defaults to auth.uid() and RLS checks it), so they are optional
// here and absent from what goes out.
export type CheckinRow = {
  id: string
  user_id?: string
  day: string
  activity: CheckinActivity
  routine_id: string | null
  routine_name: string | null
  title: string
  caption: string | null
  // Private: never leaves for another account.
  note: string | null
  duration_min: number | null
  visibility: CheckinVisibility
  // <user_id>/<id>.jpg|webp in the private bucket `checkins`.
  photo_path: string
  detail: CheckinDetail | null
  created_at?: string
  updated_at?: string
}
