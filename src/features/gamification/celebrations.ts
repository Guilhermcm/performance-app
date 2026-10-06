import { t } from '../../lib/i18n.js'
import { weekdayName } from '../nutrition/labels'
import { ACHIEVEMENTS } from './achievements'
import { fmtInt } from './format'
import type { Celebration, PillarKey, Progress } from './types'

// What the person has already been shown: their level, badges, each pillar's level and the last
// week whose goal was celebrated, per pillar. Markers saved before phase 2a lack the last two.
export type SeenMarker = {
  level: number
  codes: string[]
  pillarLevels?: Partial<Record<PillarKey, number>>
  weekTargets?: Partial<Record<PillarKey, string>>
}

// Pillars whose level-ups get a card. Strength is left out: until phase 2a it was the only pillar
// and its level moves with the overall one, which already has a card.
const CELEBRATED_PILLARS: readonly PillarKey[] = ['nutrition']

// A cached progress from an older build may lack pillars or the nutrition block.
function pillarLevelsOf(p: Progress): Partial<Record<PillarKey, number>> {
  const out: Partial<Record<PillarKey, number>> = {}
  for (const [k, v] of Object.entries(p.pillars ?? {})) if (v) out[k as PillarKey] = v.level
  return out
}
const weekTargetsOf = (p: Progress): Partial<Record<PillarKey, string>> =>
  p.nutrition?.last_week ? { nutrition: p.nutrition.last_week.start } : {}

export const markerOf = (p: Progress): SeenMarker => ({
  level: p.level.level,
  codes: p.achievements.map(a => a.code),
  pillarLevels: pillarLevelsOf(p),
  weekTargets: weekTargetsOf(p)
})

// An old marker gets what it lacks from the current progress, so nothing in it is celebrated:
// the same rule as the first load on a device.
export function completeMarker(seen: SeenMarker, p: Progress): SeenMarker {
  if (seen.pillarLevels && seen.weekTargets) return seen
  return { ...seen, pillarLevels: seen.pillarLevels ?? pillarLevelsOf(p), weekTargets: seen.weekTargets ?? weekTargetsOf(p) }
}

// A level-up (one card, the level reached), then each pillar that levelled up, the nutrition weekly
// goal and each new badge, in catalogue order. A pillar missing from the marker starts at level 1.
export function celebrationsSince(seen: SeenMarker, p: Progress): Celebration[] {
  const out: Celebration[] = []
  if (p.level.level > seen.level) out.push({ kind: 'level', level: p.level.level })
  for (const pillar of CELEBRATED_PILLARS) {
    const now = p.pillars?.[pillar]?.level
    if (now != null && now > (seen.pillarLevels?.[pillar] ?? 1)) out.push({ kind: 'pillar_level', pillar, level: now })
  }
  const week = p.nutrition?.last_week
  if (week?.target_hit && week.start > (seen.weekTargets?.nutrition ?? '')) {
    out.push({ kind: 'week_target', pillar: 'nutrition', week_start: week.start })
  }
  const had = new Set(seen.codes)
  const now = new Set(p.achievements.map(a => a.code))
  for (const a of ACHIEVEMENTS) if (now.has(a.code) && !had.has(a.code)) out.push({ kind: 'achievement', code: a.code })
  return out
}

// The result of the last closed nutrition day, named by its weekday because it closes two days
// later: "Saturday on target, +120 XP". Null when it was shown already or there is nothing to say
// (no closed day, or a day without enough logged).
export function dayResultToast(p: Progress, lastShown: string | null): { text: string; day: string } | null {
  const d = p.nutrition?.last_closed
  if (!d || (lastShown && d.day <= lastShown) || !d.logged) return null
  const day = weekdayName(d.day)
  const xp = fmtInt(d.xp)
  const text = d.on_target
    ? (d.xp > 0 ? t('{0} on target, +{1} XP', day, xp) : t('{0} on target', day))
    : (d.xp > 0 ? t('{0} logged, +{1} XP', day, xp) : t('{0} logged', day))
  return { text, day: d.day }
}
