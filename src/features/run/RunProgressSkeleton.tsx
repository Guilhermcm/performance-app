import { Skeleton } from '@/components/ui/skeleton'
import { t } from '../../lib/i18n.js'

// The box of the weekly minutes chart (RunProgress), shared with its skeleton so nothing below
// moves when the chunk arrives: title, description, the plot, the legend and "Show as table". The
// minimum height holds that column with a description of up to three lines.
export const RUN_CHART_CARD = 'flex min-h-[392px] flex-col gap-2 rounded-3xl border border-border bg-card p-4 text-card-foreground'
export const RUN_CHART_HEIGHT = 184

// Stays in the main bundle (the chart and Recharts load on demand), in the card's shape.
export function RunProgressSkeleton() {
  return (
    <section data-slot="run-progress" aria-busy="true" aria-label={t('Minutes per week')} className={RUN_CHART_CARD}>
      <Skeleton className="h-7 w-40" />
      <div className="flex min-h-8 flex-col gap-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
      <Skeleton className="w-full shrink-0 rounded-2xl" style={{ height: RUN_CHART_HEIGHT }} />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-11 w-36 rounded-xl" />
    </section>
  )
}
