import type { FoodLog, UserFood } from './types'
import * as api from './nutrition-api'
import { supabase } from '@/lib/supabase'

export type OutboxOp = { kind: 'log' | 'food'; op: 'upsert' | 'delete'; id: string; row?: FoodLog | UserFood }

const KEY = 'perf_food_outbox_v1'
type Queues = Record<string, OutboxOp[]>

const readAll = (): Queues => {
  try {
    const q: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    return q && typeof q === 'object' && !Array.isArray(q) ? (q as Queues) : {}
  } catch { return {} }
}
const writeAll = (q: Queues) => {
  try {
    const live = Object.fromEntries(Object.entries(q).filter(([, ops]) => ops.length))
    if (Object.keys(live).length) localStorage.setItem(KEY, JSON.stringify(live))
    else localStorage.removeItem(KEY)
  } catch { /* storage full: the change stays on screen until the next pull */ }
}

export const pending = (userId: string): OutboxOp[] => readAll()[userId] ?? []
const same = (a: OutboxOp, b: OutboxOp) => a.kind === b.kind && a.id === b.id

// The newest op for an id replaces the older one, so a queue never grows past the items touched.
export function enqueue(userId: string, op: OutboxOp): void {
  const all = readAll()
  all[userId] = [...(all[userId] ?? []).filter(x => !same(x, op)), op]
  writeAll(all)
}

// Only the op that was sent goes: one enqueued for the same id while it was in flight stays.
const remove = (userId: string, op: OutboxOp) => {
  const sent = JSON.stringify(op)
  const all = readAll()
  all[userId] = (all[userId] ?? []).filter(x => JSON.stringify(x) !== sent)
  writeAll(all)
}

async function send(op: OutboxOp): Promise<void> {
  if (op.kind === 'log') return op.op === 'upsert' ? api.upsertLog(op.row as FoodLog) : api.deleteLog(op.id)
  return op.op === 'upsert' ? api.upsertFood(op.row as UserFood) : api.deleteFood(op.id)
}

export type FlushResult = { sent: number; left: number; dropped: number; reasons: api.RefusedReason[] }

// Without a live session a request goes out as anon and fails (42501): send nothing, drop nothing.
async function hasSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    return !!data?.session
  } catch { return false }
}

async function run(userId: string): Promise<FlushResult> {
  if (!(await hasSession())) return { sent: 0, left: pending(userId).length, dropped: 0, reasons: [] }
  let sent = 0
  let dropped = 0
  const reasons = new Set<api.RefusedReason>()
  for (const op of pending(userId)) {
    try {
      await send(op)
      sent++
    } catch (e) {
      // Closed day, over a cap, a check violation: no retry will ever work, so drop it and keep going.
      // Anything else (no network, 5xx, expired session) stops here and keeps the rest, in order.
      const err = api.classify(e)
      if (!err.refused) break
      dropped++
      reasons.add(err.reason ?? 'refused')
    }
    remove(userId, op)
  }
  return { sent, left: pending(userId).length, dropped, reasons: [...reasons] }
}

const running = new Map<string, Promise<FlushResult>>()

// One send at a time per account; a caller that arrives meanwhile gets the same run.
export function flushOutbox(userId: string): Promise<FlushResult> {
  const cur = running.get(userId)
  if (cur) return cur.then(() => flushOutbox(userId))
  const job = run(userId).finally(() => running.delete(userId))
  running.set(userId, job)
  return job
}

export function clearOutbox(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
