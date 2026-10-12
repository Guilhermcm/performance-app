import type { FoodLog, Measure, UserFood } from './types'
import * as api from './nutrition-api'
import { createLocalOutbox } from '@/lib/local-outbox'

export type { FlushResult } from '@/lib/local-outbox'

export type OutboxOp = { kind: 'log' | 'food' | 'measure'; op: 'upsert' | 'delete'; id: string; row?: FoodLog | UserFood | Measure }

async function send(op: OutboxOp): Promise<void> {
  if (op.kind === 'log') return op.op === 'upsert' ? api.upsertLog(op.row as FoodLog) : api.deleteLog(op.id)
  if (op.kind === 'measure') return op.op === 'upsert' ? api.upsertMeasure(op.row as Measure) : api.deleteMeasure(op.id)
  return op.op === 'upsert' ? api.upsertFood(op.row as UserFood) : api.deleteFood(op.id)
}

// The diary's queue on the shared engine (lib/local-outbox). The key and the saved shape
// ({ [userId]: OutboxOp[] }) are the ones it always had, so ops waiting on a phone survive an update.
const box = createLocalOutbox<OutboxOp>({
  key: 'perf_food_outbox_v1',
  same: (a, b) => a.kind === b.kind && a.id === b.id,
  send
})

export const pending = box.pending
export const enqueue = box.enqueue
export const flushOutbox = box.flush
export const clearOutbox = box.clear
