import * as api from './sleep-api'
import { createLocalOutbox } from '@/lib/local-outbox'
import { SLEEP_OUTBOX_KEY } from './storage-keys'
import type { SleepLog } from './types'

// One op per night: a newer write of the same night replaces the older one in the queue.
export type SleepOp = { op: 'upsert' | 'delete'; night: string; row?: SleepLog }

export const sleepOutbox = createLocalOutbox<SleepOp>({
  key: SLEEP_OUTBOX_KEY,
  same: (a, b) => a.night === b.night,
  send: op => (op.op === 'upsert' ? api.upsertLog(op.row as SleepLog) : api.deleteLog(op.night))
})
