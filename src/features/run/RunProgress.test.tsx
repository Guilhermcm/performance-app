// @vitest-environment happy-dom
// The weekly minutes chart of /plan/corrida (spec §8.1): bars of the minutes run per week with the
// planned minutes as the reference, a description in text and "Show as table".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

// happy-dom has no layout, so ResponsiveContainer measures 0 and draws nothing: give the chart a
// fixed size and keep the rest of Recharts real (as in SleepDurationChart.test.tsx).
vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 340, height: 184 })
}))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))

import RunProgress, { WeekTooltip, volumeDescription } from './RunProgress'
import { RUN_CHART_CARD } from './RunProgressSkeleton'
import { setLang } from '../../lib/i18n.js'

// Six weeks: 180 minutes planned, 150 run; week 3 had no run.
const SERIES = [
  { index: 1, planned: 30, done: 30 },
  { index: 2, planned: 30, done: 25 },
  { index: 3, planned: 30, done: 0 },
  { index: 4, planned: 30, done: 35 },
  { index: 5, planned: 30, done: 30 },
  { index: 6, planned: 30, done: 30 },
]

afterEach(async () => { cleanup(); await setLang('en') })

describe('volumeDescription', () => {
  it('sums the minutes run against the planned ones, in words', () => {
    expect(volumeDescription(SERIES)).toBe('Over the last 6 weeks you ran 150 of 180 planned minutes')
    expect(volumeDescription(SERIES.slice(0, 1))).toBe('This week you ran 30 of 30 planned minutes')
  })

  it('without a minute run says where the bars will come from (review focus 5)', () => {
    const empty = 'You haven’t logged a run in this plan yet. The bars show your minutes each week against the plan.'
    expect(volumeDescription([])).toBe(empty)
    expect(volumeDescription([{ index: 1, planned: 90, done: 0 }])).toBe(empty)
  })

  it('in pt-BR', async () => {
    await setLang('pt-BR')
    expect(volumeDescription(SERIES)).toBe('Nas últimas 6 semanas você correu 150 de 180 minutos planejados')
  })
})

describe('RunProgress', () => {
  it('describes the chart in text, in the card of its skeleton, with a bar per week run', () => {
    const { container } = render(<RunProgress series={SERIES} />)
    expect(screen.getByRole('heading', { name: 'Minutes per week' })).toBeTruthy()
    expect(screen.getByText('Over the last 6 weeks you ran 150 of 180 planned minutes')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[data-slot="run-progress"]')!.className).toContain(RUN_CHART_CARD)
    // A week without a run draws no bar; the bars wear the chart colour.
    const bars = container.querySelectorAll('[data-slot="week-bar"]')
    expect([...bars].map(b => b.getAttribute('data-week'))).toEqual(['1', '2', '4', '5', '6'])
    expect(bars[0].querySelector('path')!.getAttribute('fill')).toBe('var(--color-done)')
    // The planned minutes as a line, and a legend that names both.
    expect(container.querySelector('.run-planned path')).toBeTruthy()
    expect(screen.getByText('Minutes run')).toBeTruthy()
    expect(screen.getByText('Planned')).toBeTruthy()
  })

  it('shows a row per week as a table: week, planned and done', () => {
    render(<RunProgress series={SERIES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Week', 'Planned (min)', 'Done (min)'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(6)
    expect(rows[1].textContent).toBe('Week 23025')
    expect(rows[2].textContent).toBe('Week 3300')
    fireEvent.click(screen.getByRole('button', { name: 'Show as chart' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('in pt-BR: "Ver como tabela" and the columns semana, planejado and feito', async () => {
    await setLang('pt-BR')
    render(<RunProgress series={SERIES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }))
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map(h => h.textContent))
      .toEqual(['Semana', 'Planejado (min)', 'Feito (min)'])
  })

  it('with nothing run yet still draws the planned line and says so in text', () => {
    const { container } = render(<RunProgress series={[{ index: 1, planned: 90, done: 0 }]} />)
    expect(screen.getByText(/You haven’t logged a run in this plan yet/)).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="week-bar"]')).toHaveLength(0)
  })

  it('the tooltip gives the week and its minutes against the plan', () => {
    render(<WeekTooltip active payload={[{ payload: SERIES[1] }]} />)
    expect(screen.getByText('Week 2')).toBeTruthy()
    expect(screen.getByText('25 of 30 min')).toBeTruthy()
  })
})
