import { dateLocale, t } from '../../lib/i18n.js'
import { weekdayName } from '../nutrition/labels'
import { ACHIEVEMENTS } from './achievements'
import { fmtInt } from './format'
import type { Celebration, PillarKey, Progress } from './types'

// What the person has already been shown: their level, badges, each pillar's level and the last
// week whose goal was celebrated, per pillar. Markers saved before phase 2a lack the last two; markers
// saved before phase 3 have no sleep entry in them (see markerOf).
export type SeenMarker = {
  level: number
  codes: string[]
  pillarLevels?: Partial<Record<PillarKey, number>>
  weekTargets?: Partial<Record<PillarKey, string | null>>
}

// Pillars whose level-ups and weekly goals get a card. Strength is left out: until phase 2a it was
// the only pillar and its level moves with the overall one, which already has a card; its weekly
// goal stays in the post-workout summary.
const CELEBRATED_PILLARS = ['nutrition', 'sleep'] as const satisfies readonly PillarKey[]

// A cached progress from an older build may lack pillars or the pillar blocks. Sleep is always
// written (level 1 and no week until it has some), so a marker saved before the sleep pillar is
// told apart by not having it.
function pillarLevelsOf(p: Progress): Partial<Record<PillarKey, number>> {
  const out: Partial<Record<PillarKey, number>> = {}
  for (const [k, v] of Object.entries(p.pillars ?? {})) if (v) out[k as PillarKey] = v.level
  return { ...out, sleep: out.sleep ?? 1 }
}
function weekTargetsOf(p: Progress): Partial<Record<PillarKey, string | null>> {
  const out: Partial<Record<PillarKey, string | null>> = {}
  if (p.nutrition?.last_week) out.nutrition = p.nutrition.last_week.start
  out.sleep = p.sleep?.last_week?.start ?? null
  return out
}

export const markerOf = (p: Progress): SeenMarker => ({
  level: p.level.level,
  codes: p.achievements.map(a => a.code),
  pillarLevels: pillarLevelsOf(p),
  weekTargets: weekTargetsOf(p)
})

// An old marker gets what it lacks from the current progress, so nothing in it is celebrated:
// the same rule as the first load on a device. A marker without sleep comes from before the
// sleep pillar: every pillar it lacks is taken as seen.
export function completeMarker(seen: SeenMarker, p: Progress): SeenMarker {
  const levels = seen.pillarLevels, weeks = seen.weekTargets
  if (levels && weeks && 'sleep' in levels && 'sleep' in weeks) return seen
  return { ...seen, pillarLevels: { ...pillarLevelsOf(p), ...levels }, weekTargets: { ...weekTargetsOf(p), ...weeks } }
}

// A level-up (one card, the level reached), then each pillar that levelled up, each pillar's weekly
// goal (nutrition, then sleep) and each new badge, in catalogue order. A pillar missing from the
// marker starts at level 1.
export function celebrationsSince(seen: SeenMarker, p: Progress): Celebration[] {
  const out: Celebration[] = []
  if (p.level.level > seen.level) out.push({ kind: 'level', level: p.level.level })
  for (const pillar of CELEBRATED_PILLARS) {
    const now = p.pillars?.[pillar]?.level
    if (now != null && now > (seen.pillarLevels?.[pillar] ?? 1)) out.push({ kind: 'pillar_level', pillar, level: now })
  }
  for (const pillar of CELEBRATED_PILLARS) {
    const week = p[pillar]?.last_week
    if (week?.target_hit && week.start > (seen.weekTargets?.[pillar] ?? '')) {
      out.push({ kind: 'week_target', pillar, week_start: week.start })
    }
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

// The last closed Treino day (spec 5.3): "Saturday workout confirmed, +210 XP" once it closes, two
// days later. The weekday comes from Intl in the app language, so it reads in its own case
// ("Treino de sábado confirmado"). Null when it was shown already or there is no closed day.
export function trainingDayToast(p: Progress, lastShown: string | null): { text: string; day: string } | null {
  const d = p.training?.last_closed
  if (!d || (lastShown && d.day <= lastShown)) return null
  const day = new Date(d.day + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long' })
  const text = d.xp > 0 ? t('{0} workout confirmed, +{1} XP', day, fmtInt(d.xp)) : t('{0} workout confirmed', day)
  return { text, day: d.day }
}

// "Saturday logged": a whole sentence per weekday, since in some languages the word for logged
// takes the gender of the day ("sábado registrado", "segunda-feira registrada"). Sunday first, as
// Date.getDay() counts.
const NIGHT_LOGGED_XP = [
  (xp: string) => t('Sunday logged, +{0} XP', xp),
  (xp: string) => t('Monday logged, +{0} XP', xp),
  (xp: string) => t('Tuesday logged, +{0} XP', xp),
  (xp: string) => t('Wednesday logged, +{0} XP', xp),
  (xp: string) => t('Thursday logged, +{0} XP', xp),
  (xp: string) => t('Friday logged, +{0} XP', xp),
  (xp: string) => t('Saturday logged, +{0} XP', xp),
]
const NIGHT_LOGGED = [
  () => t('Sunday logged'),
  () => t('Monday logged'),
  () => t('Tuesday logged'),
  () => t('Wednesday logged'),
  () => t('Thursday logged'),
  () => t('Friday logged'),
  () => t('Saturday logged'),
]

// The last closed night (spec 5.6), named by the weekday it was woken up on, since it closes two
// days later: "Saturday on target, +130 XP", "Saturday logged, +10 XP". A night with no goal in
// force pays nothing and is only logged. Null when it was shown already or there is nothing to say
// (no closed night, or a night without a log).
export function sleepNightToast(p: Progress, lastShown: string | null): { text: string; night: string } | null {
  const n = p.sleep?.last_closed
  if (!n || (lastShown && n.night <= lastShown) || !n.logged) return null
  const xp = fmtInt(n.xp)
  const weekday = new Date(n.night + 'T12:00:00').getDay()
  const text = n.on_target
    ? (n.xp > 0 ? t('{0} on target, +{1} XP', weekdayName(n.night), xp) : t('{0} on target', weekdayName(n.night)))
    : (n.xp > 0 ? NIGHT_LOGGED_XP[weekday](xp) : NIGHT_LOGGED[weekday]())
  return { text, night: n.night }
}
