// The run part of the check-in (spec §7.1, plan decisions 1 to 3), in place of "Detail workout":
// the planned workout of the day with "Done as planned" and "Adjust" (its blocks, BlocksEditor), or
// "Off the plan" without one; the distance and the effort, both optional.
//
// `planned` is the workout to link to: plannedOn for a new check-in, the saved `detail.run.planned`
// on an edit. `value` is what goes out as `detail.run`, null when there is nothing to send
// (decision 3: no link, no distance, no effort). A distance typed wrong goes out as NaN, and a block
// out of range as typed, so checkRunDetail refuses what the person sees as wrong and the caller
// waits for it; the reason is shown here, under the field.
import { useId, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import BlocksEditor from './BlocksEditor'
import { blocksInline, itemText, sessionName } from './labels'
import { formatKm, parseKm, plannedMinutes, type RunDetail, type RunPlanned } from './run-detail'
import type { Item } from './types'

type Link = 'as_planned' | 'adjusted'
type Props = {
  planned: RunPlanned | null
  value: RunDetail | null
  onChange(v: RunDetail | null): void
  // The planned minutes, when "Done as planned" is picked: the check-in fills an empty duration.
  onPlannedMinutes?(min: number): void
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const RPE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'

type Parts = { link: Link | null; blocks?: Item[]; distance?: number; rpe?: number }

// What goes out for these choices: the link to `planned` with its status, then the distance and
// the effort; null when there is none of them.
function detailOf(planned: RunPlanned | null, { link, blocks, distance, rpe }: Parts): RunDetail | null {
  const run: RunDetail = { status: 'unplanned' }
  if (planned && link) {
    run.planned = copy(planned)
    run.status = link
    if (link === 'adjusted') run.blocks = blocks ?? copy(planned.blocks)
  }
  if (distance !== undefined) run.distance_km = distance
  if (rpe !== undefined) run.rpe = rpe
  return run.planned || run.distance_km !== undefined || run.rpe !== undefined ? run : null
}

/**
 * The run moved to another day's workout ("Was it yesterday?"): a linked run keeps its status on
 * `planned`, with the blocks of an adjusted one starting again from it; without a workout that day
 * it goes off the plan, or to nothing (decision 3). A run that was not linked stays as it is.
 */
export function relinkRun(run: RunDetail | null, planned: RunPlanned | null): RunDetail | null {
  if (!run?.planned) return run
  return detailOf(planned, { link: run.status === 'unplanned' ? null : run.status, distance: run.distance_km, rpe: run.rpe })
}

export default function RunCheckinForm({ planned, value, onChange, onPlannedMinutes }: Props) {
  const id = useId()
  // The text as typed: "6," on the way to "6,2" is not a number yet.
  const [km, setKm] = useState(() => (value?.distance_km != null && Number.isFinite(value.distance_km) ? formatKm(value.distance_km) : ''))
  const link: Link | null = planned && value && value.status !== 'unplanned' ? value.status : null
  const parts: Parts = { link, blocks: value?.blocks, distance: value?.distance_km, rpe: value?.rpe }
  const emit = (next: Partial<Parts>) => onChange(detailOf(planned, { ...parts, ...next }))
  const kmOk = !km.trim() || parseKm(km) !== null

  const pickLink = (v: string) => {
    if (v === 'as_planned') {
      emit({ link: 'as_planned', blocks: undefined })
      if (planned) onPlannedMinutes?.(plannedMinutes(planned.blocks))
    } else if (v === 'adjusted') emit({ link: 'adjusted', blocks: link === 'adjusted' ? parts.blocks : undefined })
    else emit({ link: null, blocks: undefined })
  }
  const typeKm = (text: string) => {
    const s = text.slice(0, 8)
    setKm(s)
    emit({ distance: !s.trim() ? undefined : parseKm(s) ?? NaN })
  }

  return (
    <div className="flex flex-col gap-5">
      {planned ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-card p-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <p id={id + '-plan'} className="text-[15px] font-semibold">{sessionName(planned.type)}</p>
              <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">{t('{0} min', plannedMinutes(planned.blocks))}</span>
            </div>
            {/* The short line is for the eye; a screen reader gets the minutes spelled out. */}
            <p aria-hidden className="font-mono text-sm tabular-nums">{blocksInline(planned.blocks)}</p>
            <p className="sr-only">{planned.blocks.map(itemText).join('; ')}</p>
          </div>
          <ToggleGroup type="single" variant="outline" spacing={2} className="grid w-full grid-cols-2" aria-labelledby={id + '-plan'}
            value={link ?? ''} onValueChange={pickLink}>
            <ToggleGroupItem value="as_planned" className={cn('h-11 rounded-xl text-[15px] transition-colors duration-150 motion-reduce:transition-none', ON)}>
              {t('Done as planned')}
            </ToggleGroupItem>
            <ToggleGroupItem value="adjusted" className={cn('h-11 rounded-xl text-[15px] transition-colors duration-150 motion-reduce:transition-none', ON)}>
              {t('Adjust')}
            </ToggleGroupItem>
          </ToggleGroup>
          {link === 'adjusted' && parts.blocks && <BlocksEditor items={parts.blocks} onChange={blocks => emit({ blocks })} />}
        </div>
      ) : (
        <p className="rounded-2xl bg-card p-3 text-[15px] font-medium">{t('Off the plan')}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={id + '-km'} className="text-sm font-semibold">{t('Distance (km)')}</label>
        <Input id={id + '-km'} value={km} inputMode="decimal" autoComplete="off"
          aria-invalid={kmOk ? undefined : true} aria-describedby={kmOk ? undefined : id + '-km-note'}
          onChange={e => typeKm(e.target.value)} className="h-12 w-32 font-mono text-[15px] tabular-nums" />
        {!kmOk && <p id={id + '-km-note'} className="text-xs text-destructive">{t('Distance goes from 0.1 to 100 km, with two decimals at most.')}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <p id={id + '-rpe'} className="text-sm font-semibold">{t('Effort')}</p>
        <p id={id + '-rpe-hint'} className="-mt-1 text-xs text-muted-foreground">{t('1 is very light and 10 is your limit.')}</p>
        <ToggleGroup type="single" variant="outline" spacing={1} className="grid w-full grid-cols-5" aria-labelledby={id + '-rpe'} aria-describedby={id + '-rpe-hint'}
          value={parts.rpe !== undefined ? String(parts.rpe) : ''} onValueChange={v => emit({ rpe: v ? Number(v) : undefined })}>
          {RPE.map(n => (
            <ToggleGroupItem key={n} value={String(n)}
              className={cn('h-11 min-w-0 px-1 font-mono text-[15px] tabular-nums transition-colors duration-150 motion-reduce:transition-none', ON)}>
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}
