import { supabase } from '@/lib/supabase'
import { classify } from '@/lib/supabase-errors'
import type { Habit, HabitCheck, HabitHistory, HabitPeriod, HabitTarget } from './types'

const fail = (e: unknown): never => { throw classify(e) }

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>
async function run<T>(q: Answer<T>): Promise<T | null> {
  let res: { data: T | null; error: unknown }
  try { res = await q } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  return res.data
}

type Row = Record<string, unknown>

const toHabit = (r: Row): Habit => ({
  id: r.id as string, name: r.name as string, icon: r.icon as string, per_week: Number(r.per_week), sort: Number(r.sort),
  archived_at: (r.archived_at as string | null) ?? null, created_at: r.created_at as string, updated_at: r.updated_at as string
})
const toCheck = (r: Row): HabitCheck => ({ habit_id: r.habit_id as string, day: r.day as string, counted: (r.counted as boolean | null) ?? null })
const toTarget = (r: Row): HabitTarget => ({ habit_id: r.habit_id as string, week_start: r.week_start as string, target: Number(r.target) })

// Every habit, active and archived, in list order.
export async function fetchHabits(): Promise<Habit[]> {
  const rows = await run<Row[]>(supabase.from('habits').select('*').order('sort', { ascending: true }).order('id', { ascending: true }) as never)
  return (rows ?? []).map(toHabit)
}

// The id comes from the device, so creating and editing are the same upsert and a resend changes
// nothing. Written without user_id (it defaults to auth.uid() and RLS checks it) and without
// created_at (the server's). The server keeps the newest updated_at, so an older edit is dropped.
export async function upsertHabit(h: Habit): Promise<void> {
  const row = { id: h.id, name: h.name, icon: h.icon, per_week: h.per_week, sort: h.sort, archived_at: h.archived_at, updated_at: h.updated_at }
  await run(supabase.from('habits').upsert(row as never, { onConflict: 'id' }) as never)
}

// A reorder sends the sort alone, as an update: a full row from a copy that has not heard of another
// device's archive or rename would undo it (the newest updated_at wins on the whole row). A habit the
// server does not have matches no row and changes nothing.
export async function updateHabitSort(id: string, sort: number, updatedAt: string): Promise<void> {
  await run(supabase.from('habits').update({ sort, updated_at: updatedAt } as never).eq('id', id) as never)
}

export async function fetchChecks(from: string, to: string): Promise<HabitCheck[]> {
  const rows = await run<Row[]>(supabase.from('habit_checks').select('habit_id, day, counted').gte('day', from).lte('day', to).order('day', { ascending: true }) as never)
  return (rows ?? []).map(toCheck)
}

// One check per habit and day: a check already there is left as it is.
export async function insertCheck(habitId: string, day: string): Promise<void> {
  await run(supabase.from('habit_checks').upsert({ habit_id: habitId, day } as never, { onConflict: 'habit_id,day', ignoreDuplicates: true }) as never)
}

export async function deleteCheck(habitId: string, day: string): Promise<void> {
  await run(supabase.from('habit_checks').delete().eq('habit_id', habitId).eq('day', day) as never)
}

// The frozen targets of one week (its Monday), one row per habit that has one.
export async function fetchTargets(week: string): Promise<HabitTarget[]> {
  const rows = await run<Row[]>(supabase.from('habit_targets').select('habit_id, week_start, target').eq('week_start', week) as never)
  return (rows ?? []).map(toTarget)
}

// The closed days of a range of at most 62 days, its checks (counted is null on open days), the
// targets of the weeks it touches and the periods. The call closes the days that are due first.
export async function fetchHistory(from: string, to: string): Promise<HabitHistory> {
  const call = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  let res: { data: unknown; error: unknown }
  try { res = await call('get_habit_history', { p_from: from, p_to: to }) } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  const d = res.data as Partial<HabitHistory> | null
  return { days: d?.days ?? [], checks: d?.checks ?? [], targets: d?.targets ?? [], periods: d?.periods ?? [] }
}

// Every period of the pillar, oldest first: the calendar goes back to the first one, which
// get_habit_history only returns when its range reaches it.
export async function fetchPeriods(): Promise<HabitPeriod[]> {
  const rows = await run<Row[]>(supabase.from('habit_periods').select('started_on, ended_on').order('started_on', { ascending: true }) as never)
  return (rows ?? []).map(r => ({ started_on: r.started_on as string, ended_on: (r.ended_on as string | null) ?? null }))
}

export type HabitErrorCode = 'day_closed' | 'habit_archived' | 'pillar_off' | 'too_many_habits' | 'network' | 'refused'
const CODES: readonly string[] = ['day_closed', 'habit_archived', 'pillar_off', 'too_many_habits']

// What a screen says about a failed write: the server's own rule when it named one, else whether
// trying again can help.
export function toHabitError(e: unknown): HabitErrorCode {
  const err = classify(e)
  if (CODES.includes(err.detail)) return err.detail as HabitErrorCode
  return err.refused ? 'refused' : 'network'
}
