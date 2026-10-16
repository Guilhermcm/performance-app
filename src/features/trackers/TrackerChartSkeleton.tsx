import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { periodTitle } from './chart-data'

// The box of a tracker chart card, shared with its skeleton so nothing below moves when the chunk
// arrives: title, description, the plot, the legend and "Show as table". The minimum height holds
// that column with a description of up to three lines, as in the sleep charts.
export const TRACKER_CHART_CARD = 'flex flex-col gap-2 rounded-3xl border border-border bg-card p-4 text-card-foreground'
export const LINE_CARD_MIN = 'min-h-[416px]'
export const TRACKER_CHART_HEIGHT = 208
// One option of the label bars: its text over the bar and the count (see TrackerBars).
export const BAR_ROW = 'flex h-10 flex-col justify-between'
export const BAR_LIST = 'flex flex-col gap-3 py-1'

type Props =
  | { kind: 'line'; days: number; empty?: boolean }
  | { kind: 'bars'; days: number; options: number }

// Stays out of the chart chunks (they and Recharts load on demand), in the card's shape: the line
// chart's plot, or one row per option of the bars. An empty line chart is its description alone.
export function TrackerChartSkeleton(props: Props) {
  const line = props.kind === 'line'
  const empty = line && props.empty
  return (
    <section data-slot={line ? 'tracker-line-chart' : 'tracker-bars'} aria-busy="true" aria-label={periodTitle(props.days)}
      className={cn(TRACKER_CHART_CARD, line && !empty && LINE_CARD_MIN)}>
      <Skeleton className="h-7 w-36" />
      <div className="flex min-h-8 flex-col gap-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
      {empty ? null : line ? (
        <>
          <Skeleton className="w-full shrink-0 rounded-2xl" style={{ height: TRACKER_CHART_HEIGHT }} />
          <Skeleton className="h-5 w-48" />
        </>
      ) : (
        <div className={BAR_LIST}>
          {Array.from({ length: props.options }, (_, i) => (
            <div key={i} className={BAR_ROW}><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-full" /></div>
          ))}
        </div>
      )}
      {!empty && <Skeleton className="h-11 w-36 rounded-xl" />}
    </section>
  )
}

// The whole detail screen while its chunk or the first load comes: the header, the period switch,
// the chart card, the stats and a few entries. Kept here so App.jsx can show it without the detail.
export function TrackerDetailSkeleton() {
  return (
    <div data-testid="tracker-detail-skeleton" role="status" aria-busy="true" aria-label={t('Loading…')}
      className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6">
      <div className="flex h-11 items-center justify-between"><Skeleton className="size-9 rounded-full" /><Skeleton className="size-9 rounded-full" /></div>
      <div className="flex items-center gap-3"><Skeleton className="size-10 rounded-xl" /><Skeleton className="h-7 w-40" /></div>
      <Skeleton className="h-11 w-48 rounded-xl" />
      <Skeleton className="h-[416px] rounded-3xl" />
      <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[72px] rounded-2xl" />)}</div>
      <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
    </div>
  )
}
