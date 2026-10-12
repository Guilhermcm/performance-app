import { useId, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { CartesianGrid, ReferenceArea, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { shiftDay } from '../nutrition/days'
import { BED_SLACK_MIN } from './classify'
import { BED_LIMIT, BEDTIME_DAYS, bedtimeDescription, deviationText, shortDate, type BedtimePoint } from './chart-data'
import { nightDate } from './labels'
import { SLEEP_CHART_CARD, SLEEP_CHART_HEIGHT } from './SleepChartSkeleton'
import { fmtClock, fmtGap, shiftClock } from './time'

// Dots in the pillar colour on a wash of it for the ±45 min band; the target line and the arrows
// in the text colour. Where a night stands is read off its position, the tooltip and the table.
const CONFIG = {
  sleep: { color: 'var(--pillar-sleep)' },
  target: { color: 'var(--foreground)' },
} satisfies ChartConfig

const TICKS = [-180, -120, -60, 0, 60, 120, 180]
// Room above and below the ±3h lines for the arrow of a night held at the edge.
const EDGE = 16

// Axis text in the theme's text colour (chart.tsx's selector misses Recharts 3.10's tick labels).
const AXIS_TEXT = { fill: 'var(--muted-foreground)' }

type Props = {
  series: BedtimePoint[]
  // The last day of the 14, and the bedtime the deviations were measured against (plan decision 11).
  today: string
  bedTarget: string
}

type Point = BedtimePoint & { x: number }
const dayIndex = (night: string, today: string) =>
  BEDTIME_DAYS - 1 - Math.round((Date.parse(today) - Date.parse(night)) / 86_400_000)

type DotProps = { cx?: number; cy?: number; payload?: Point }

// A night: an 8 px dot ringed in the card colour, inside a 24 px hit area; held at the edge, an
// arrow points the way it went.
function NightDot({ cx = 0, cy = 0, payload }: DotProps) {
  if (!payload) return <g />
  const up = payload.clamped === 'up'
  const s = up ? -1 : 1
  return (
    <g data-slot="bedtime-dot" data-night={payload.night}>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle data-mark cx={cx} cy={cy} r={4.5} fill="var(--color-sleep)" stroke="var(--card)" strokeWidth={2} />
      {payload.clamped && (
        <path data-arrow={payload.clamped} fill="var(--color-target)"
          d={`M${cx - 4} ${cy + s * 8} L${cx} ${cy + s * 13} L${cx + 4} ${cy + s * 8} Z`} />
      )}
    </g>
  )
}

type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }

export function BedtimeTooltip({ active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload as BedtimePoint | undefined
  if (!active || !p) return null
  return (
    <div data-slot="chart-tooltip" className="grid min-w-[8rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="text-muted-foreground first-letter:uppercase">{nightDate(p.night)}</span>
      <span className="font-medium text-foreground">{deviationText(p)}</span>
    </div>
  )
}

// Spec 7.4: when each of the last 14 logged nights went to bed, around the target.
export default function SleepBedtimeBand({ series, today, bedTarget }: Props) {
  const reduce = useReducedMotion() ?? false
  const [table, setTable] = useState(false)
  const id = useId()
  const data = useMemo<Point[]>(() => series.map(p => ({ ...p, x: dayIndex(p.night, today) })), [series, today])

  return (
    <section data-slot="sleep-bedtime-chart" aria-labelledby={id}
      className={cn(SLEEP_CHART_CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <h2 id={id} className="flex h-7 items-center text-[15px] font-semibold">{t('Bedtime')}</h2>
      <p className="min-h-8 text-xs leading-4 text-muted-foreground">{bedtimeDescription(series)}</p>

      {table ? <BedtimeTable series={series} /> : (
        <>
          <div className="shrink-0" style={{ height: SLEEP_CHART_HEIGHT }}>
            <ChartContainer config={CONFIG} className="aspect-auto size-full [&_.recharts-surface]:overflow-visible"
              initialDimension={{ width: 320, height: SLEEP_CHART_HEIGHT }}>
              <ScatterChart margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                {/* A date every 7 days, counted back from today. */}
                <XAxis type="number" dataKey="x" domain={[-0.5, BEDTIME_DAYS - 0.5]} ticks={[BEDTIME_DAYS - 8, BEDTIME_DAYS - 1]}
                  interval={0} tickFormatter={(i: number) => shortDate(shiftDay(today, i - (BEDTIME_DAYS - 1)))}
                  tick={AXIS_TEXT} tickLine={false} axisLine={false} tickMargin={6} />
                <YAxis type="number" dataKey="dev" width={56} domain={[-BED_LIMIT, BED_LIMIT]} ticks={TICKS} interval={0}
                  allowDataOverflow padding={{ top: EDGE, bottom: EDGE }}
                  tickFormatter={(v: number) => fmtClock(shiftClock(bedTarget, v))} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
                <ReferenceArea className="bedtime-band" y1={-BED_SLACK_MIN} y2={BED_SLACK_MIN}
                  fill="var(--color-sleep)" fillOpacity={0.12} stroke="none" />
                <ReferenceLine className="bedtime-target" y={0} stroke="var(--color-target)" strokeOpacity={0.7} strokeWidth={1.5} />
                <ChartTooltip cursor={false} content={<BedtimeTooltip />} />
                <Scatter data={data} shape={(props: unknown) => <NightDot {...(props as DotProps)} />}
                  isAnimationActive={!reduce} animationDuration={300} />
              </ScatterChart>
            </ChartContainer>
          </div>
          <ul className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-foreground/70" />{t('Bedtime target')}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-3 rounded-[3px] bg-pillar-sleep/12" />{`± ${fmtGap(BED_SLACK_MIN)}`}
            </li>
          </ul>
        </>
      )}

      <Button variant="outline" className="h-11 self-start rounded-xl" onClick={() => setTable(v => !v)}>
        {table ? t('Show as chart') : t('Show as table')}
      </Button>
    </section>
  )
}

function BedtimeTable({ series }: { series: BedtimePoint[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-2 text-start font-normal">{t('Date')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Compared to the target')}</th>
        </tr>
      </thead>
      <tbody>
        {series.map(p => (
          <tr key={p.night} className="border-t border-border">
            <th scope="row" className="py-2 text-start font-normal">{shortDate(p.night, true)}</th>
            <td className="py-2 text-end">{deviationText(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
