// Applying and undoing a program from the screens, with the toasts that go with them (spec §4.5).
import { toast } from 'sonner'
import { create } from 'zustand'
import { t, tn } from '../../lib/i18n.js'
import { useStore } from '../../store/useStore.js'
import { useCheckins } from '../checkin/useCheckins'
import { applyProgram, undoProgram, type PlanState, type ProgramId } from './programs'

type Store = { S: PlanState; update(fn: (s: PlanState) => void): void }
const store = () => useStore.getState() as unknown as Store

// The routines the last Undo removed, kept only in this tab's memory (plan decision 5). A sync with
// an older copy can bring them back through the routine union (no tombstones); the banner then
// says so, and closing that note forgets them.
export const useUndoneRoutines = create<{ ids: string[]; clear(): void }>(set => ({ ids: [], clear: () => set({ ids: [] }) }))

// Undo is on offer only while the program is there and the plan was not edited since.
export const canUndo = (S: PlanState) => !!S.program && !S.program.dismissed

export const keptText = (n: number) =>
  n === 1 ? t('1 routine with workouts stayed in the list.') : tn(n, '{0} routines with workouts stayed in the list.', n)

// Undoes the program on the plan. With `appliedAt`, only that application (an old toast must not
// undo a program applied after it).
export function undoAppliedProgram(appliedAt?: number): boolean {
  const { S, update } = store()
  const program = S.program
  if (!program || !canUndo(S) || (appliedAt != null && program.appliedAt !== appliedAt)) {
    toast(t('Nothing to undo'))
    return false
  }
  // A routine named by one of my check-ins was trained even when no workout was logged for it.
  // The store holds my last WINDOW_DAYS days of check-ins, the queued ones included.
  const checkedIn = useCheckins.getState().mine.map(r => r.routine_id)
  let kept: string[] = []
  update(s => { kept = undoProgram(s, checkedIn).kept })
  useUndoneRoutines.setState({ ids: program.routineIds.filter(id => !kept.includes(id)) })
  toast(t('Program undone'), kept.length ? { description: keptText(kept.length) } : undefined)
  return true
}

export function startProgram(id: ProgramId, variant: number): void {
  let appliedAt: number | undefined
  store().update(s => {
    applyProgram(s, id, variant)
    appliedAt = s.program?.appliedAt
  })
  useUndoneRoutines.getState().clear()
  toast(t('Program applied'), { action: { label: t('Undo'), onClick: () => { undoAppliedProgram(appliedAt) } } })
}
