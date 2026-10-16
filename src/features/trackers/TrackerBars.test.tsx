// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

import TrackerBars from './TrackerBars'
import { TRACKER_CHART_CARD } from './TrackerChartSkeleton'
import { setLang } from '../../lib/i18n.js'

const ROWS = [
  { option: { id: 'ruim0001', text: 'ruim' }, count: 3 },
  { option: { id: 'ok000001', text: 'ok' }, count: 0 },
  { option: { id: 'bom00001', text: 'bom' }, count: 12 },
]

afterEach(async () => { cleanup(); await setLang('en') })

describe('TrackerBars', () => {
  it('draws one bar per option in the options order, the count in text, zeros included', () => {
    const { container } = render(<TrackerBars rows={ROWS} days={30} />)
    const bars = [...container.querySelectorAll<HTMLElement>('[data-slot="label-bar"]')]
    expect(bars.map(b => b.getAttribute('data-option'))).toEqual(['ruim0001', 'ok000001', 'bom00001'])
    expect(bars.map(b => within(b).getByTestId('bar-option').textContent)).toEqual(['ruim', 'ok', 'bom'])
    expect(bars.map(b => within(b).getByTestId('bar-count').textContent)).toEqual(['3', '0', '12'])
    // Bar length follows the count, the largest filling the track; a zero draws no bar at all.
    const width = (b: HTMLElement) => b.querySelector<HTMLElement>('[data-slot="bar-fill"]')?.style.width ?? null
    expect(width(bars[2])).toBe('100%')
    expect(width(bars[0])).toBe('25%')
    expect(width(bars[1])).toBeNull()
  })

  it('describes the period in text, in the card of its skeleton', () => {
    const { container } = render(<TrackerBars rows={ROWS} days={30} />)
    expect(screen.getByRole('heading', { name: 'Last 30 days' })).toBeTruthy()
    expect(screen.getByText('Most frequent: bom, 12 of 15 entries')).toBeTruthy()
    expect(container.querySelector<HTMLElement>('[data-slot="tracker-bars"]')!.className).toContain(TRACKER_CHART_CARD)
  })

  it('says there is nothing in the period, and still lists the options at zero', () => {
    const { container } = render(<TrackerBars rows={ROWS.map(r => ({ ...r, count: 0 }))} days={90} />)
    expect(screen.getByText('No entries in the last 90 days')).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="label-bar"]')).toHaveLength(3)
  })

  it('shows the option and the count as a table', async () => {
    await setLang('pt-BR')
    render(<TrackerBars rows={ROWS} days={30} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(x => x.textContent)).toEqual(['Opção', 'Registros'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(r => [...r.children].map(c => c.textContent))).toEqual([['ruim', '3'], ['ok', '0'], ['bom', '12']])
    fireEvent.click(screen.getByRole('button', { name: 'Ver como gráfico' }))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
