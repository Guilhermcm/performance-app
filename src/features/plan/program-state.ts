// Plan decision 4 of phase 1d: once the person edits a routine or the week after applying a
// program, the program banner and its Undo go away (S.program.dismissed). Undo restores the old
// week and drops the program's routines whatever happened since, so offering it after an edit
// would throw that edit away.
//
// The store's update runs this on every change, because every plan edit goes through it: the
// Plan, the routine editor and the day sheets. A change that touches S.program itself (applying,
// closing the banner, Undo) is left alone, and so is one that leaves routines and week as they were.
type Snapshot = { routines?: unknown; week?: unknown; program?: { dismissed?: boolean } | null } | null | undefined

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function markPlanEdited(prev: Snapshot, next: Snapshot): void {
  const program = next?.program
  if (!program || program.dismissed) return
  if (!same(prev?.program, program)) return
  if (same(prev?.week, next?.week) && same(prev?.routines, next?.routines)) return
  program.dismissed = true
}
