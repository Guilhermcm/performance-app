// The person's run history for the plan (plan decision 7): their run check-ins since the plan
// start, read straight from the table once per opening of /plan/corrida and /plan, with the ones
// on this phone (useCheckins.mine, writes not sent yet included) laid on top by id. Without a
// connection only the phone's are there.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { fetchMyRunCheckins, runLogOf } from '../checkin/checkin-api'
import { useCheckins, type MyCheckin } from '../checkin/useCheckins'
import { isReadable } from './run-actions'
import type { RunDetail } from './run-detail'
import type { RunPlan } from './types'

export type RunLog = { id: string; day: string; duration_min: number | null; run: RunDetail | null }

export type RunLogStatus = 'idle' | 'loading' | 'ready' | 'offline'

type RunLogStore = {
  // `${userId}:${from}` of the answer held; another account or another plan start reads again.
  key: string | null
  server: RunLog[] | null
  status: RunLogStatus
  load(userId: string, from: string): Promise<void>
  reset(): void
}

let inflight: { key: string; job: Promise<void> } | null = null

export const useRunLogStore = create<RunLogStore>((set, get) => ({
  key: null,
  server: null,
  status: 'idle',
  load(userId, from) {
    const key = `${userId}:${from}`
    if (inflight?.key === key) return inflight.job
    // A failed read keeps the answer of an earlier opening of the same plan.
    set(s => ({ key, server: s.key === key ? s.server : null, status: 'loading' }))
    const job = (async () => {
      try {
        const server = await fetchMyRunCheckins(from)
        if (get().key === key) set({ server, status: 'ready' })
      } catch {
        if (get().key === key) set({ status: 'offline' })
      }
    })().finally(() => { if (inflight?.key === key) inflight = null })
    inflight = { key, job }
    return job
  },
  reset() {
    inflight = null
    set({ key: null, server: null, status: 'idle' })
  }
}))

const byDay = (a: RunLog, b: RunLog) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The server's run check-ins with the phone's from `from` on over them by id, in day order. */
export function mergeRunLogs(server: RunLog[], mine: MyCheckin[], from: string): RunLog[] {
  const out = new Map(server.filter(l => l.day >= from).map(l => [l.id, l]))
  for (const r of mine) if (r.activity === 'run' && r.day >= from) out.set(r.id, runLogOf(r))
  return [...out.values()].sort(byDay)
}

/**
 * The run history of `plan`, read once each time a screen using it opens. `offline` when the read
 * failed: the logs are then the phone's (and an earlier answer for this plan, if there was one).
 */
export function useRunLogs(plan: RunPlan | null): { logs: RunLog[]; status: RunLogStatus } {
  const from = isReadable(plan) ? plan.startDate : null
  const userId = useCheckins(s => s.userId)
  const mine = useCheckins(s => s.mine)
  const { key, server, status } = useRunLogStore()
  const want = userId && from ? `${userId}:${from}` : null

  useEffect(() => {
    if (userId && from) void useRunLogStore.getState().load(userId, from)
  }, [userId, from])

  return useMemo(() => {
    if (!want || !from) return { logs: [], status: 'idle' as const }
    const held = key === want
    return { logs: mergeRunLogs(held ? server ?? [] : [], mine, from), status: held ? status : 'loading' }
  }, [want, from, key, server, status, mine])
}
