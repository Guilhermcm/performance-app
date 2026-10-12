import type { ReactNode } from 'react'
import { t, tn } from '../../lib/i18n.js'
import { averageDuration, nightsOnTarget, regularity, weekDebt, type StatNight } from './stats'
import { fmtDuration, fmtGap } from './time'
import type { NightClass, SleepNight } from './types'

type Props = {
  // Every logged night, closed or open, with the goal in force that night.
  stat: StatNight[]
  closed: SleepNight[]
  // Today's and yesterday's logged nights with their preview.
  open: { night: string; cls: NightClass }[]
  today: string
  // T: nights on target the week asks for.
  target: number
  bedTarget: string
}

// A number with nothing to show yet. Not a pause in a sentence: the value of an empty tile.
const EMPTY = '–'

const REGULARITY_LABEL = { stable: () => t('stable'), ok: () => t('ok'), irregular: () => t('irregular') }

// Spec 7.2 and 7.3: average sleep (7 days, 30 below), regularity, the week's sleep debt and the
// nights on target, each with its label and what it covers, the figures in tabular mono.
export default function SleepStats({ stat, closed, open, today, target, bedTarget }: Props) {
  const avg7 = averageDuration(stat, today, 7)
  const avg30 = averageDuration(stat, today, 30)
  const reg = regularity(stat, today, bedTarget)
  const debt = weekDebt(stat, today)
  const nights = nightsOnTarget(closed, open, today, target)

  return (
    <dl data-testid="sleep-stats" aria-label={t('Sleep stats')} className="grid grid-cols-2 gap-2">
      <Tile name="average" label={t('Average sleep')} scope={t('last 7 days')}
        value={avg7 == null ? EMPTY : fmtDuration(avg7)}
        note={avg30 == null ? t('No nights logged') : t('30 days: {0}', fmtDuration(avg30))} />
      <Tile name="regularity" label={t('Regularity')} scope={t('last 14 days')}
        value={reg ? `± ${fmtGap(reg.sd)}` : EMPTY}
        word={reg ? REGULARITY_LABEL[reg.label]() : undefined}
        note={reg ? undefined : t('Too few nights to measure')} />
      <Tile name="debt" label={t('Sleep debt')} scope={t('this week')} value={fmtDuration(debt)} />
      <Tile name="nights" label={t('Nights on target')} scope={t('this week')}
        value={`${nights.closed}/${nights.target}`}
        note={nights.preview > 0 ? tn(nights.preview, '+{0} to confirm', nights.preview) : undefined} />
    </dl>
  )
}

type TileProps = { name: string; label: string; scope: string; value: string; word?: string; note?: ReactNode }

function Tile({ name, label, scope, value, word, note }: TileProps) {
  return (
    <div data-testid={`sleep-stat-${name}`} className="flex min-h-[104px] flex-col gap-0.5 rounded-2xl bg-card px-4 py-3">
      <dt className="flex flex-col text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{label}</span>
        <span>{scope}</span>
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-1">
        <span data-stat-value className="font-mono text-xl font-semibold tabular-nums">{value}</span>
        {word && <span className="text-sm text-muted-foreground">{` · ${word}`}</span>}
      </dd>
      {note && <dd className="text-xs leading-snug text-muted-foreground">{note}</dd>}
    </div>
  )
}
