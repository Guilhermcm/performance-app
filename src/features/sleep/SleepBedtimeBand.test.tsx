// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

// happy-dom has no layout: a fixed size for the chart, the rest of Recharts real.
vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 340, height: 208 })
}))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import SleepBedtimeBand, { BedtimeTooltip } from './SleepBedtimeBand'
import { SLEEP_CHART_CARD } from './SleepChartSkeleton'
import { setLang } from '../../lib/i18n.js'
import type { BedtimePoint } from './chart-data'

const TODAY = '2026-10-30'
const SERIES: BedtimePoint[] = [
  { night: '2026-10-17', dev: -60, clamped: null },
  { night: '2026-10-25', dev: -180, clamped: 'down' },
  { night: '2026-10-29', dev: 70, clamped: null },
  { night: TODAY, dev: 180, clamped: 'up' },
]
const props = { series: SERIES, today: TODAY, bedTarget: '23:00' }
const dot = (c: HTMLElement, night: string) => c.querySelector<SVGGElement>(`[data-slot="bedtime-dot"][data-night="${night}"]`)!

afterEach(async () => { cleanup(); await setLang('en') })

describe('SleepBedtimeBand', () => {
  it('describes the chart in text, in the card of its skeleton', () => {
    const { container } = render(<SleepBedtimeBand {...props} />)
    expect(screen.getByRole('heading', { name: 'Bedtime' })).toBeTruthy()
    expect(screen.getByText('Last 14 days: 4 nights logged, 0 within 45 min of the target')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[data-slot="sleep-bedtime-chart"]')!.className).toContain(SLEEP_CHART_CARD)
  })

  it('draws a dot per night, the band and the target line, and an arrow on a dot held at the edge', () => {
    const { container } = render(<SleepBedtimeBand {...props} />)
    expect(container.querySelectorAll('[data-slot="bedtime-dot"]')).toHaveLength(4)
    expect(container.querySelector('.bedtime-band')).toBeTruthy()
    expect(container.querySelector('.bedtime-target')).toBeTruthy()
    expect(dot(container, TODAY).querySelector('[data-arrow="up"]')).toBeTruthy()
    expect(dot(container, '2026-10-25').querySelector('[data-arrow="down"]')).toBeTruthy()
    expect(dot(container, '2026-10-29').querySelector('[data-arrow]')).toBeNull()
    // The dots are at least 8 px across.
    expect(Number(dot(container, '2026-10-29').querySelector('circle[data-mark]')!.getAttribute('r'))).toBeGreaterThanOrEqual(4)
    // Held at the edge: the arrows sit on the same line as the 3h ticks, later at the top.
    const cy = (night: string) => Number(dot(container, night).querySelector('circle[data-mark]')!.getAttribute('cy'))
    expect(cy(TODAY)).toBeLessThan(cy('2026-10-29'))
    expect(cy('2026-10-25')).toBeGreaterThan(cy('2026-10-17'))
  })

  it('labels the vertical axis with clock times around the target', () => {
    const { container } = render(<SleepBedtimeBand {...props} />)
    const labels = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')]
    expect(labels.map(n => n.textContent)).toEqual(['20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00'])
    // In the theme's text colour, not the data's.
    expect(labels.every(n => n.getAttribute('fill') === 'var(--muted-foreground)')).toBe(true)
  })

  it('shows the deviation in words as a table', async () => {
    render(<SleepBedtimeBand {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Compared to the target' })).toBeTruthy()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    expect(within(rows[2]).getByText('Thu 29 Oct')).toBeTruthy()
    expect(within(rows[2]).getByText('1h10 later')).toBeTruthy()
    expect(within(rows[0]).getByText('1h earlier')).toBeTruthy()
    expect(within(rows[3]).getByText('More than 3h later')).toBeTruthy()
    cleanup()
    await setLang('pt-BR')
    render(<SleepBedtimeBand {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }))
    expect(within(screen.getByRole('table')).getByText('1h10 depois')).toBeTruthy()
  })

  it('says the date and the deviation in the tooltip', () => {
    const tip = render(<BedtimeTooltip active payload={[{ payload: SERIES[2] }] as never} />)
    expect(tip.getByText('Thursday 29 October')).toBeTruthy()
    expect(tip.getByText('1h10 later')).toBeTruthy()
  })
})
