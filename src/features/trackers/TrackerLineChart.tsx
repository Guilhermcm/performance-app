import { useId, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { dateLocale, t } from '../../lib/i18n.js'
import { shortDate } from '../sleep/chart-data'
import { entriesText, lineDescription, longDate, periodTitle, summaryName, tickText, valueTicks } from './chart-data'
import { formatValue } from './format'
import { LINE_CARD_MIN, TRACKER_CHART_CARD, TRACKER_CHART_HEIGHT } from './TrackerChartSkeleton'
import type { Tracker } from './types'

// The day summary in the sleep chart's validated colour, the 7-day average in its own step
// (--chart-trend in tokens.css, checked against it with the dataviz validator in both themes). The
// summary also has dots and the average a label on the line, so neither leans on colour alone.
const CONFIG = {
  summary: { color: 'var(--pillar-sleep)' },
  trend: { color: 'var(--chart-trend)' },
} satisfies ChartConfig

const DOT_R = 4
// Axis text in the theme's text colour (chart.tsx's selector misses Recharts 3.10's tick labels).
const AXIS_TEXT = { fill: 'var(--muted-foreground)' }

export type LinePoint = { day: string; summary: number | null; trend: number | null; count: number }

type Props = { tracker: Tracker; days: string[]; summaries: (number | null)[]; trend: (number | null)[]; counts: number[] }

type DotProps = { cx?: number; cy?: number; payload?: LinePoint }

// A day with entries: a dot of 8 px with a ring in the card colour, so it reads where the lines
// cross. An empty day draws nothing.
function SummaryDot({ cx, cy, payload }: DotProps) {
  if (!payload || payload.summary == null || cx == null || cy == null) return <g />
  return <circle data-slot="summary-dot" data-day={payload.day} cx={cx} cy={cy} r={DOT_R}
    fill="var(--color-summary)" stroke="var(--card)" strokeWidth={2} />
}

type LabelProps = { x?: number | string; y?: number | string; index?: number }

type TooltipProps = { tracker: Tracker; active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }

// Per day: the date, the summary and how many entries, and the 7-day average where there is one.
export function LineTooltip({ tracker, active, payload }: TooltipProps) {
  const p = payload?.[0]?.payload as LinePoint | undefined
  if (!active || !p) return null
  const locale = dateLocale()
  return (
    <div data-slot="chart-tooltip" className="grid min-w-[9rem] gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="text-muted-foreground first-letter:uppercase">{longDate(p.day)}</span>
      {p.summary != null ? (
        <>
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatValue(tracker, p.summary, locale)}</span>
          <span className="text-foreground">{entriesText(p.count)}</span>
        </>
      ) : <span className="text-foreground">{t('No entries')}</span>}
      {p.trend != null && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: 'var(--chart-trend)' }} />
          {t('7-day average')}<span className="font-mono tabular-nums text-foreground">{formatValue(tracker, p.trend, locale)}</span>
        </span>
      )}
    </div>
  )
}

// Spec 8.5 for number and duration trackers: the day summary of each day of the period (dots, and
// a segment only between two days in a row with entries) and the 7-day average as a second series.
// One axis, in the tracker's unit.
export default function TrackerLineChart({ tracker, days, summaries, trend, counts }: Props) {
  const reduce = useReducedMotion() ?? false
  const [table, setTable] = useState(false)
  const id = useId()
  const data = useMemo<LinePoint[]>(
    () => days.map((day, i) => ({ day, summary: summaries[i] ?? null, trend: trend[i] ?? null, count: counts[i] ?? 0 })),
    [days, summaries, trend, counts])
  const empty = data.every(p => p.summary == null)
  const ticks = useMemo(
    () => valueTicks(tracker, data.flatMap(p => [p.summary, p.trend]).filter((v): v is number => v != null)),
    [tracker, data])
  const tickLabels = ticks.map(v => tickText(tracker, v, ticks))
  const axisWidth = Math.min(72, Math.max(28, Math.max(...tickLabels.map(s => s.length)) * 6.5 + 6))
  // A date every week on 30 days, every month on 90, counted back from today so today is labelled.
  const every = days.length > 30 ? 30 : 7
  const dates = useMemo(() => days.filter((_, i) => (days.length - 1 - i) % every === 0), [days, every])
  // The 7-day average is named at its last point, above it (below when that would leave the plot).
  const lastTrend = data.reduce((last, p, i) => (p.trend != null ? i : last), -1)
  const name = summaryName(tracker)
  const unit = tracker.kind === 'number' && tracker.unit ? ` (${tracker.unit})` : ''

  // A ring in the card colour keeps the words readable where they cross the lines.
  const trendLabel = ({ x, y, index }: LabelProps) => {
    if (index !== lastTrend || x == null || y == null) return <g key={index} />
    const top = Number(y) < 18
    return (
      <text key={index} data-slot="trend-label" x={Number(x)} y={Number(y) + (top ? 16 : -10)} textAnchor="end"
        stroke="var(--card)" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round"
        className="fill-muted-foreground text-[11px]">{t('7-day average')}</text>
    )
  }

  return (
    <section data-slot="tracker-line-chart" aria-labelledby={id}
      className={cn(TRACKER_CHART_CARD, !empty && LINE_CARD_MIN, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <h2 id={id} className="flex h-7 items-center text-[15px] font-semibold">{periodTitle(days.length)}</h2>
      <p className="min-h-8 text-xs leading-4 text-muted-foreground">{lineDescription(tracker, summaries)}</p>

      {empty ? null : table ? <LineTable tracker={tracker} data={data} /> : (
        <>
          <div className="shrink-0" style={{ height: TRACKER_CHART_HEIGHT }}>
            <ChartContainer config={CONFIG} className="aspect-auto size-full [&_.recharts-surface]:overflow-visible"
              initialDimension={{ width: 320, height: TRACKER_CHART_HEIGHT }}>
              <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" ticks={dates} interval={0} padding={{ left: 6, right: 6 }} tickFormatter={(v: string) => shortDate(v)}
                  tick={AXIS_TEXT} tickLine={false} axisLine={false} tickMargin={6} />
                <YAxis width={axisWidth} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} interval={0}
                  tickFormatter={(v: number) => tickText(tracker, v, ticks)} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
                <ChartTooltip content={<LineTooltip tracker={tracker} />} />
                <Line className="tracker-trend" dataKey="trend" type="linear" stroke="var(--color-trend)" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={false} connectNulls={false}
                  label={trendLabel} isAnimationActive={!reduce} animationDuration={300} />
                <Line className="tracker-summary" dataKey="summary" type="linear" stroke="var(--color-summary)" strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round" connectNulls={false}
                  dot={(props: unknown) => { const p = props as DotProps & { key?: string }; return <SummaryDot key={p.payload?.day} {...p} /> }}
                  activeDot={{ r: DOT_R + 1, stroke: 'var(--card)', strokeWidth: 2 }}
                  isAnimationActive={!reduce} animationDuration={300} />
              </ComposedChart>
            </ChartContainer>
          </div>
          <ul aria-label={t('Legend')} className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="relative grid h-2 w-4 place-items-center">
                <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-pillar-sleep" />
                <span className="relative size-2 rounded-full bg-pillar-sleep" />
              </span>{name}{unit}
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: 'var(--chart-trend)' }} />{t('7-day average')}
            </li>
          </ul>
        </>
      )}

      {!empty && (
        <Button variant="outline" className="h-11 self-start rounded-xl" onClick={() => setTable(v => !v)}>
          {table ? t('Show as chart') : t('Show as table')}
        </Button>
      )}
    </section>
  )
}

// The days with entries, oldest first: the day, its summary, how many entries and the 7-day average.
function LineTable({ tracker, data }: { tracker: Tracker; data: LinePoint[] }) {
  const locale = dateLocale()
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th scope="col" className="py-2 text-start font-normal">{t('Day')}</th>
          <th scope="col" className="py-2 text-end font-normal">{summaryName(tracker)}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('Entries')}</th>
          <th scope="col" className="py-2 text-end font-normal">{t('7-day average')}</th>
        </tr>
      </thead>
      <tbody>
        {data.filter(p => p.summary != null).map(p => (
          <tr key={p.day} className="border-t border-border">
            <th scope="row" className="py-2 text-start font-normal">{shortDate(p.day, true)}</th>
            <td className="py-2 text-end font-mono tabular-nums">{formatValue(tracker, p.summary as number, locale)}</td>
            <td className="py-2 text-end font-mono tabular-nums">{p.count}</td>
            <td className="py-2 text-end font-mono tabular-nums">{p.trend != null ? formatValue(tracker, p.trend, locale) : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
