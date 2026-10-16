import * as api from './habits-api'
import { createLocalOutbox } from '@/lib/local-outbox'
import { HABITS_OUTBOX_KEY } from './storage-keys'
import type { Habit } from './types'

// Plan decision 9. A check and its undo are one item per habit and day: the newest replaces the
// older one in the queue. A habit write never replaces another: the engine moves the newer op to the
// end, so an edit made after a check would take the habit's creation behind that check, which the
// server refuses (habit_archived) for a habit it does not have yet. Every edit goes, in order, and
// the server keeps the newest updated_at.
export type HabitOp = { op: 'habit'; row: Habit } | { op: 'check' | 'uncheck'; habit_id: string; day: string }

export const habitsOutbox = createLocalOutbox<HabitOp>({
  key: HABITS_OUTBOX_KEY,
  same: (a, b) => a.op !== 'habit' && b.op !== 'habit' && a.habit_id === b.habit_id && a.day === b.day,
  send: op => {
    if (op.op === 'habit') return api.upsertHabit(op.row)
    return op.op === 'check' ? api.insertCheck(op.habit_id, op.day) : api.deleteCheck(op.habit_id, op.day)
  }
})
