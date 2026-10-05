import { supabase } from '@/lib/supabase'
import type { FoodLog, NutritionDay, NutritionTarget, UserFood } from './types'

export type NutritionErrorCode = 'day_closed' | 'too_many_items' | 'network'

export class NutritionError extends Error {
  readonly code: NutritionErrorCode
  constructor(code: NutritionErrorCode) {
    super(code)
    this.name = 'NutritionError'
    this.code = code
  }
}

// The triggers of 0009_nutrition_diary.sql raise their typed errors with the code as the message.
// Anything else (no network, an expired session) is "try again".
const KNOWN: readonly NutritionErrorCode[] = ['day_closed', 'too_many_items']
// Refusals no retry can fix: the queue drops these instead of blocking everything behind them.
const REFUSED = ['day_closed', 'too_many_items', 'item_immutable', 'import_forbidden']

const messageOf = (e: unknown) => {
  const m = (e as { message?: unknown } | null)?.message
  return typeof m === 'string' ? m : ''
}

export function toNutritionError(e: unknown): NutritionErrorCode {
  if (e instanceof NutritionError) return e.code
  const m = messageOf(e)
  return (KNOWN as readonly string[]).includes(m) ? (m as NutritionErrorCode) : 'network'
}

export const isRefused = (e: unknown): boolean => {
  if (e instanceof NutritionError) return e.code !== 'network'
  return REFUSED.includes(messageOf(e))
}

const fail = (e: unknown): never => { throw new NutritionError(toNutritionError(e)) }

type Answer<T> = PromiseLike<{ data: T | null; error: unknown }>
async function run<T>(q: Answer<T>): Promise<T | null> {
  let res: { data: T | null; error: unknown }
  try { res = await q } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  return res.data
}

type Row = Record<string, unknown>
const num = (v: unknown) => Number(v)
const numOrNull = (v: unknown) => (v == null ? null : Number(v))

const toLog = (r: Row): FoodLog => ({
  id: r.id as string, day: r.day as string, meal: r.meal as FoodLog['meal'], name: r.name as string,
  brand: (r.brand as string | null) ?? null, source: r.source as FoodLog['source'], source_id: (r.source_id as string | null) ?? null,
  grams: numOrNull(r.grams), kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
  fiber_g: numOrNull(r.fiber_g), updated_at: r.updated_at as string
})

const toFood = (r: Row): UserFood => ({
  id: r.id as string, source: r.source as UserFood['source'], source_id: (r.source_id as string | null) ?? null,
  barcode: (r.barcode as string | null) ?? null, favorite: !!r.favorite, name: r.name as string, brand: (r.brand as string | null) ?? null,
  per100: { kcal: num(r.kcal_100g), protein: num(r.protein_100g), carbs: num(r.carbs_100g), fat: num(r.fat_100g) },
  serving_g: numOrNull(r.serving_g), serving_label: (r.serving_label as string | null) ?? null, updated_at: r.updated_at as string
})

const toTarget = (r: Row): NutritionTarget => ({
  valid_from: r.valid_from as string, mode: r.mode as NutritionTarget['mode'],
  kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g)
})

// Rows are written without user_id: the column defaults to auth.uid() and RLS checks it.
export async function fetchLogs(from: string, to: string): Promise<FoodLog[]> {
  const rows = await run<Row[]>(supabase.from('food_logs').select('*').gte('day', from).lte('day', to).order('updated_at', { ascending: true }) as never)
  return (rows ?? []).map(toLog)
}

export async function upsertLog(l: FoodLog): Promise<void> {
  const row = {
    id: l.id, day: l.day, meal: l.meal, name: l.name, brand: l.brand, source: l.source, source_id: l.source_id, grams: l.grams,
    kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g, fiber_g: l.fiber_g, updated_at: l.updated_at
  }
  await run(supabase.from('food_logs').upsert(row as never) as never)
}

export async function deleteLog(id: string): Promise<void> {
  await run(supabase.from('food_logs').delete().eq('id', id) as never)
}

export async function fetchFoods(): Promise<UserFood[]> {
  const rows = await run<Row[]>(supabase.from('user_foods').select('*').order('updated_at', { ascending: false }) as never)
  return (rows ?? []).map(toFood)
}

export async function upsertFood(f: UserFood): Promise<void> {
  const row = {
    id: f.id, source: f.source, source_id: f.source_id, barcode: f.barcode, favorite: f.favorite, name: f.name, brand: f.brand,
    kcal_100g: f.per100.kcal, protein_100g: f.per100.protein, carbs_100g: f.per100.carbs, fat_100g: f.per100.fat,
    serving_g: f.serving_g, serving_label: f.serving_label, updated_at: f.updated_at
  }
  await run(supabase.from('user_foods').upsert(row as never) as never)
}

export async function deleteFood(id: string): Promise<void> {
  await run(supabase.from('user_foods').delete().eq('id', id) as never)
}

export async function fetchTargets(): Promise<NutritionTarget[]> {
  const rows = await run<Row[]>(supabase.from('nutrition_targets').select('*').order('valid_from', { ascending: true }) as never)
  return (rows ?? []).map(toTarget)
}

// An upsert, not an insert: a second weigh-in the same day rewrites tomorrow's row (the policy
// allows updates only on rows that start after today).
export async function insertTarget(t: NutritionTarget): Promise<void> {
  const row = { valid_from: t.valid_from, mode: t.mode, kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g }
  await run(supabase.from('nutrition_targets').upsert(row as never, { onConflict: 'user_id,valid_from' }) as never)
}

export async function fetchDays(from: string, to: string): Promise<{ target: NutritionTarget | null; days: NutritionDay[] }> {
  const call = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  let res: { data: unknown; error: unknown }
  try { res = await call('get_nutrition_days', { p_from: from, p_to: to }) } catch (e) { return fail(e) }
  if (res.error) fail(res.error)
  const d = res.data as { target: NutritionTarget | null; days: NutritionDay[] } | null
  return { target: d?.target ?? null, days: d?.days ?? [] }
}
