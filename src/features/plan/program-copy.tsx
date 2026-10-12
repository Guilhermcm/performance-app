// What the program screens say about each program (spec §4.2 and §4.4). Every text is a literal
// t() call, so check-source-strings finds it; programs.ts keeps only the training data.
import { t } from '../../lib/i18n.js'
import type { AnalysisProfile } from './goal'
import { PROGRAMS, resolveVariant, type ProgramId } from './programs'
import { estimateMinutes } from './time'

export type ProgramCopy = { name: string; forWho: string; expect: string; why: string }

// The double progression, said once for the programs that use it.
const climb = () => t('Add reps up to the top of the range, then add load.')
const both = (a: string, b: string) => `${a} ${b}`

export function programCopy(id: ProgramId): ProgramCopy {
  switch (id) {
    case 'full-body-beginner': return {
      name: t('Full body for beginners'),
      forWho: t('For anyone starting out or coming back to training, with 3 days a week.'),
      expect: both(t('Three different sessions, each one for the whole body.'), climb()),
      why: t('You train each muscle 2 or 3 times a week, with 2 or 3 sets per exercise. Sets of 8 to 15 reps build muscle. Rest 2 min on multi-joint lifts and 90 s on the others.'),
    }
    case 'upper-lower': return {
      name: t('Upper / Lower'),
      forWho: t('If you already train and have 4 days a week.'),
      expect: both(t('Upper body on two days, lower body on the other two.'), climb()),
      why: t('You train each muscle twice a week, which gave more growth than once. 2 or 3 sets per exercise, 8 to 15 reps, and 2 min of rest on multi-joint lifts.'),
    }
    case 'ppl': return {
      name: t('Push / Pull / Legs'),
      forWho: t('If you have some training behind you. 3 days a week, or 6 for more volume.'),
      expect: both(t('Push, pull and legs each get their own day.'), climb()),
      why: t('3 or 4 sets per exercise and 8 to 15 reps, with 2 min of rest on multi-joint lifts. On 6 days you train each muscle twice a week, which gave more growth than once.'),
    }
    case 'strength-5x5': return {
      name: t('Strength 5×5'),
      forWho: t('If you want to get stronger on the main lifts, with 3 days a week.'),
      expect: t('Three lifts per session, 5 sets of 5. When you complete every set, the load goes up next time.'),
      why: t('Few reps with a heavy load train strength. Rest 3 min between sets, since longer rest helped strength on multi-joint lifts. You train the whole body 3 times a week.'),
    }
    case 'power-hypertrophy': return {
      name: t('Strength and hypertrophy'),
      forWho: t('If you already train and want both strength and muscle, with 4 days a week.'),
      expect: t('Two heavy days with 5 to 10 reps and two lighter days with 8 to 15. You train each muscle twice a week.'),
      why: t('On heavy days you rest 3 min on the main lifts and add load when you complete the sets. On lighter days, 3 or 4 sets of 8 to 15 reps build muscle, with 2 min of rest on multi-joint lifts.'),
    }
    case 'short-2x': return {
      name: t('Short workout'),
      forWho: t('For weeks with little time: 2 short sessions.'),
      expect: both(t('Four multi-joint exercises per session, each working several muscles at once.'), climb()),
      why: t('Short workouts built on multi-joint exercises can build strength and muscle. 2 or 3 sets of 8 to 12 reps, 2 min of rest, and the whole body in every session.'),
    }
    case 'health-3x': return {
      name: t('General health'),
      forWho: t('If you want to stay strong and healthy with short sessions, 3 days a week.'),
      expect: both(t('One exercise per large muscle group, alternating sessions A and B.'), climb()),
      why: t('Health guidelines recommend strength work for the whole body every week. Here it fits in 3 short sessions, with 2 sets of 8 to 12 reps and up to 2 min of rest.'),
    }
  }
}

// The PPL 3 day variant trains each muscle once a week; the detail says so (spec §4.2).
export const pplOnceNote = () => t('With 3 days, you train each muscle once a week. For twice a week, choose 6 days or Upper / Lower.')

export const PROFILE_LABEL: Record<AnalysisProfile, () => string> = {
  hypertrophy: () => t('Hypertrophy'),
  strength: () => t('Strength'),
  health: () => t('Health'),
}

// The one line under "Suggested for you" (spec §4.4).
export function suggestionReason(profile: AnalysisProfile, days: number): string {
  switch (profile) {
    case 'hypertrophy': return t('For hypertrophy, {0} days', days)
    case 'strength': return t('For strength, {0} days', days)
    case 'health': return t('For general health, {0} days', days)
  }
}

export function programDays(id: ProgramId): string {
  const days = PROGRAMS[id].variants.map(v => v.days)
  return days.length > 1 ? t('{0} or {1} days a week', days[0], days[days.length - 1]) : t('{0} days a week', days[0])
}

// Time of the longest session of the variant (spec §5.5 estimate).
export function programMinutes(id: ProgramId, variant = 0): number {
  const program = PROGRAMS[id]
  const keys = new Set(program.variants[resolveVariant(id, variant)].schedule.map(([, key]) => key))
  return Math.max(0, ...program.routines.filter(r => keys.has(r.key)).map(r => estimateMinutes({ ex: r.slots })))
}

// "Mon PPL · Push, Wed PPL · Pull, Fri PPL · Legs": the week a variant puts in place.
const SHORT_DAY = [() => t('Sun'), () => t('Mon'), () => t('Tue'), () => t('Wed'), () => t('Thu'), () => t('Fri'), () => t('Sat')]
export function scheduleText(id: ProgramId, variant = 0): string {
  const program = PROGRAMS[id]
  const nameOf = new Map(program.routines.map(r => [r.key, `${program.prefix} · ${r.name}`]))
  return program.variants[resolveVariant(id, variant)].schedule.map(([day, key]) => `${SHORT_DAY[day]()} ${nameOf.get(key)}`).join(', ')
}
