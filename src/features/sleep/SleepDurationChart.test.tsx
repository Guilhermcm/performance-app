// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

// happy-dom has no layout, so ResponsiveContainer measures 0 and draws nothing: give the chart a
// fixed size and keep the rest of Recharts real (as in PillarRadar.test.tsx).
vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 340, height: 208 })
}))
// Reduced motion: the bars are drawn in place, without the grow-in animation.
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import SleepDurationChart, { DurationTooltip } from './SleepDurationChart'
import { SLEEP_CHART_CARD } from './SleepChartSkeleton'
import { shiftDay } from '../nutrition/days'
import { setLang } from '../../lib/i18n.js'
import type { DurationPoint } from './chart-data'

const TODAY = '2026-10-30'
// Nights on the 1st (on target), the 2nd (off target) and the 3rd (no goal in force); the rest empty.
const SERIES: DurationPoint[] = Array.from({ length: 30 }, (_, i) => {
  const night = shiftDay(TODAY, i - 29)
  if (i === 0) return { night, duration: 470, goal: 480, onTarget: true }
  if (i === 1) return { night, duration: 400, goal: 480, onTarget: false }
  if (i === 2) return { night, duration: 445, goal: null, onTarget: false }
  if (i === 29) return { night, duration: 485, goal: 480, onTarget: true }
  return { night, duration: null, goal: 480, onTarget: false }
})

afterEach(async () => { cleanup(); await setLang('en') })

describe('SleepDurationChart', () => {
  it('describes the chart in text, in the card of its skeleton', () => {
    const { container } = render(<SleepDurationChart series={SERIES} />)
    expect(screen.getByRole('heading', { name: 'Sleep duration' })).toBeTruthy()
    expect(screen.getByText('Average of 7h 30 over the last 30 days, 2 nights on target')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[data-slot="sleep-duration-chart"]')!.className).toContain(SLEEP_CHART_CARD)
  })

  it('draws a check on top of each bar on target, and no bar for an empty night', () => {
    const { container } = render(<SleepDurationChart series={SERIES} />)
    const bars = container.querySelectorAll('[data-slot="duration-bar"]')
    expect(bars).toHaveLength(4)
    const checks = container.querySelectorAll('[data-slot="bar-check"]')
    expect(checks).toHaveLength(2)
    expect([...checks].map(c => c.closest('[data-slot="duration-bar"]')!.getAttribute('data-night'))).toEqual(['2026-10-01', TODAY])
    // The on target bars wear the pillar colour, the others the neutral one.
    const fill = (night: string) => container.querySelector(`[data-slot="duration-bar"][data-night="${night}"] path`)!.getAttribute('fill')
    expect(fill('2026-10-01')).toBe('var(--color-sleep)')
    expect(fill('2026-10-02')).toBe('var(--color-other)')
    // The goal line.
    expect(container.querySelector('.duration-goal path')).toBeTruthy()
  })

  it('shows a row per night as a table: date, duration and state', () => {
    render(<SleepDurationChart series={SERIES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Date' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'Duration' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(30)
    expect(within(rows[0]).getByText('Thu 1 Oct')).toBeTruthy()
    expect(within(rows[0]).getByText('7h 50')).toBeTruthy()
    expect(within(rows[0]).getByText('On target')).toBeTruthy()
    expect(within(rows[1]).getByText('6h 40')).toBeTruthy()
    expect(within(rows[1]).getByText('Off target')).toBeTruthy()
    expect(within(rows[2]).getByText('Logged')).toBeTruthy()
    expect(within(rows[3]).getByText('Not logged')).toBeTruthy()
    // And back to the chart.
    fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says "Not logged" in the tooltip of an empty night, and the duration and state of a logged one', async () => {
    const tip = (p: DurationPoint) => render(<DurationTooltip active payload={[{ payload: p }] as never} />)
    const empty = tip(SERIES[3])
    expect(empty.getByText('Sunday 4 October')).toBeTruthy()
    expect(empty.getByText('Not logged')).toBeTruthy()
    cleanup()
    const on = tip(SERIES[0])
    expect(on.getByText('7h 50')).toBeTruthy()
    expect(on.getByText('On target')).toBeTruthy()
    cleanup()
    await setLang('pt-BR')
    expect(tip(SERIES[3]).getByText('Sem registro')).toBeTruthy()
  })
})
