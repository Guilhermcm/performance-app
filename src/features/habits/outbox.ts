import * as api from './habits-api'
import { createLocalOutbox } from '@/lib/local-outbox'
import { HABITS_OUTBOX_KEY } from './storage-keys'
import type { Habit } from './types'

// Plan decision 9. A check and its undo are one item per habit and day: the newest replaces the
// older one in the queue. A habit write never replaces another: the engine moves the newer op to the
// end, so an edit made after a check would take the habit's creation behind that check, which the
// server refuses (habit_archived) for a habit it does not have yet. Every edit goes, in order, and
// the server keeps the newest updated_at. A reorder carries only the sort (review M2): never a full
// row, so it cannot bring back what another device archived or renamed. It does not collapse either.
export type CheckOp = { op: 'check' | 'uncheck'; habit_id: string; day: string }
export type HabitOp =
  | { op: 'habit'; row: Habit }
  | { op: 'sort'; id: string; sort: number; updated_at: string }
  | CheckOp

const isCheck = (op: HabitOp): op is CheckOp => op.op === 'check' || op.op === 'uncheck'

export const habitsOutbox = createLocalOutbox<HabitOp>({
  key: HABITS_OUTBOX_KEY,
  same: (a, b) => isCheck(a) && isCheck(b) && a.habit_id === b.habit_id && a.day === b.day,
  send: op => {
    if (op.op === 'habit') return api.upsertHabit(op.row)
    if (op.op === 'sort') return api.updateHabitSort(op.id, op.sort, op.updated_at)
    return op.op === 'check' ? api.insertCheck(op.habit_id, op.day) : api.deleteCheck(op.habit_id, op.day)
  }
})
