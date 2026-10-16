// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

// happy-dom has no layout, so ResponsiveContainer measures 0 and draws nothing: give the chart a
// fixed size and keep the rest of Recharts real (as in SleepDurationChart.test.tsx).
vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 340, height: 208 })
}))
// Reduced motion: the lines are drawn in place, without the draw-in animation.
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import TrackerLineChart, { LineTooltip } from './TrackerLineChart'
import { TRACKER_CHART_CARD } from './TrackerChartSkeleton'
import { periodDays } from './chart-data'
import { movingAverage } from './stats'
import { setLang } from '../../lib/i18n.js'
import { trackerOf } from './test-trackers'

const TODAY = '2026-10-14'
const DAYS = periodDays(TODAY, 30)
const WATER = trackerOf()
const READING = trackerOf({ kind: 'duration', unit: null, decimals: null, aggregate: 'sum' })

// Entries on the 1st, 2nd and 4th day of the period (2.0, 1.5 and 2.5 L), nothing else.
function series(values: Record<number, number>, counts: Record<number, number> = {}) {
  const summaries = DAYS.map((_, i) => values[i] ?? null)
  const map = new Map<string, { value: number }>()
  DAYS.forEach((d, i) => { if (summaries[i] != null) map.set(d, { value: summaries[i] as number }) })
  return { days: DAYS, summaries, trend: movingAverage(map, DAYS), counts: DAYS.map((_, i) => (values[i] != null ? counts[i] ?? 1 : 0)) }
}
const GAP = series({ 0: 2, 1: 1.5, 3: 2.5 }, { 1: 2 })

const summaryPath = (c: HTMLElement) => c.querySelector('.tracker-summary path.recharts-curve')?.getAttribute('d') ?? ''
const moves = (d: string) => (d.match(/M/g) ?? []).length
const lines = (d: string) => (d.match(/L/g) ?? []).length

afterEach(async () => { cleanup(); await setLang('en') })

describe('TrackerLineChart', () => {
  it('describes the chart in text, in the card of its skeleton', () => {
    const { container } = render(<TrackerLineChart tracker={WATER} {...GAP} />)
    expect(screen.getByRole('heading', { name: 'Last 30 days' })).toBeTruthy()
    expect(screen.getByText('Average of 2.0 L over the last 30 days, 3 days with entries')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[data-slot="tracker-line-chart"]')!.className).toContain(TRACKER_CHART_CARD)
  })

  it('joins only consecutive days: the 1st to the 2nd, never the 2nd to the 4th across the empty 3rd', () => {
    const { container } = render(<TrackerLineChart tracker={WATER} {...GAP} />)
    const d = summaryPath(container)
    // Two pieces: the segment 1→2, and the 4th day alone.
    expect(moves(d)).toBe(2)
    expect(lines(d)).toBe(1)
    // A dot of at least 8 px on each day with an entry, and none on an empty day.
    const dots = container.querySelectorAll('[data-slot="summary-dot"]')
    expect([...dots].map(x => x.getAttribute('data-day'))).toEqual([DAYS[0], DAYS[1], DAYS[3]])
    for (const dot of dots) expect(Number(dot.getAttribute('r'))).toBeGreaterThanOrEqual(4)
  })

  it('draws the 7-day average as a second series, with a legend and a label on the line', () => {
    const { container } = render(<TrackerLineChart tracker={WATER} {...GAP} />)
    expect(container.querySelector('.tracker-trend path.recharts-curve')).toBeTruthy()
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('Day total (L)')).toBeTruthy()
    expect(within(legend).getByText('7-day average')).toBeTruthy()
    expect(container.querySelector('[data-slot="trend-label"]')!.textContent).toBe('7-day average')
    // The two series wear the sleep chart colour and the trend step, never in the text.
    expect(container.querySelector('.tracker-summary path.recharts-curve')!.getAttribute('stroke')).toBe('var(--color-summary)')
    expect(container.querySelector('.tracker-trend path.recharts-curve')!.getAttribute('stroke')).toBe('var(--color-trend)')
  })

  it('draws a lone day as a dot without a line', () => {
    const { container } = render(<TrackerLineChart tracker={WATER} {...series({ 29: 1.8 })} />)
    expect(container.querySelectorAll('[data-slot="summary-dot"]')).toHaveLength(1)
    expect(lines(summaryPath(container))).toBe(0)
  })

  it('shows only the description when the period is empty, with no chart and no table', () => {
    const { container } = render(<TrackerLineChart tracker={WATER} {...series({})} />)
    expect(screen.getByText('No entries in the last 30 days')).toBeTruthy()
    expect(container.querySelector('svg.recharts-surface')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show as table' })).toBeNull()
  })

  it('writes a duration axis in hours and minutes', () => {
    const { container } = render(<TrackerLineChart tracker={READING} {...series({ 27: 90, 28: 150 })} />)
    const ticks = [...container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map(x => x.textContent)
    expect(ticks).toEqual(['0 min', '1 h', '2 h', '3 h'])
  })

  it('shows a row per day with entries as a table: day, summary, entries and the 7-day average', () => {
    render(<TrackerLineChart tracker={WATER} {...GAP} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(x => x.textContent)).toEqual(['Day', 'Day total', 'Entries', '7-day average'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Wed 16 Sept')).toBeTruthy()
    expect(within(rows[1]).getByText('1.5 L')).toBeTruthy()
    expect(within(rows[1]).getByText('2')).toBeTruthy()
    expect(within(rows[1]).getByText('1.8 L')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says the date, the summary and how many entries in the tooltip', async () => {
    const row = { day: DAYS[1], summary: 1.5, trend: 1.75, count: 2 }
    const tip = () => render(<LineTooltip tracker={WATER} active payload={[{ payload: row }] as never} />)
    const a = tip()
    expect(a.getByText('Wednesday 16 September')).toBeTruthy()
    expect(a.getByText('1.5 L')).toBeTruthy()
    expect(a.getByText('2 entries')).toBeTruthy()
    expect(a.getByText('1.8 L')).toBeTruthy()
    cleanup()
    const empty = render(<LineTooltip tracker={WATER} active payload={[{ payload: { ...row, summary: null, count: 0 } }] as never} />)
    expect(empty.getByText('No entries')).toBeTruthy()
    cleanup()
    await setLang('pt-BR')
    expect(tip().getByText('2 registros')).toBeTruthy()
  })
})
