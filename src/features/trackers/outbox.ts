import * as api from './trackers-api'
import { createLocalOutbox } from '@/lib/local-outbox'
import { TRACKERS_OUTBOX_KEY } from './storage-keys'
import type { Tracker, TrackerEntry } from './types'

// An entry write and its delete are one item per entry id: the newest replaces the older one in the
// queue (see placeEntry for where). A tracker write never replaces another: the engine moves the newer op to the end, so an
// edit made after an entry would take the tracker's creation behind that entry, which the server
// refuses (tracker_not_found) for a tracker it does not have yet. Every edit goes, in order, and the
// server keeps the newest updated_at. A reorder carries only the sort, never a full row, so it
// cannot bring back what another device archived or renamed. It does not collapse either.
export type EntryOp = { op: 'entry'; row: TrackerEntry } | { op: 'delete'; id: string }
// `kept` marks an edit the store queued again after an option_in_use refusal, with the refused
// options put back: it is never queued a third time.
export type TrackerOp =
  | { op: 'tracker'; row: Tracker; kept?: true }
  | { op: 'sort'; id: string; sort: number; updated_at: string }
  | EntryOp

const isEntry = (op: TrackerOp): op is EntryOp => op.op === 'entry' || op.op === 'delete'
export const entryIdOf = (op: EntryOp): string => (op.op === 'entry' ? op.row.id : op.id)

// Where an entry op that replaces an older copy goes, `at` being that copy's place. It must follow
// every queued edit of its tracker that left it active (an option it now uses, decimals it now
// needs: they were made before this change), and stay ahead of an archive it predates (the server
// refuses a new entry on an archived tracker). So: right after the last such edit queued after the
// older copy, which is still before any archive that follows; with none, the older copy's place.
// A delete stays in place: it needs nothing of the tracker.
export function placeEntry(rest: TrackerOp[], at: number, op: TrackerOp): number {
  if (op.op !== 'entry') return at
  let i = at
  rest.forEach((x, k) => { if (k >= at && x.op === 'tracker' && x.row.id === op.row.tracker_id && !x.row.archived_at) i = k + 1 })
  return i
}

export const trackersOutbox = createLocalOutbox<TrackerOp>({
  key: TRACKERS_OUTBOX_KEY,
  same: (a, b) => isEntry(a) && isEntry(b) && entryIdOf(a) === entryIdOf(b),
  place: placeEntry,
  send: op => {
    if (op.op === 'tracker') return api.upsertTracker(op.row)
    if (op.op === 'sort') return api.updateTrackerSort(op.id, op.sort, op.updated_at)
    return op.op === 'entry' ? api.upsertEntry(op.row) : api.deleteEntry(op.id)
  }
})
