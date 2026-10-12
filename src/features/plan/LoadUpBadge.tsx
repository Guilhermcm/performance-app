// "Suba a carga" (spec §6): on the routine list, the load the next workout of an exercise goes up
// to, when the last session earned it (every rep done; with double progression, the top of the
// range in every set). The number is nextPrescription's, so it is the one the workout opens with.
import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import { InfoSource } from '@/components/ui/info-source'
import { t } from '../../lib/i18n.js'
import { fmtNum } from '../../lib/format.js'
import { nextPrescription } from '../../lib/progression.js'
import { isAssisted } from '../../lib/exercises.js'

type Cfg = { id: string; [key: string]: unknown }
type Routine = { id: string; [key: string]: unknown }
type State = { unit?: string; workouts?: unknown; [key: string]: unknown }

// The weight of the next workout when it goes up, or null. Only a load counts: bodyweight work
// goes up in reps, and on an assistance machine "up" is less help, a lighter number.
export function loadUp(S: State, cfg: Cfg | null | undefined, routine: Routine | null | undefined): { weight: number } | null {
  if (!cfg || isAssisted(cfg)) return null
  const p = nextPrescription(S, cfg, routine) as { kind: string; weight?: number }
  return p.kind === 'up' && typeof p.weight === 'number' && p.weight > 0 ? { weight: p.weight } : null
}

export function LoadUpBadge({ S, cfg, routine }: { S: State; cfg: Cfg; routine: Routine }) {
  // The history scan runs again only when the log, the unit or the exercise's plan changes.
  const up = useMemo(() => loadUp(S, cfg, routine), [S.workouts, S.unit, cfg, routine])
  if (!up) return null
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  return (
    <span className="inline-flex max-w-full items-center gap-0.5">
      <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
        <TrendingUp aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{t('Next workout: {0}', `${fmtNum(up.weight)} ${unit}`)}</span>
      </span>
      {/* Only the ⓘ keeps its tap: on the routine list a tap on the pill still edits the row, and
          a tap on the ⓘ, or inside the balloon it opens (the portal bubbles in React), does not. */}
      <span data-nodrag className="inline-flex" onClick={ev => ev.stopPropagation()}>
        <InfoSource refs={['plotkin2022']} label={t('Why raise the load')}
          note={t('You did every rep last time, so the load can go up.')} />
      </span>
    </span>
  )
}
