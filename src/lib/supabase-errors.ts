// Tells a write the server refused for good from one that only needs another try. Shared by the
// offline queues (nutrition, sleep, habits, check-in): a refused op is dropped with its reason, anything else
// stops the queue and stays in it.
export type NutritionErrorCode = 'day_closed' | 'night_closed' | 'too_many_items' | 'too_many_checkins' | 'item_immutable' | 'network'

// A closed day (diary) or night (sleep) gets its own reason so the screen can say so; the rest is 'refused'.
export type RefusedReason = 'day_closed' | 'night_closed' | 'refused'
const CLOSED: readonly string[] = ['day_closed', 'night_closed']

export class NutritionError extends Error {
  readonly code: NutritionErrorCode
  // True when the server refused the write for good: retrying the same op can never work.
  readonly refused: boolean
  readonly reason: RefusedReason | null
  // The server's raw SQLSTATE and message, kept so callers can tell a refusal from a bad network.
  readonly sqlstate: string | null
  readonly detail: string
  constructor(code: NutritionErrorCode, extra: { refused?: boolean; reason?: RefusedReason | null; sqlstate?: string | null; detail?: string } = {}) {
    super(code)
    this.name = 'NutritionError'
    this.code = code
    this.refused = extra.refused ?? (code !== 'network')
    this.reason = extra.reason ?? (CLOSED.includes(code) ? (code as RefusedReason) : this.refused ? 'refused' : null)
    this.sqlstate = extra.sqlstate ?? null
    this.detail = extra.detail ?? ''
  }
}

// The triggers of 0009_nutrition_diary.sql, 0017_checkins.sql, 0021_sleep_base.sql and 0026_habits_base.sql raise their
// typed errors (P0001) with the code as the message. These are the codes a caller can tell apart; the habit ones
// (habit_archived, pillar_off, too_many_habits) are plain refusals here, and habits-api tells them apart.
const KNOWN: readonly NutritionErrorCode[] = ['day_closed', 'night_closed', 'too_many_items', 'too_many_checkins', 'item_immutable']
const P0001_REFUSALS = ['day_closed', 'night_closed', 'too_many_items', 'too_many_checkins', 'too_many_foods', 'too_many_measures', 'item_immutable', 'import_forbidden',
  'habit_archived', 'pillar_off', 'too_many_habits']

const messageOf = (e: unknown) => {
  const m = (e as { message?: unknown } | null)?.message
  return typeof m === 'string' ? m : ''
}
const sqlstateOf = (e: unknown): string | null => {
  const c = (e as { code?: unknown } | null)?.code
  return typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c) ? c : null
}

// Refused for good: a P0001 with one of our messages, a check/unique/FK violation (23xxx), a data
// exception (22xxx). 42501 is NOT a refusal: PostgREST also answers it when the session is lost and
// the request went out with the anon key, so it stays queued. Everything else (fetch failures, timeouts,
// 5xx, expired sessions, unknown codes) is "try again".
export function classify(e: unknown): NutritionError {
  if (e instanceof NutritionError) return e
  const detail = messageOf(e)
  const sqlstate = sqlstateOf(e)
  const known = (KNOWN as readonly string[]).includes(detail) ? (detail as NutritionErrorCode) : null
  const refused = P0001_REFUSALS.includes(detail) || (sqlstate != null && /^2[23]/.test(sqlstate))
  const code: NutritionErrorCode = known ?? 'network'
  return new NutritionError(code, {
    refused, sqlstate, detail,
    reason: !refused ? null : CLOSED.includes(detail) ? (detail as RefusedReason) : 'refused'
  })
}

export const toNutritionError = (e: unknown): NutritionErrorCode => classify(e).code
export const isRefused = (e: unknown): boolean => classify(e).refused
