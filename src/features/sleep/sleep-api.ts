import { supabase } from '@/lib/supabase'
import { classify } from '@/lib/supabase-errors'
import type { SleepHistory, SleepLog, SleepTarget } from './types'

const fail = (e: unknown): never => { throw classify(e) }

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>
async function run<T>(q: Answer<T>): Promise<T | null> {
  let res: { data: T | null; error: unknown }
  try { res = await q } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  return res.data
}

type Row = Record<string, unknown>
// Postgres `time` comes back as 'HH:MM:SS'; the app works in 'HH:MM' (the seconds are always 0).
const hhmm = (v: unknown) => String(v).slice(0, 5)

const toLog = (r: Row): SleepLog => ({
  night: r.night as string, bed_time: hhmm(r.bed_time), wake_time: hhmm(r.wake_time), duration_min: Number(r.duration_min),
  quality: r.quality == null ? null : Number(r.quality), note: (r.note as string | null) ?? null, updated_at: r.updated_at as string
})

const toTarget = (r: Row): SleepTarget => ({ valid_from: r.valid_from as string, goal_min: Number(r.goal_min), bed_target: hhmm(r.bed_target) })

// Today and yesterday are read straight from sleep_logs; older nights come closed from get_sleep_nights.
export async function fetchLogs(from: string, to: string): Promise<SleepLog[]> {
  const rows = await run<Row[]>(supabase.from('sleep_logs').select('*').gte('night', from).lte('night', to).order('night', { ascending: true }) as never)
  return (rows ?? []).map(toLog)
}

// Written without user_id (it defaults to auth.uid() and RLS checks it) and without duration_min
// (generated). One row per night: the conflict target is the primary key. The server keeps the
// newest updated_at, so a late write from another device does not undo a newer one.
export async function upsertLog(l: SleepLog): Promise<void> {
  const row = { night: l.night, bed_time: l.bed_time, wake_time: l.wake_time, quality: l.quality, note: l.note, updated_at: l.updated_at }
  await run(supabase.from('sleep_logs').upsert(row as never, { onConflict: 'user_id,night' }) as never)
}

export async function deleteLog(night: string): Promise<void> {
  await run(supabase.from('sleep_logs').delete().eq('night', night) as never)
}

export async function fetchTargets(): Promise<SleepTarget[]> {
  const rows = await run<Row[]>(supabase.from('sleep_targets').select('*').order('valid_from', { ascending: true }) as never)
  return (rows ?? []).map(toTarget)
}

// An upsert: a second change on the same day rewrites tomorrow's row (the policy lets a row change
// only while it is still in the future; the first target may start today).
export async function insertTarget(t: SleepTarget): Promise<void> {
  const row = { valid_from: t.valid_from, goal_min: t.goal_min, bed_target: t.bed_target }
  await run(supabase.from('sleep_targets').upsert(row as never, { onConflict: 'user_id,valid_from' }) as never)
}

// Closed nights of a range of at most 62 days, the weeks it touches and the periods, with the
// clock already as 'HH:MM'. The call closes the nights that are due first.
export async function fetchNights(from: string, to: string): Promise<SleepHistory> {
  const call = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  let res: { data: unknown; error: unknown }
  try { res = await call('get_sleep_nights', { p_from: from, p_to: to }) } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  const d = res.data as Partial<SleepHistory> | null
  return { nights: d?.nights ?? [], weeks: d?.weeks ?? [], periods: d?.periods ?? [] }
}

export type SleepErrorCode = 'night_closed' | 'invalid_duration' | 'network' | 'refused'

// What a screen tells the person: a closed night, a duration out of range (the check of sleep_logs,
// 23514), another refusal for good, or "try again".
export function toSleepError(e: unknown): SleepErrorCode {
  const err = classify(e)
  if (err.code === 'night_closed') return 'night_closed'
  if (err.sqlstate === '23514') return 'invalid_duration'
  return err.refused ? 'refused' : 'network'
}
