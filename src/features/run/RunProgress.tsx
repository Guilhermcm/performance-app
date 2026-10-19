// The weekly minutes of the running plan (spec §8.1), loaded on demand with Recharts: a bar of the
// minutes run in each calendar week of the plan (volumeSeries) with the planned minutes as a step
// line, a description in text and "Show as table". One series, so one colour: --chart-bar, checked
// with the dataviz validate_palette.js on --card in both themes (L in the band, chroma 0.10 or
// more, contrast 3:1 or more). The planned line wears the text colour, and the legend, the tooltip
// and the table say what the colour says.
import { useId, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Bar, CartesianGrid, ComposedChart, Line, Rectangle, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import { RUN_CHART_CARD, RUN_CHART_HEIGHT } from './RunProgressSkeleton'

export type VolumePoint = { index: number; planned: number; done: number }

const CONFIG = {
  done: { color: 'var(--chart-bar)' },
  planned: { color: 'var(--foreground)' },
} satisfies ChartConfig

// Axis text in the theme's text colour (chart.tsx's selector misses Recharts 3.10's tick labels).
const AXIS_TEXT = { fill: 'var(--muted-foreground)' }

const sum = (series: VolumePoint[], key: 'done' | 'planned') => series.reduce((n, p) => n + p[key], 0)

/**
 * The chart in words: the minutes run against the planned ones. With `inProgress` the last point is
 * the week still going on, whose planned minutes are not all runnable yet, so the sums cover the
 * weeks before it (R3 M2); in week 1 only this week is told.
 */
export function volumeDescription(series: VolumePoint[], inProgress = false): string {
  if (!sum(series, 'done')) return t('You haven’t logged a run in this plan yet. The bars show your minutes each week against the plan.')
  const closed = inProgress ? series.slice(0, -1) : series
  if (!closed.length) return t('This week you ran {0} of {1} planned minutes', sum(series, 'done'), sum(series, 'planned'))
  const done = sum(closed, 'done')
  const planned = sum(closed, 'planned')
  if (closed.length === 1) {
    return inProgress
      ? t('Last week you ran {0} of {1} planned minutes', done, planned)
      : t('This week you ran {0} of {1} planned minutes', done, planned)
  }
  return tn(closed.length, 'Over the last {0} weeks you ran {1} of {2} planned minutes', closed.length, done, planned)
}

// The minutes axis: 0 to at least an hour, in steps of 30, 60 or 120 minutes.
function minuteTicks(series: VolumePoint[]): number[] {
  const top = Math.max(60, ...series.map(p => Math.max(p.done, p.planned)))
  const step = top <= 120 ? 30 : top <= 360 ? 60 : 120
  const max = Math.ceil(top / step) * step
  return Array.from({ length: max / step + 1 }, (_, i) => i * step)
}

type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; payload?: VolumePoint }

// One week's bar, rounded at the top only; a week without a run draws nothing.
function WeekBar({ x = 0, y = 0, width = 0, height = 0, payload }: BarShapeProps) {
  if (!payload || !payload.done) return <g />
  return (
    <g data-slot="week-bar" data-week={payload.index}>
      <Rectangle x={x} y={y} width={width} height={height} radius={[4, 4, 0, 0]} fill="var(--color-done)" />
    </g>
  )
}

type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }

// Per week: its number and the minutes run against the planned ones.
export function WeekTooltip({ active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload as VolumePoint | undefined
  if (!active || !p) return null
  return (
    <div data-slot="chart-tooltip" className="grid min-w-[7rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="text-muted-foreground">{t('Week {0}', p.index)}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{t('{0} of {1} min', p.done, p.planned)}</span>
    </div>
  )
}

/** `inProgress`: the last point of `series` is the current week, not over yet. */
export default function RunProgress({ series, inProgress = false }: { series: VolumePoint[]; inProgress?: boolean }) {
  const reduce = useReducedMotion() ?? false
  const [table, setTable] = useState(false)
  const id = useId()
  const ticks = useMemo(() => minuteTicks(series), [series])

  return (
    <section data-slot="run-progress" aria-labelledby={id}
      className={cn(RUN_CHART_CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <h3 id={id} className="flex h-7 items-center text-[15px] font-semibold text-foreground">{t('Minutes per week')}</h3>
      <p className="min-h-8 text-xs leading-4 text-muted-foreground">{volumeDescription(series, inProgress)}</p>

      {table ? <VolumeTable series={series} /> : (
        <>
          <div className="shrink-0" style={{ height: RUN_CHART_HEIGHT }}>
            <ChartContainer config={CONFIG} className="aspect-auto size-full [&_.recharts-surface]:overflow-visible"
              initialDimension={{ width: 320, height: RUN_CHART_HEIGHT }}>
              <ComposedChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="index" interval="preserveStartEnd" tick={AXIS_TEXT} tickLine={false} axisLine={false} tickMargin={6} />
                <YAxis width={36} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} interval={0}
                  tick={AXIS_TEXT} tickLine={false} axisLine={false} />
                <ChartTooltip content={<WeekTooltip />} />
                <Bar dataKey="done" maxBarSize={24} shape={(props: unknown) => <WeekBar {...(props as BarShapeProps)} />}
                  isAnimationActive={!reduce} animationDuration={300} />
                <Line className="run-planned" dataKey="planned" type="step" stroke="var(--color-planned)" strokeOpacity={0.7}
                  strokeWidth={2} dot={false} activeDot={false} isAnimationActive={!reduce} animationDuration={300} />
              </ComposedChart>
            </ChartContainer>
          </div>
          <ul className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-3 rounded-[3px] bg-[var(--chart-bar)]" />{t('Minutes run')}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-foreground/70" />{t('Planned')}
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

function VolumeTable({ series }: { series: VolumePoint[] }) {
  return (
    <table className="w-full border-collapse text-sm text-foreground">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-2 text-start font-normal">{t('Week')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Planned (min)')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Done (min)')}</th>
        </tr>
      </thead>
      <tbody>
        {series.map(p => (
          <tr key={p.index} className="border-t border-border">
            <th scope="row" className="py-2 text-start font-normal">{t('Week {0}', p.index)}</th>
            <td className="py-2 text-end font-mono tabular-nums">{p.planned}</td>
            <td className="py-2 text-end font-mono tabular-nums">{p.done}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
