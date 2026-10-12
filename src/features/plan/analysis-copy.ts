// The words of the plan analysis (spec §5.8), shared by the Plan card and the analysis screen.
// Group names come from the catalogue's lowercase muscle keys ('chest', 'back'...), which every
// pack already translates; a label at the start of a line gets its first letter capitalised.
import { dateLocale, t, tn } from '../../lib/i18n.js'
import type { Alert, Group, PlanAnalysis, Status } from './analysis'
import type { AnalysisProfile } from './goal'

export const GROUPS: Group[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs']

// The group inside a sentence: "chest below ideal".
export const groupTerm = (g: Group): string => ({
  chest: () => t('chest'),
  back: () => t('back'),
  shoulders: () => t('shoulders'),
  biceps: () => t('biceps'),
  triceps: () => t('triceps'),
  quads: () => t('quads'),
  hamstrings: () => t('hamstrings'),
  glutes: () => t('glutes'),
  calves: () => t('calves'),
  abs: () => t('abs'),
})[g]()

export const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase(dateLocale()) + s.slice(1) : s)

// The group as a label: "Chest".
export const groupLabel = (g: Group) => capitalize(groupTerm(g))

export const goalText = (p: AnalysisProfile) => ({
  hypertrophy: () => t('Goal: hypertrophy'),
  strength: () => t('Goal: strength'),
  health: () => t('Goal: general health'),
})[p]()

export const balancedText = (p: AnalysisProfile) => ({
  hypertrophy: () => t('Balanced plan for hypertrophy'),
  strength: () => t('Balanced plan for strength'),
  health: () => t('Balanced plan for general health'),
})[p]()

export const statusLabel = (s: Status) => ({
  missing: () => t('No sets'),
  low: () => t('Below ideal'),
  ok: () => t('In range'),
  high: () => t('Little extra gain'),
})[s]()

export const alertCount = (n: number) => (n === 1 ? t('1 alert') : tn(n, '{0} alerts', n))

// An alert in a few words, inside a sentence: "chest below ideal", "more push than pull".
export function alertPhrase(alert: Alert, analysis: Pick<PlanAnalysis, 'balance'>): string {
  const { balance } = analysis
  const g = alert.group ? groupTerm(alert.group) : ''
  switch (alert.kind) {
    case 'missing': return t('{0} with no sets', g)
    case 'low': return t('{0} below ideal', g)
    case 'high': return t('{0} with little extra gain', g)
    case 'frequency': return t('{0} with low frequency', g)
    case 'balance-push-pull': return balance.push >= balance.pull ? t('more push than pull') : t('more pull than push')
    case 'balance-quad-ham': return balance.quads >= balance.hamstrings ? t('more quads than hamstrings') : t('more hamstrings than quads')
    case 'long': return t('long workout')
    case 'repeated': return t('repeated exercise')
  }
}

// What to change by hand. The alerts with a one-tap suggestion show the change itself as well.
export function alertHint(alert: Alert): string {
  switch (alert.kind) {
    case 'missing': return t('Add an exercise for this muscle to one of your routines.')
    case 'low': return t('Add sets to the exercises for this muscle.')
    case 'high': return t('Above the range, each extra set adds little.')
    case 'frequency': return t('Split its sets across 2 days of the week.')
    case 'balance-push-pull':
    case 'balance-quad-ham': return t('Add sets to the smaller side, or take some from the bigger one.')
    case 'long': return t('Cut an exercise or a few sets, or split it into two workouts.')
    case 'repeated': return t('On some of those days, swap it for another exercise for the same muscle.')
  }
}

// The balance in a sentence, with no number (spec §5.4). Null when both sides are at 0.
export function pushPullText(b: PlanAnalysis['balance'], unbalanced: boolean): string | null {
  if (!b.push && !b.pull) return null
  if (!unbalanced) return t('Push and pull are balanced.')
  return b.push >= b.pull ? t('You do far more pushing sets than pulling sets.') : t('You do far more pulling sets than pushing sets.')
}

export function quadHamText(b: PlanAnalysis['balance'], unbalanced: boolean): string | null {
  if (!b.quads && !b.hamstrings) return null
  if (!unbalanced) return t('Quads and hamstrings are balanced.')
  return b.quads >= b.hamstrings ? t('You do far more quad sets than hamstring sets.') : t('You do far more hamstring sets than quad sets.')
}

export const frequencyNote = (p: AnalysisProfile) => ({
  hypertrophy: () => t('Each muscle twice a week or more.'),
  strength: () => t('For strength, more days mostly help to fit in more sets.'),
  health: () => t('For health, train strength on 2 or more days a week.'),
})[p]()

export const daysText = (n: number) => (n === 1 ? t('1 day') : tn(n, '{0} days', n))

export const unknownText = (n: number) =>
  (n === 1 ? t('1 exercise with no known muscle') : tn(n, '{0} exercises with no known muscle', n))
