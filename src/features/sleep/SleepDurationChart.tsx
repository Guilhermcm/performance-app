import { useId, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Bar, CartesianGrid, ComposedChart, Line, Rectangle, XAxis, YAxis } from 'recharts'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { DURATION_DAYS, durationDescription, durationState, shortDate, type DurationPoint } from './chart-data'
import { nightDate } from './labels'
import { SLEEP_CHART_CARD, SLEEP_CHART_HEIGHT } from './SleepChartSkeleton'
import { fmtDuration } from './time'

// Bars on target in the pillar colour, the rest in a neutral wash, the goal line in the text colour.
// The colour only repeats what the check on top, the tooltip and the table say.
const CONFIG = {
  sleep: { color: 'var(--pillar-sleep)' },
  other: { color: 'var(--muted-foreground)' },
  goal: { color: 'var(--foreground)' },
} satisfies ChartConfig

const OTHER_OPACITY = 0.45
const CHECK = 10
const HOUR_STEP = 120

// The hours axis: 0 to at least 10h, in 2h steps, high enough for the longest night and goal.
function hourTicks(series: DurationPoint[]): number[] {
  const top = Math.max(600, ...series.map(p => Math.max(p.duration ?? 0, p.goal ?? 0)))
  const max = Math.ceil(top / HOUR_STEP) * HOUR_STEP
  return Array.from({ length: max / HOUR_STEP + 1 }, (_, i) => i * HOUR_STEP)
}

// Axis text in the theme's text colour (chart.tsx's selector misses Recharts 3.10's tick labels).
const AXIS_TEXT = { fill: 'var(--muted-foreground)' }

type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; payload?: DurationPoint }

// One night's bar, rounded at the top only, with the check above it when the night was on target.
// An empty night draws nothing.
function NightBar({ x = 0, y = 0, width = 0, height = 0, payload }: BarShapeProps) {
  if (!payload || payload.duration == null) return <g />
  const on = payload.onTarget
  return (
    <g data-slot="duration-bar" data-night={payload.night}>
      <Rectangle x={x} y={y} width={width} height={height} radius={[4, 4, 0, 0]}
        fill={on ? 'var(--color-sleep)' : 'var(--color-other)'} fillOpacity={on ? 1 : OTHER_OPACITY} />
      {on && (
        <Check data-slot="bar-check" aria-hidden x={x + width / 2 - CHECK / 2} y={y - CHECK - 2} width={CHECK} height={CHECK}
          strokeWidth={3.5} className="text-foreground" />
      )}
    </g>
  )
}

type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }

// Per bar: the date, how long and where the night stands; an empty night says it was not logged.
export function DurationTooltip({ active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload as DurationPoint | undefined
  if (!active || !p) return null
  return (
    <div data-slot="chart-tooltip" className="grid min-w-[8rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="text-muted-foreground first-letter:uppercase">{nightDate(p.night)}</span>
      {p.duration != null && <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmtDuration(p.duration)}</span>}
      <span className="font-medium text-foreground">{durationState(p)}</span>
    </div>
  )
}

// Spec 7.4: how long each of the last 30 nights lasted against the goal in force that night.
export default function SleepDurationChart({ series }: { series: DurationPoint[] }) {
  const reduce = useReducedMotion() ?? false
  const [table, setTable] = useState(false)
  const id = useId()
  const ticks = useMemo(() => hourTicks(series), [series])
  // A date every 7 days, counted back from today so today is always labelled.
  const dates = useMemo(() => series.filter((_, i) => (DURATION_DAYS - 1 - i) % 7 === 0).map(p => p.night), [series])

  return (
    <section data-slot="sleep-duration-chart" aria-labelledby={id}
      className={cn(SLEEP_CHART_CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <h2 id={id} className="flex h-7 items-center text-[15px] font-semibold">{t('Sleep duration')}</h2>
      <p className="min-h-8 text-xs leading-4 text-muted-foreground">{durationDescription(series)}</p>

      {table ? <DurationTable series={series} /> : (
        <>
          <div className="shrink-0" style={{ height: SLEEP_CHART_HEIGHT }}>
            <ChartContainer config={CONFIG} className="aspect-auto size-full [&_.recharts-surface]:overflow-visible"
              initialDimension={{ width: 320, height: SLEEP_CHART_HEIGHT }}>
              <ComposedChart data={series} margin={{ top: CHECK + 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="night" ticks={dates} interval={0} tickFormatter={(v: string) => shortDate(v)}
                  tick={AXIS_TEXT} tickLine={false} axisLine={false} tickMargin={6} />
                <YAxis width={36} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} interval={0}
                  tickFormatter={(v: number) => fmtDuration(v)} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
                <ChartTooltip content={<DurationTooltip />} />
                <Bar dataKey="duration" maxBarSize={24} shape={(props: unknown) => <NightBar {...(props as BarShapeProps)} />}
                  isAnimationActive={!reduce} animationDuration={300} />
                <Line className="duration-goal" dataKey="goal" type="step" stroke="var(--color-goal)" strokeOpacity={0.7}
                  strokeWidth={2} dot={false} activeDot={false} connectNulls={false}
                  isAnimationActive={!reduce} animationDuration={300} />
              </ComposedChart>
            </ChartContainer>
          </div>
          <ul className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="grid size-3 place-items-center rounded-[3px] bg-pillar-sleep">
                <Check className="size-2.5 text-background" strokeWidth={4} />
              </span>{t('On target')}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-3 rounded-[3px] bg-muted-foreground" style={{ opacity: OTHER_OPACITY }} />{t('Off target')}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-foreground/70" />{t('Goal')}
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

function DurationTable({ series }: { series: DurationPoint[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-2 text-start font-normal">{t('Date')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Duration')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Status')}</th>
        </tr>
      </thead>
      <tbody>
        {series.map(p => (
          <tr key={p.night} className="border-t border-border">
            <th scope="row" className="py-2 text-start font-normal">{shortDate(p.night, true)}</th>
            <td className="py-2 text-end font-mono tabular-nums">{p.duration != null ? fmtDuration(p.duration) : null}</td>
            <td className={cn('py-2 text-end', p.duration == null && 'text-muted-foreground')}>{durationState(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
