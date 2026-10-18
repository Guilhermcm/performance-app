// Names and texts of the running plan (spec §3, §4.2 and §5.2). Each string is a literal t() call
// so check-source-strings finds it; the pt-BR wording follows the spec's tables.
import { t, tn } from '../../lib/i18n.js'
import { fmtDate } from '../../lib/format.js'
import type { FitWarning } from './fit'
import type { Item, Phase, RunGoal, SessionType, Zone } from './types'

export function zoneName(z: Zone): string {
  switch (z) {
    case 'easy': return t('Easy')
    case 'moderate': return t('Moderate')
    case 'hard': return t('Hard zone')
    default: return t('Walk')
  }
}

/** How the zone feels, the cue shown when there is no pace. */
export function zoneFeel(z: Zone): string {
  switch (z) {
    case 'easy': return t('you can hold a conversation')
    case 'moderate': return t('short sentences only')
    case 'hard': return t('only a few words')
    default: return t('brisk walk to recover')
  }
}

export function sessionName(type: SessionType): string {
  switch (type) {
    case 'runwalk': return t('Run/walk')
    case 'easy': return t('Easy run')
    case 'long': return t('Long run')
    case 'tempo': return t('Tempo run')
    default: return t('Interval run')
  }
}

export function goalName(goal: RunGoal): string {
  switch (goal) {
    case 'start': return t('Start running')
    case '5k': return t('5 km')
    case '10k': return t('10 km')
    case 'half': return t('Half marathon')
    default: return t('Stay in shape')
  }
}

function blockText(zone: Zone, min: number): string {
  switch (zone) {
    case 'easy': return t('{0} min easy', min)
    case 'moderate': return t('{0} min moderate', min)
    case 'hard': return t('{0} min hard', min)
    default: return t('{0} min walk', min)
  }
}

/** One workout item as text: "10 min easy", or a repeat as "4 × 4 min hard, 2 min easy". */
export function itemText(item: Item): string {
  if ('repeat' in item) return `${item.repeat} × ${item.blocks.map(b => blockText(b.zone, b.min)).join(', ')}`
  return blockText(item.zone, item.min)
}

export function phaseName(p: Phase): string {
  switch (p) {
    case 'base': return t('Base')
    case 'build': return t('Build')
    case 'specific': return t('Specific')
    case 'taper': return t('Taper')
    // The weeks before a race plan that starts later (spec §5.3), and maintain plans' own name.
    default: return goalName('maintain')
  }
}

/** "1 week", "{0} weeks". */
export const weeksText = (n: number) => (n === 1 ? t('1 week') : tn(n, '{0} weeks', n))

/** A date shown to the person, with the year only when it is not this year's. */
export const dayText = (iso: string, today: string) => fmtDate(iso, false, iso.slice(0, 4) !== today.slice(0, 4))

// A block in the short form of the day card: minutes and zone, without the unit.
function blockShort(zone: Zone, min: number): string {
  switch (zone) {
    case 'easy': return t('{0} easy', min)
    case 'moderate': return t('{0} moderate', min)
    case 'hard': return t('{0} hard', min)
    default: return t('{0} walk', min)
  }
}

/**
 * A workout in one line (spec §6.4): "10 easy + 4 × 4 hard + 10 easy". A repeat of several blocks
 * keeps them in parentheses: "8 × (1 easy, 2 walk)".
 */
export function blocksInline(items: Item[]): string {
  return items.map(it => {
    if (!('repeat' in it)) return blockShort(it.zone, it.min)
    const inner = it.blocks.map(b => blockShort(b.zone, b.min)).join(', ')
    return it.blocks.length > 1 ? `${it.repeat} × (${inner})` : `${it.repeat} × ${inner}`
  }).join(' + ')
}

/** The fit rule a session breaks where it sits (spec §6.2, rules 2 to 4), in words. */
export function fitWarningText(w: FitWarning, type: SessionType): string {
  switch (w) {
    case 'after_leg_day': return t('{0} the day after leg day', sessionName(type))
    case 'hard_in_a_row': return t('Two hard days in a row')
    default: return t('{0} on a strength day', sessionName(type))
  }
}
