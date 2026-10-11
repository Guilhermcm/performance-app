// Offline queue of check-ins (and deletes), in IndexedDB so the photo can wait in it. Same contract
// as the nutrition outbox: ops go out in the order they arrived, a refusal the server will never
// change is dropped with its reason while a network error stops the run and keeps the rest, nothing
// is sent without a live session, and the queue stays through a sign-out (it is per account, so the
// next account never sends it).
import { supabase } from '@/lib/supabase'
import { classify } from '@/lib/supabase-errors'
import { idbOutboxBackend } from './outbox-idb'
import type { CheckinRow } from './types'

export type CheckinOp = {
  kind: 'checkin' | 'checkin_delete'
  id: string
  row?: CheckinRow
  photo?: Blob
  ext?: 'jpg' | 'webp'
}

// What a backend keeps. `seq` is the place in line, `rev` changes at every write of the id so that a
// flush removes only the op it sent and not one that replaced it while the request was in flight.
export type StoredOp = { userId: string; id: string; seq: number; rev: string; op: CheckinOp }

export interface OutboxBackend {
  open(): Promise<boolean>
  // The account's ops, oldest place in line first.
  list(userId: string): Promise<StoredOp[]>
  get(userId: string, id: string): Promise<StoredOp | undefined>
  put(rec: StoredOp): Promise<void>
  delete(userId: string, id: string): Promise<void>
  clear(userId: string): Promise<void>
}

export function memoryOutboxBackend(): OutboxBackend {
  const rows = new Map<string, StoredOp>()
  const key = (u: string, id: string) => JSON.stringify([u, id])
  return {
    async open() { return true },
    async list(userId) { return [...rows.values()].filter(r => r.userId === userId).sort((a, b) => a.seq - b.seq) },
    async get(userId, id) { return rows.get(key(userId, id)) },
    async put(rec) { rows.set(key(rec.userId, rec.id), rec) },
    async delete(userId, id) { rows.delete(key(userId, id)) },
    async clear(userId) { for (const [k, r] of rows) if (r.userId === userId) rows.delete(k) }
  }
}

let chosen: Promise<OutboxBackend> | null = null
const backend = (): Promise<OutboxBackend> => (chosen ??= (async () => {
  const idb = idbOutboxBackend()
  return (await idb.open()) ? idb : memoryOutboxBackend()
})())

// Tests (and nothing else) pick the backend; null goes back to IndexedDB, else memory.
export function setCheckinOutboxBackend(b: OutboxBackend | null): void { chosen = b ? Promise.resolve(b) : null }

// Writes go one at a time, so two enqueues cannot pick the same place in line.
let tail: Promise<unknown> = Promise.resolve()
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = tail.then(fn, fn)
  tail = run.catch(() => {})
  return run
}

let counter = 0
const newRev = () => `${Date.now()}-${++counter}`

export async function pendingCheckins(userId: string): Promise<CheckinOp[]> {
  return (await (await backend()).list(userId)).map(r => r.op)
}

// One op per id: the newest replaces the older, so a delete of a check-in still waiting to go out
// takes its place. An op of the same kind keeps its place in line; a different one goes to the end.
export function enqueueCheckin(userId: string, op: CheckinOp): Promise<void> {
  return serial(async () => {
    const b = await backend()
    const prev = await b.get(userId, op.id)
    let seq = prev && prev.op.kind === op.kind ? prev.seq : 0
    if (!seq) seq = (await b.list(userId)).reduce((m, r) => Math.max(m, r.seq), 0) + 1
    await b.put({ userId, id: op.id, seq, rev: newRev(), op })
  })
}

const removeIfSame = (userId: string, sent: StoredOp) => serial(async () => {
  const b = await backend()
  const cur = await b.get(userId, sent.id)
  if (cur && cur.rev === sent.rev) await b.delete(userId, sent.id)
})

// Without a live session a request goes out as anon and fails (42501): send nothing, drop nothing.
async function hasSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    return !!data?.session
  } catch { return false }
}

export type CheckinFlushResult = { sent: number; refused: { id: string; reason: string }[] }

async function run(userId: string, send: (op: CheckinOp) => Promise<void>): Promise<CheckinFlushResult> {
  const result: CheckinFlushResult = { sent: 0, refused: [] }
  if (!(await hasSession())) return result
  for (const rec of await (await backend()).list(userId)) {
    try {
      await send(rec.op)
      result.sent++
    } catch (e) {
      // Day closed, over the cap, a check violation: no retry will ever work, so drop it and go on.
      // Anything else (no network, 5xx, expired session) stops here and keeps the rest, in order.
      const err = classify(e)
      if (!err.refused) break
      result.refused.push({ id: rec.id, reason: err.code === 'network' ? 'refused' : err.code })
    }
    await removeIfSame(userId, rec)
  }
  return result
}

const running = new Map<string, Promise<CheckinFlushResult>>()

// One run at a time per account; a caller that arrives meanwhile waits and then runs on what is left.
export function flushCheckins(userId: string, send: (op: CheckinOp) => Promise<void>): Promise<CheckinFlushResult> {
  const cur = running.get(userId)
  if (cur) return cur.then(() => flushCheckins(userId, send), () => flushCheckins(userId, send))
  const job = run(userId, send).finally(() => running.delete(userId))
  running.set(userId, job)
  return job
}

export function clearCheckinOutbox(userId: string): Promise<void> {
  return serial(async () => { await (await backend()).clear(userId) })
}
