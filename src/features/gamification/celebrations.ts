import { ACHIEVEMENTS } from './achievements'
import type { Celebration, Progress } from './types'

// What the person has already been shown: their level and badges at that moment.
export type SeenMarker = { level: number; codes: string[] }

export const markerOf = (p: Progress): SeenMarker => ({ level: p.level.level, codes: p.achievements.map(a => a.code) })

// A level-up (one card, the level reached) and then each new badge, in catalogue order.
export function celebrationsSince(seen: SeenMarker, p: Progress): Celebration[] {
  const out: Celebration[] = []
  if (p.level.level > seen.level) out.push({ kind: 'level', level: p.level.level })
  const had = new Set(seen.codes)
  const now = new Set(p.achievements.map(a => a.code))
  for (const a of ACHIEVEMENTS) if (now.has(a.code) && !had.has(a.code)) out.push({ kind: 'achievement', code: a.code })
  return out
}
