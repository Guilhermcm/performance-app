import { create } from 'zustand'
import type { CheckinActivity, CheckinDetail, StrengthDetail } from './types'

export type { CheckinDetail }

// How the check-in panel opens. `activity` picks it (the Plan's "Log run" opens on running);
// `routineId` picks strength training with that routine; `detail`
// comes filled in; `fromWorkout` is the id of the live workout that just finished, which already is
// the session in the history (no second one is written, the check-in is linked to it). `onClose`
// runs once when the panel closes, posted or not (the workout summary waits for it).
export type OpenCheckinOptions = { activity?: CheckinActivity; routineId?: string; detail?: StrengthDetail; fromWorkout?: string; onClose?: () => void }

// `photo`: the one picked for this opening, from the camera the tap opened or from the panel.
type FlowState = { open: boolean; seq: number; opts: OpenCheckinOptions; photo: File | null }

// The panel has no route of its own (plan decision 3): the tab bar, Home, the Plan and the end of a
// live workout open it through here. `seq` gives each opening a fresh form.
export const useCheckinFlow = create<FlowState>(() => ({ open: false, seq: 0, opts: {}, photo: null }))

export function openCheckin(opts: OpenCheckinOptions = {}): void {
  useCheckinFlow.setState(s => ({ open: true, seq: s.seq + 1, opts, photo: null }))
}

export function setCheckinPhoto(photo: File | null): void {
  useCheckinFlow.setState({ photo })
}

// The rear camera input the panel host keeps on the page (CheckinFlow.tsx). A file picker only
// opens from inside the tap that asks for it, so the input has to exist before the tap: one
// rendered by the panel as it opens would come too late.
let camera: HTMLInputElement | null = null
export function registerCheckinCamera(el: HTMLInputElement | null): void { camera = el }

// The center button (spec 3.1): the panel opens and the rear camera with it, in the same tap. A
// cancelled camera leaves the panel on its photo step, with the camera and the gallery.
export function openCheckinCamera(opts: OpenCheckinOptions = {}): void {
  openCheckin(opts)
  camera?.click()
}

export function closeCheckin(): void {
  const { open, opts } = useCheckinFlow.getState()
  if (!open) return
  useCheckinFlow.setState({ open: false })
  opts.onClose?.()
}
