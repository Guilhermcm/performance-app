// The engine of the offline queues kept in localStorage (the food diary, sleep). One key holds
// every account's queue as { [userId]: Op[] }; ops go out in the order they arrived, a refusal the
// server will never change is dropped with its reason, anything else (no network, 5xx, a lost
// session) stops the run and keeps the rest, and the queue stays through a sign-out: it is per
// account, and each op goes only while the live session is that same account's.
import { supabase } from '@/lib/supabase'
import { classify, type RefusedReason } from '@/lib/supabase-errors'

export type FlushResult = { sent: number; left: number; dropped: number; reasons: RefusedReason[] }

export type LocalOutbox<Op> = {
  pending(userId: string): Op[]
  // The newest op replaces an older one that `same` matches, so a queue never grows past the items
  // touched. It goes to the end, or where `place` puts it; when that is later than the first older
  // copy, the older copies before it stay (see createLocalOutbox).
  enqueue(userId: string, op: Op): void
  // One run at a time per account; a caller that arrives meanwhile runs on what is left after it.
  flush(userId: string): Promise<FlushResult>
  // Every account's queue (tests; nothing in the app clears a queue on sign-out).
  clear(): void
  // One account's queue, when that account is deleted; the others stay.
  forget(userId: string): void
  // Called with each op dropped as refused from now on, so a pull on its way can leave it out of
  // what it lays over the server's answer, with the server's message (the rule it named, if any).
  // Returns the way to stop.
  onRefused(fn: (userId: string, op: Op, detail: string) => void): () => void
}

type Queues<Op> = Record<string, Op[]>

// Asked before every op, not once per run. Without a live session a request goes out as anon and
// fails (42501); with another account's session (a sign-out and sign-in while a run was on its way)
// it would go out as that account, and an insert whose user_id comes from auth.uid() would land in
// it. Either way: send nothing more, drop nothing, keep the rest for its own account. supabase-js
// always fills session.user; a session without one (the stores' test stubs) has no owner to compare.
async function sessionIs(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession()
    const session = data?.session as { user?: { id?: string } } | null | undefined
    if (!session) return false
    const owner = session.user?.id
    return owner == null || owner === userId
  } catch { return false }
}

export function createLocalOutbox<Op>(o: {
  key: string; same: (a: Op, b: Op) => boolean; send: (op: Op) => Promise<void>
  // Where an op that replaces an older one goes: an index into `rest` (the queue without the
  // matches), given `at`, where the first match was in it. Without it, the end. At `at` or before,
  // the older copies all go. Later than `at`, the older copies before that point stay where they
  // were, each one valid in its place, and only those after it go: the queue then holds the item
  // more than once, in order, so the newest is still the last word.
  place?: (rest: Op[], at: number, op: Op) => number
}): LocalOutbox<Op> {
  const readAll = (): Queues<Op> => {
    try {
      const q: unknown = JSON.parse(localStorage.getItem(o.key) || '{}')
      return q && typeof q === 'object' && !Array.isArray(q) ? (q as Queues<Op>) : {}
    } catch { return {} }
  }
  const writeAll = (q: Queues<Op>) => {
    try {
      const live = Object.fromEntries(Object.entries(q).filter(([, ops]) => ops.length))
      if (Object.keys(live).length) localStorage.setItem(o.key, JSON.stringify(live))
      else localStorage.removeItem(o.key)
    } catch { /* storage full: the change stays on screen until the next pull */ }
  }

  const pending = (userId: string): Op[] => readAll()[userId] ?? []
  const watchers = new Set<(userId: string, op: Op, detail: string) => void>()

  function enqueue(userId: string, op: Op): void {
    const all = readAll()
    const list = all[userId] ?? []
    const at = list.findIndex(x => o.same(x, op))
    const rest = list.filter(x => !o.same(x, op))
    const i = o.place && at >= 0 ? Math.max(0, Math.min(rest.length, o.place(rest, at, op))) : rest.length
    if (!o.place || i <= at) {
      all[userId] = [...rest.slice(0, i), op, ...rest.slice(i)]
    } else {
      // Walk the queue: older copies before the new op's place stay, the rest of them go.
      const out: Op[] = []
      let others = 0
      let placed = false
      for (const x of list) {
        if (o.same(x, op)) { if (!placed) out.push(x); continue }
        out.push(x)
        if (!placed && ++others === i) { out.push(op); placed = true }
      }
      if (!placed) out.push(op)
      all[userId] = out
    }
    writeAll(all)
  }

  // Only the op that was sent goes: one enqueued for the same item while it was in flight stays.
  const remove = (userId: string, op: Op) => {
    const sent = JSON.stringify(op)
    const all = readAll()
    all[userId] = (all[userId] ?? []).filter(x => JSON.stringify(x) !== sent)
    writeAll(all)
  }

  async function run(userId: string): Promise<FlushResult> {
    let sent = 0
    let dropped = 0
    const reasons = new Set<RefusedReason>()
    for (const op of pending(userId)) {
      if (!(await sessionIs(userId))) break
      try {
        await o.send(op)
        sent++
      } catch (e) {
        // Closed day or night, over a cap, a check violation: no retry will ever work, so drop it and
        // keep going. Anything else stops here and keeps the rest, in order.
        const err = classify(e)
        if (!err.refused) break
        dropped++
        reasons.add(err.reason ?? 'refused')
        for (const fn of watchers) fn(userId, op, err.detail)
      }
      remove(userId, op)
    }
    return { sent, left: pending(userId).length, dropped, reasons: [...reasons] }
  }

  const running = new Map<string, Promise<FlushResult>>()

  function flush(userId: string): Promise<FlushResult> {
    const cur = running.get(userId)
    if (cur) return cur.then(() => flush(userId), () => flush(userId))
    const job = run(userId).finally(() => running.delete(userId))
    running.set(userId, job)
    return job
  }

  function clear(): void {
    try { localStorage.removeItem(o.key) } catch { /* ignore */ }
  }

  function forget(userId: string): void {
    const all = readAll()
    delete all[userId]
    writeAll(all)
  }

  function onRefused(fn: (userId: string, op: Op, detail: string) => void): () => void {
    watchers.add(fn)
    return () => { watchers.delete(fn) }
  }

  return { pending, enqueue, flush, clear, forget, onRefused }
}
