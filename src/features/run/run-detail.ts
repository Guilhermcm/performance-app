// The run part of a check-in (spec §7.1, plan decisions 1 to 3 and 5): `detail.run` with the
// planned workout it was linked to, the distance, the effort, the blocks run and how it went
// against the plan. checkRunDetail holds the rules of valid_run_detail and valid_run_items
// (supabase/migrations/0032_run.sql); both run the cases of supabase/tests/fixtures/run-details.json.
import { dateLocale, t } from '../../lib/i18n.js'
import { sessionName } from './labels'
import { weekMinutes } from './models'
import { currentWeek, sessionsOn } from './run-actions'
import type { Item, RunPlan, SessionType } from './types'

export type RunStatus = 'as_planned' | 'adjusted' | 'unplanned'
// The workout as the plan had it on that day: its week (Week.index), its id and type, its blocks.
export type RunPlanned = { week: number; session: string; type: SessionType; blocks: Item[] }
// unplanned: no planned. as_planned: planned, no blocks. adjusted: planned and the blocks run.
// A key the person left empty is left out, never null.
export type RunDetail = { planned?: RunPlanned; distance_km?: number; rpe?: number; blocks?: Item[]; status: RunStatus }

const ZONES = ['easy', 'moderate', 'hard', 'walk']
const TYPES: SessionType[] = ['runwalk', 'easy', 'long', 'tempo', 'intervals']
const STATUSES: RunStatus[] = ['as_planned', 'adjusted', 'unplanned']

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const wholeIn = (v: unknown, lo: number, hi: number) => isNumber(v) && Number.isInteger(v) && v >= lo && v <= hi
const keysAre = (o: Json, keys: string[]) => {
  const own = Object.keys(o).sort()
  return own.length === keys.length && own.every((k, i) => k === keys[i])
}

// valid_run_items: 1 to 12 items; a block { zone, min } with min a whole 1 to 300, or a repeat
// { repeat: 2..20, blocks } of 1 to 4 blocks. No other key.
function validItems(items: unknown): boolean {
  if (!Array.isArray(items) || items.length < 1 || items.length > 12) return false
  return items.every(item => {
    if (!isObject(item)) return false
    let blocks: unknown[] = [item]
    if ('repeat' in item) {
      if (!keysAre(item, ['blocks', 'repeat']) || !wholeIn(item.repeat, 2, 20)) return false
      if (!Array.isArray(item.blocks) || item.blocks.length < 1 || item.blocks.length > 4) return false
      blocks = item.blocks
    }
    return blocks.every(b => isObject(b) && keysAre(b, ['min', 'zone']) && typeof b.zone === 'string' &&
      ZONES.includes(b.zone) && wholeIn(b.min, 1, 300))
  })
}

// Two decimals at most, read from the number as it is written in the JSON that goes out.
const twoDecimals = (n: number) => /^\d+(\.\d{1,2})?$/.test(String(n))

/**
 * Whether the database takes `run` as the `detail.run` of a check-in of `activity`: the rules of
 * valid_run_detail, on what goes out (JSON.stringify drops a key left undefined).
 */
export function checkRunDetail(run: unknown, activity: string): boolean {
  if (activity !== 'run') return false
  let r: unknown
  try { r = JSON.parse(JSON.stringify(run) ?? 'null') } catch { return false }
  if (!isObject(r)) return false
  if (Object.keys(r).some(k => !['planned', 'distance_km', 'rpe', 'blocks', 'status'].includes(k))) return false

  const status = r.status
  if (typeof status !== 'string' || !(STATUSES as string[]).includes(status)) return false
  if ((status === 'unplanned') === ('planned' in r)) return false
  if (status === 'as_planned' && 'blocks' in r) return false
  if (status === 'adjusted' && !('blocks' in r)) return false

  if ('distance_km' in r) {
    const d = r.distance_km
    if (!isNumber(d) || d < 0.1 || d > 100 || !twoDecimals(d)) return false
  }
  if ('rpe' in r && !wholeIn(r.rpe, 1, 10)) return false
  if ('blocks' in r && !validItems(r.blocks)) return false

  if ('planned' in r) {
    const p = r.planned
    if (!isObject(p) || !keysAre(p, ['blocks', 'session', 'type', 'week'])) return false
    if (!wholeIn(p.week, 1, 64)) return false
    if (typeof p.session !== 'string' || p.session.length > 16 || !/^w[1-9][0-9]*-s[1-9][0-9]*$/.test(p.session)) return false
    if (typeof p.type !== 'string' || !(TYPES as string[]).includes(p.type)) return false
    if (!validItems(p.blocks)) return false
  }
  return true
}

/**
 * The workout the plan has on `iso`, to link a run check-in to: a copy of the day's first session,
 * with `week` the index of its plan week. Null on a day without one, outside the plan, or for a
 * plan this build does not read. `weekStart` (S.weekStart) is the fallback for plans saved without
 * their own.
 */
export function plannedOn(plan: RunPlan | null, iso: string, weekStart: 0 | 1): RunPlanned | null {
  const week = currentWeek(plan, iso, weekStart)
  const s = week ? sessionsOn(plan, iso, weekStart)[0] : undefined
  if (!week || !s) return null
  return { week: week.index, session: s.id, type: s.type, blocks: JSON.parse(JSON.stringify(s.blocks)) as Item[] }
}

/** The minutes of a workout, each repeat counted as many times as it goes. */
export const plannedMinutes = (items: Item[]): number => weekMinutes({ sessions: [{ blocks: items }] })

/**
 * The distance typed in the check-in, in km: a comma or a dot, from 0.1 to 100, with two decimals
 * at most. Null for anything else.
 */
export function parseKm(text: string): number | null {
  const s = text.trim()
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(s)) return null
  const km = Number(s.replace(',', '.'))
  return km >= 0.1 && km <= 100 ? km : null
}

/** A distance with the decimal mark of the language: "6,2" in pt-BR. */
export const formatKm = (km: number): string => km.toLocaleString(dateLocale(), { maximumFractionDigits: 2 })

// Whether `title` already ends with the duration text, like the title the check-in suggests
// ("Corrida · 38 min"), and not with a longer number ("138 min").
function endsWithDuration(title: string | null | undefined, duration: string): boolean {
  if (!title?.endsWith(duration)) return false
  return !/\d/.test(title.charAt(title.length - duration.length - 1))
}

/**
 * The line of a run check-in in the feed (plan decision 5): "Intervalado · 6,2 km · 38 min", the
 * type, the distance and the duration, each when there is one. The duration stays out when the
 * post's `title` already ends with it (1e-b final review M3).
 */
export function runLine(p: { run_type?: SessionType | null; distance_km?: number | null; duration_min: number | null; title?: string | null }): string {
  const duration = p.duration_min ? t('{0} min', p.duration_min) : null
  return [
    p.run_type ? sessionName(p.run_type) : null,
    p.distance_km != null ? t('{0} km', formatKm(p.distance_km)) : null,
    duration && !endsWithDuration(p.title, duration) ? duration : null
  ].filter(Boolean).join(' · ')
}
