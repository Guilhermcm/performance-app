import { flush } from './events'
import { useProgress } from './useProgress'
import { WEIGHT_XP, afterCutover } from './xp'
import type { SyncResult } from './types'

// Sends the queued events, then reads the progress. Confirmed only when nothing was left in the
// queue: otherwise the answer does not include what was just done yet.
export async function syncProgress(): Promise<SyncResult> {
  const { left } = await flush()
  const progress = await useProgress.getState().refresh()
  return { progress, confirmed: !!progress && left === 0 }
}

// XP a weigh-in on `day` is about to earn: the first one of today pays, later ones do not. From the
// check-in cutover on, weigh-ins pay nothing (spec 5.1: the day with a photo took their place).
export function weighInXp(day: string): number {
  const p = useProgress.getState().progress
  return p && p.today === day && !afterCutover(day, p.training_since) && !p.week.weighed_today ? WEIGHT_XP : 0
}
