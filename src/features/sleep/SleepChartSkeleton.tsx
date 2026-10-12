import { Skeleton } from '@/components/ui/skeleton'
import { t } from '../../lib/i18n.js'

// The box of a sleep chart card, shared with its skeleton so nothing below moves when the chunk
// arrives: title, two lines of description, the plot, the legend and "Show as table". The minimum
// height holds that column whether or not the padding counts (Tailwind runs without preflight).
export const SLEEP_CHART_CARD = 'flex min-h-[400px] flex-col gap-2 rounded-3xl border border-border bg-card p-4 text-card-foreground'
export const SLEEP_CHART_HEIGHT = 208

const KIND = {
  duration: { slot: 'sleep-duration-chart', title: () => t('Sleep duration') },
  bedtime: { slot: 'sleep-bedtime-chart', title: () => t('Bedtime') },
} as const

// Stays in the main bundle (the charts and Recharts load on demand), in the card's shape.
export function SleepChartSkeleton({ kind }: { kind: keyof typeof KIND }) {
  return (
    <section data-slot={KIND[kind].slot} aria-busy="true" aria-label={KIND[kind].title()} className={SLEEP_CHART_CARD}>
      <Skeleton className="h-7 w-36" />
      <div className="flex min-h-8 flex-col gap-1.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
      <Skeleton className="w-full shrink-0 rounded-2xl" style={{ height: SLEEP_CHART_HEIGHT }} />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-11 w-36 rounded-xl" />
    </section>
  )
}
