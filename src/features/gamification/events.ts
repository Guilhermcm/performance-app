import { supabase } from '@/lib/supabase'
import type { Pillar } from '@/lib/database.types'

export type EventKind = 'workout_completed' | 'pr' | 'weight_logged'
export type FlushResult = { sent: number; left: number }

const KEY = 'perf_event_queue_v1'
const PILLAR: Record<EventKind, Pillar> = { workout_completed: 'strength', pr: 'strength', weight_logged: 'strength' }
const INVALID = '22023'
const DUPLICATE = '23505'

type QueuedEvent = { pillar: Pillar; kind: EventKind; payload: Record<string, unknown>; source_ref: string; occurred_on: string }

const read = (): QueuedEvent[] => {
  try {
    const q: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(q) ? (q as QueuedEvent[]) : []
  } catch { return [] }
}
const write = (q: QueuedEvent[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* storage full: the event is lost, XP too */ }
}
const same = (a: QueuedEvent, b: QueuedEvent) => a.kind === b.kind && a.source_ref === b.source_ref

// Events are written locally first and sent when possible: a workout finished in a basement gym
// still earns its XP once the phone is back online. The server is idempotent on
// (user, kind, source_ref), so a resend after a lost answer is harmless.
export function emit(kind: EventKind, payload: Record<string, unknown>, sourceRef: string, occurredOn: string): void {
  const ev: QueuedEvent = { pillar: PILLAR[kind], kind, payload, source_ref: sourceRef, occurred_on: occurredOn }
  const q = read()
  if (!q.some(x => same(x, ev))) write([...q, ev])
  void flush()
}

async function send(): Promise<FlushResult> {
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return { sent: 0, left: read().length }
    let sent = 0
    for (const ev of read()) {
      const { error } = await supabase.from('activity_events').insert(ev as never)
      const delivered = !error || error.code === DUPLICATE
      const refused = !!error && error.code === INVALID
      // Anything else (no network, expired session) stops here and keeps the rest queued.
      if (!delivered && !refused) break
      if (delivered) sent++
      write(read().filter(x => !same(x, ev)))
    }
    return { sent, left: read().length }
  } catch {
    return { sent: 0, left: read().length }
  }
}

let running: Promise<FlushResult> | null = null
let again: Promise<FlushResult> | null = null

// One send at a time. A call that arrives while one runs (an event emitted mid-flush, a sign-in
// right after a signed-out attempt) gets a single follow-up run, so nothing waits for the timer.
export function flush(): Promise<FlushResult> {
  if (!running) {
    running = send().finally(() => { running = null })
    return running
  }
  if (!again) again = running.then(() => { again = null; return flush() })
  return again
}

export function clearEventQueue(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function startEventSync(): () => void {
  const run = () => { void flush() }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(run, 60_000)
  run()
  return () => {
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
