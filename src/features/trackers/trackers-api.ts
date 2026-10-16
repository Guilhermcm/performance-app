import { supabase } from '@/lib/supabase'
import { classify } from '@/lib/supabase-errors'
import type { Aggregate, Tracker, TrackerEntry, TrackerKind, TrackerOption } from './types'

const fail = (e: unknown): never => { throw classify(e) }

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>
async function run<T>(q: Answer<T>): Promise<T | null> {
  let res: { data: T | null; error: unknown }
  try { res = await q } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  return res.data
}

type Row = Record<string, unknown>
const num = (v: unknown): number | null => (v == null ? null : Number(v))

const toTracker = (r: Row): Tracker => ({
  id: r.id as string, name: r.name as string, icon: r.icon as string, kind: r.kind as TrackerKind,
  unit: (r.unit as string | null) ?? null, decimals: num(r.decimals), aggregate: (r.aggregate as Aggregate | null) ?? null,
  options: (r.options as TrackerOption[] | null) ?? null, sort: Number(r.sort),
  archived_at: (r.archived_at as string | null) ?? null, created_at: r.created_at as string, updated_at: r.updated_at as string
})

// `at` is a time column: PostgREST sends HH:MM:SS, the app keeps HH:MM (the seconds are always zero).
const toEntry = (r: Row): TrackerEntry => ({
  id: r.id as string, tracker_id: r.tracker_id as string, day: r.day as string, at: String(r.at).slice(0, 5),
  value: num(r.value), minutes: num(r.minutes), option: (r.option as string | null) ?? null,
  note: (r.note as string | null) ?? null, updated_at: r.updated_at as string
})

// Every tracker, active and archived, in list order.
export async function fetchTrackers(): Promise<Tracker[]> {
  const rows = await run<Row[]>(supabase.from('trackers').select('*').order('sort', { ascending: true }).order('id', { ascending: true }) as never)
  return (rows ?? []).map(toTracker)
}

// The API answers at most 1000 rows a request (Supabase's "Max rows") and says nothing when it cuts.
const PAGE = 1000

// The entries of every tracker from `from` on (plan decision 5: the last 90 days), oldest first,
// read a page at a time until one comes back short, so the cap never drops the newest ones.
export async function fetchEntries(from: string): Promise<TrackerEntry[]> {
  // By id: a write between two reads can move a row onto the next page; the later copy stays.
  const out = new Map<string, TrackerEntry>()
  for (let start = 0; ; start += PAGE) {
    const rows = await run<Row[]>(supabase.from('tracker_entries').select('id, tracker_id, day, at, value, minutes, option, note, updated_at')
      .gte('day', from).order('day', { ascending: true }).order('at', { ascending: true }).order('id', { ascending: true })
      .range(start, start + PAGE - 1) as never)
    const page = rows ?? []
    for (const r of page) {
      const e = toEntry(r)
      out.delete(e.id)
      out.set(e.id, e)
    }
    if (page.length < PAGE) return [...out.values()]
  }
}

// The id comes from the device, so creating and editing are the same upsert and a resend changes
// nothing. Written without user_id (it defaults to auth.uid() and RLS checks it) and without
// created_at (the server's). The server keeps the newest updated_at, so an older edit is dropped.
export async function upsertTracker(t: Tracker): Promise<void> {
  const row = {
    id: t.id, name: t.name, icon: t.icon, kind: t.kind, unit: t.unit, decimals: t.decimals, aggregate: t.aggregate,
    options: t.options, sort: t.sort, archived_at: t.archived_at, updated_at: t.updated_at
  }
  await run(supabase.from('trackers').upsert(row as never, { onConflict: 'id' }) as never)
}

// A reorder sends the sort alone, as an update: a full row from a copy that has not heard of another
// device's archive or rename would undo it. A tracker the server does not have matches no row.
export async function updateTrackerSort(id: string, sort: number, updatedAt: string): Promise<void> {
  await run(supabase.from('trackers').update({ sort, updated_at: updatedAt } as never).eq('id', id) as never)
}

// Same upsert by id for an entry; editing one of an archived tracker goes through (the guard only
// refuses a new one).
export async function upsertEntry(e: TrackerEntry): Promise<void> {
  const row = {
    id: e.id, tracker_id: e.tracker_id, day: e.day, at: e.at, value: e.value, minutes: e.minutes, option: e.option,
    note: e.note, updated_at: e.updated_at
  }
  await run(supabase.from('tracker_entries').upsert(row as never, { onConflict: 'id' }) as never)
}

// An entry the server does not have matches no row and changes nothing.
export async function deleteEntry(id: string): Promise<void> {
  await run(supabase.from('tracker_entries').delete().eq('id', id) as never)
}

export type TrackerErrorCode = 'too_many_trackers' | 'option_in_use' | 'tracker_archived' | 'future_day' | 'invalid_value' | 'invalid_options'
const CODES: readonly string[] = ['too_many_trackers', 'option_in_use', 'tracker_archived', 'future_day', 'invalid_value', 'invalid_options']

// The server's own rule when a failed write named one a sheet has words for; null for anything
// else (a bad network, another refusal).
export function toTrackerError(e: unknown): TrackerErrorCode | null {
  const { detail } = classify(e)
  return CODES.includes(detail) ? (detail as TrackerErrorCode) : null
}
