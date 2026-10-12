// Estimated length of one session of a routine: every set costs its rest plus 40 s of work, and
// the session starts with 5 min of warm-up. An exercise with no rest of its own rests 90 s.
const WORK_SEC = 40
const WARMUP_SEC = 300
const DEFAULT_REST_SEC = 90

export type TimedRoutine = { ex: ReadonlyArray<{ id?: string; sets?: number; restSec?: number }> }

export function estimateMinutes(routine: TimedRoutine): number {
  const sec = routine.ex.reduce((total, e) => {
    const rest = Number(e.restSec) > 0 ? Number(e.restSec) : DEFAULT_REST_SEC
    return total + (Number(e.sets) || 0) * (rest + WORK_SEC)
  }, WARMUP_SEC)
  return Math.ceil(sec / 60)
}
