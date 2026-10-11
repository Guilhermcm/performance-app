import { create } from 'zustand'
import type { CheckinDetail } from './types'

export type { CheckinDetail }

// How the check-in panel opens. `routineId` picks strength training with that routine; `detail`
// comes filled in; `fromWorkout` is the id of the live workout that just finished, which already is
// the session in the history (no second one is written, the check-in is linked to it). `onClose`
// runs once when the panel closes, posted or not (the workout summary waits for it).
export type OpenCheckinOptions = { routineId?: string; detail?: CheckinDetail; fromWorkout?: string; onClose?: () => void }

type FlowState = { open: boolean; seq: number; opts: OpenCheckinOptions }

// The panel has no route of its own (plan decision 3): the tab bar, Home, the Plan and the end of a
// live workout open it through here. `seq` gives each opening a fresh form.
export const useCheckinFlow = create<FlowState>(() => ({ open: false, seq: 0, opts: {} }))

export function openCheckin(opts: OpenCheckinOptions = {}): void {
  useCheckinFlow.setState(s => ({ open: true, seq: s.seq + 1, opts }))
}

export function closeCheckin(): void {
  const { open, opts } = useCheckinFlow.getState()
  if (!open) return
  useCheckinFlow.setState({ open: false })
  opts.onClose?.()
}
