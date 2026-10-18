// Names and texts of the running plan (spec §3, §4.2 and §5.2). Each string is a literal t() call
// so check-source-strings finds it; the pt-BR wording follows the spec's tables.
import { t } from '../../lib/i18n.js'
import type { Item, RunGoal, SessionType, Zone } from './types'

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
