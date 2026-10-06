import { useMemo, useState, type ComponentType } from 'react'
import { useReducedMotion } from 'motion/react'
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from 'recharts'
import type { BaseTickContentProps, DotItemDotProps } from 'recharts/types/util/types'
import { Apple, ChevronRight, Dumbbell, ListChecks, Lock, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t, dateLocale } from '../../lib/i18n.js'
import NutritionSetup from '../nutrition/NutritionSetup'
import type { PillarKey, Progress } from '../gamification/types'
import { RADAR_CARD, RADAR_CHART_HEIGHT } from './PillarRadarSkeleton'

// One axis per pillar of the roadmap, released or not, clockwise from the top.
const AXES: readonly PillarKey[] = ['strength', 'nutrition', 'sleep', 'habits']

type AxisState = 'on' | 'off' | 'soon'
type Enabled = Partial<Record<PillarKey, boolean>>
type Props = {
  // A progress cached by a build from before the radar has none: every axis then starts empty.
  radar: Progress['radar'] | undefined | null
  enabled: Enabled
  released: readonly PillarKey[]
}

const PILLAR: Record<PillarKey, { name: () => string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }> = {
  strength: { name: () => t('Strength'), icon: Dumbbell },
  nutrition: { name: () => t('Nutrition'), icon: Apple },
  sleep: { name: () => t('Sleep'), icon: Moon },
  habits: { name: () => t('Habits'), icon: ListChecks }
}

// What the lock offers, per pillar that can be off. Strength is always on.
const TURN_ON: Partial<Record<PillarKey, () => string>> = {
  nutrition: () => t('Turn on Nutrition')
}

// Shapes in the accent, the previous window as a faded outline, the vertex dots in the pillar
// colours. No --chart-N tokens: everything comes from the app's own.
const CONFIG = {
  current: { label: 'current', color: 'var(--primary)' },
  previous: { label: 'previous', color: 'var(--muted-foreground)' },
  strength: { color: 'var(--pillar-strength)' },
  nutrition: { color: 'var(--pillar-nutrition)' },
  sleep: { color: 'var(--pillar-sleep)' },
  habits: { color: 'var(--pillar-habits)' }
} satisfies ChartConfig

const OUTER_RADIUS = 72
const LABEL_W = 92
const LABEL_H = 44

export function axisState(pillar: PillarKey, enabled: Enabled, released: readonly PillarKey[]): AxisState {
  if (!released.includes(pillar)) return 'soon'
  return enabled[pillar] ? 'on' : 'off'
}

const share = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.min(1, Math.max(0, v)))
const pct = (v: number) => new Intl.NumberFormat(dateLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(v)

// The chart in words, for screen readers: "Strength 82%, Nutrition 64%, Sleep coming soon, ...".
export function radarDescription(radar: Props['radar'], enabled: Enabled, released: readonly PillarKey[]): string {
  return AXES.map(p => {
    const name = PILLAR[p].name()
    const state = axisState(p, enabled, released)
    if (state === 'soon') return t('{0} coming soon', name)
    if (state === 'off') return t('{0}: off', name)
    const v = share(radar?.[p]?.current)
    return v == null ? t('{0}: no weeks yet', name) : `${name} ${pct(v)}`
  }).join(', ')
}

type Row = { pillar: PillarKey; state: AxisState; current: number | null; previous: number | null; c: number; p: number }

// Consistency per pillar over the last 4 closed weeks, with the 4 before them drawn behind.
// Off and coming soon axes are dashed and sit at the centre; an active pillar without an active
// week also sits at the centre, its label saying so. Tapping the chart opens the numbers; tapping
// a lock opens that pillar's activation.
export default function PillarRadar({ radar, enabled, released }: Props) {
  const reduce = useReducedMotion() ?? false
  const [detail, setDetail] = useState(false)
  const [setup, setSetup] = useState(false)

  const rows: Row[] = useMemo(() => AXES.map(pillar => {
    const state = axisState(pillar, enabled, released)
    const point = state === 'soon' ? undefined : radar?.[pillar]
    const current = share(point?.current)
    const previous = share(point?.previous)
    // Only an active pillar draws a shape; the rest stay at the centre.
    return { pillar, state, current, previous, c: state === 'on' ? current ?? 0 : 0, p: state === 'on' ? previous ?? 0 : 0 }
  }), [radar, enabled, released])

  const description = radarDescription(radar, enabled, released)
  const activate = () => { setDetail(false); setSetup(true) }

  const renderTick = (props: BaseTickContentProps) => (
    <AxisTick {...(props as TickProps)} row={rows[props.index]} onActivate={activate} />
  )

  const renderDot = ({ cx, cy, index }: DotItemDotProps) => {
    const row = rows[index]
    if (row.state !== 'on' || cx == null || cy == null) return <g key={index} />
    return (
      <circle key={index} data-vertex={row.pillar} cx={cx} cy={cy} r={4.5}
        fill={`var(--color-${row.pillar})`} stroke="var(--card)" strokeWidth={2} />
    )
  }

  return (
    <section data-slot="pillar-radar" aria-labelledby="pillar-radar-title"
      className={cn(RADAR_CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <h2 id="pillar-radar-title" className="flex h-7 items-center text-[15px] font-semibold">{t('Pillars')}</h2>
      <p className="sr-only">{description}</p>

      {/* The chart is a tap target for the details; the footer button is the keyboard path. */}
      <div className="shrink-0 cursor-pointer" style={{ height: RADAR_CHART_HEIGHT }} onClick={() => setDetail(true)}>
        <ChartContainer config={CONFIG} className="aspect-auto size-full [&_.recharts-surface]:overflow-visible"
          initialDimension={{ width: 320, height: RADAR_CHART_HEIGHT }}>
          <RadarChart data={rows} outerRadius={OUTER_RADIUS} accessibilityLayer={false}>
            <PolarGrid gridType="circle" radialLines={false} />
            <PolarRadiusAxis domain={[0, 1]} tickCount={5} tick={false} axisLine={false} />
            <PolarAngleAxis dataKey="pillar" tick={renderTick} tickLine={false} axisLine={false} />
            <Radar className="radar-previous" dataKey="p" fill="none" stroke="var(--color-previous)" strokeOpacity={0.55}
              strokeWidth={1.5} strokeDasharray="4 4" dot={false}
              isAnimationActive={!reduce} animationDuration={300} />
            <Radar className="radar-current" dataKey="c" fill="var(--color-current)" fillOpacity={0.18}
              stroke="var(--color-current)" strokeWidth={2} dot={renderDot}
              isAnimationActive={!reduce} animationDuration={300} />
          </RadarChart>
        </ChartContainer>
      </div>

      <button type="button" data-slot="radar-details" aria-label={t('Pillar details')} onClick={() => setDetail(true)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl bg-secondary/60 px-3.5 text-left text-xs text-muted-foreground outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-primary" />{t('Last 4 weeks')}</span>
          <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-muted-foreground/70" />{t('4 weeks before')}</span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </button>

      <RadarDetail open={detail} onOpenChange={setDetail} rows={rows} onActivate={activate} />
      <NutritionSetup open={setup} onOpenChange={setSetup} />
    </section>
  )
}

type TickProps = BaseTickContentProps & { cx: number; cy: number; radius: number }

// An axis line (dashed unless the pillar is active) and its label: icon, name and the share, or
// the state. Text stays in the theme's text colours; the pillar colour is only on the dot.
function AxisTick({ x, y, cx, cy, radius, textAnchor, row, onActivate }: TickProps & { row: Row; onActivate: () => void }) {
  const tx = Number(x), ty = Number(y)
  const dx = tx - cx, dy = ty - cy
  const len = Math.hypot(dx, dy) || 1
  const end = { x: cx + (dx / len) * radius, y: cy + (dy / len) * radius }
  // Above or below the chart the label is centred on the axis; at the sides it hangs off it.
  const left = textAnchor === 'end' ? tx - LABEL_W : textAnchor === 'start' ? tx : tx - LABEL_W / 2
  const top = textAnchor !== 'middle' ? ty - LABEL_H / 2 : ty < cy ? ty - LABEL_H : ty
  const align = textAnchor === 'end' ? 'items-end text-right' : textAnchor === 'start' ? 'items-start text-left' : 'items-center text-center'
  const { icon: Icon, name } = PILLAR[row.pillar]
  const turnOn = TURN_ON[row.pillar]

  const label = (
    <>
      <span className="flex items-center gap-1 font-medium text-foreground">
        {row.state === 'on' && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--color-${row.pillar})` }} />}
        {row.state === 'off'
          ? <Lock aria-hidden data-icon="lock" className="size-3.5 shrink-0 text-muted-foreground" />
          : <Icon aria-hidden className={cn('size-3.5 shrink-0', row.state === 'on' ? 'text-foreground' : 'text-muted-foreground')} />}
        <span className={cn('truncate', row.state === 'soon' && 'text-muted-foreground')}>{name()}</span>
      </span>
      <span className={cn('leading-tight', row.state === 'on' && row.current != null ? 'font-mono tabular-nums text-foreground' : 'text-muted-foreground')}>
        {row.state === 'soon' ? t('Coming soon') : row.state === 'off' ? (turnOn ? t('Turn on') : t('Turned off')) : row.current == null ? t('No weeks yet') : pct(row.current)}
      </span>
    </>
  )

  return (
    <g data-slot="radar-tick" data-pillar={row.pillar} data-state={row.state}>
      <line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="var(--border)" strokeWidth={1}
        strokeDasharray={row.state === 'on' ? undefined : '3 4'} />
      <foreignObject x={left} y={top} width={LABEL_W} height={LABEL_H} overflow="visible">
        {row.state === 'off' && turnOn ? (
          <button type="button" data-slot="radar-activate" aria-label={turnOn()} onClick={e => { e.stopPropagation(); onActivate() }}
            className={cn('flex size-full flex-col justify-center gap-0.5 rounded-xl text-[11px] leading-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', align)}>
            {label}
          </button>
        ) : (
          <div className={cn('flex size-full flex-col justify-center gap-0.5 text-[11px] leading-tight', align)}>{label}</div>
        )}
      </foreignObject>
    </g>
  )
}

// The numbers behind the shape: each pillar in both windows, and the way to turn on one that is off.
function RadarDetail({ open, onOpenChange, rows, onActivate }: { open: boolean; onOpenChange: (open: boolean) => void; rows: Row[]; onActivate: () => void }) {
  const cell = (row: Row, v: number | null) =>
    row.state === 'soon' ? t('Coming soon') : v != null ? pct(v) : row.state === 'off' ? t('Turned off') : t('No weeks yet')
  const off = rows.filter(r => r.state === 'off' && TURN_ON[r.pillar])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('Pillars')}</DrawerTitle>
          <DrawerDescription>{t('How much of the possible XP each pillar earned in the last 4 closed weeks and the 4 before them.')}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="py-2 text-left font-normal"><span className="sr-only">{t('Pillars')}</span></th>
                <th scope="col" className="py-2 text-right font-normal">{t('Last 4 weeks')}</th>
                <th scope="col" className="py-2 text-right font-normal">{t('4 weeks before')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const { icon: Icon, name } = PILLAR[row.pillar]
                return (
                  <tr key={row.pillar} className="border-t border-border">
                    <th scope="row" className="py-3 text-left font-medium">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--pillar-${row.pillar})` }} />
                        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />{name()}
                      </span>
                    </th>
                    {[row.current, row.previous].map((v, i) => (
                      <td key={i} className={cn('py-3 text-right', v != null && row.state !== 'soon' ? 'font-mono tabular-nums' : 'text-muted-foreground')}>{cell(row, v)}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {off.map(r => (
            <Button key={r.pillar} variant="outline" className="mt-3 h-11 w-full gap-2 rounded-xl" onClick={onActivate}>
              <Lock aria-hidden className="size-4" />{TURN_ON[r.pillar]!()}
            </Button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
