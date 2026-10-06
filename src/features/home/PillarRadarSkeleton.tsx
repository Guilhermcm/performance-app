import { Skeleton } from '@/components/ui/skeleton'
import { t } from '../../lib/i18n.js'

// The radar card's box, shared with its skeleton so nothing below moves when the chunk arrives.
export const RADAR_CARD = 'flex h-[364px] flex-col gap-1.5 rounded-3xl border border-border bg-card p-4 text-card-foreground'
export const RADAR_CHART_HEIGHT = 248

// Stays in the main bundle (PillarRadar and Recharts load on demand): the title, a ring where the
// chart goes and the footer button, in the card's shape.
export function PillarRadarSkeleton() {
  return (
    <section data-slot="pillar-radar" aria-busy="true" aria-label={t('Pillars')} className={RADAR_CARD}>
      <Skeleton className="h-7 w-24" />
      <div className="grid shrink-0 place-items-center" style={{ height: RADAR_CHART_HEIGHT }}>
        <Skeleton className="size-40 rounded-full" />
      </div>
      <Skeleton className="h-11 w-full rounded-2xl" />
    </section>
  )
}
