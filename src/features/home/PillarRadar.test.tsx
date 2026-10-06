// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'

// happy-dom has no layout, so ResponsiveContainer measures 0 and draws nothing: give the chart a
// fixed size and keep the rest of Recharts real.
vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 320, height: 248 })
}))
// Reduced motion: the shapes are drawn in place, without the grow-in animation.
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('../nutrition/NutritionSetup', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="nutrition-setup" /> : null)
}))

import PillarRadar, { radarDescription } from './PillarRadar'
import { setLang } from '../../lib/i18n.js'
import type { PillarKey, Progress } from '../gamification/types'

const RELEASED: PillarKey[] = ['strength', 'nutrition']
const ALL_ON = { strength: true, nutrition: true }
const RADAR: Progress['radar'] = {
  strength: { current: 0.82, previous: 0.7 },
  nutrition: { current: 0.64, previous: null }
}

const tick = (c: HTMLElement, p: PillarKey) => c.querySelector<HTMLElement>(`[data-slot="radar-tick"][data-pillar="${p}"]`)!
const centre = (c: HTMLElement) => {
  const ring = c.querySelector('.recharts-polar-grid-concentric-circle')!
  return [ring.getAttribute('cx'), ring.getAttribute('cy')]
}

afterEach(() => cleanup())

describe('PillarRadar', () => {
  it('describes the chart in text', async () => {
    expect(radarDescription(RADAR, ALL_ON, RELEASED)).toBe('Strength 82%, Nutrition 64%, Sleep coming soon, Habits coming soon')
    render(<PillarRadar radar={RADAR} enabled={ALL_ON} released={RELEASED} />)
    expect(screen.getByText('Strength 82%, Nutrition 64%, Sleep coming soon, Habits coming soon')).toBeTruthy()
    await setLang('pt-BR')
    try {
      expect(radarDescription(RADAR, ALL_ON, RELEASED)).toBe('Força 82%, Nutrição 64%, Sono em breve, Hábitos em breve')
    } finally {
      await setLang('en')
    }
  })

  it('marks a pillar that is off as locked and opens activation', () => {
    const enabled = { strength: true, nutrition: false }
    const { container } = render(<PillarRadar radar={RADAR} enabled={enabled} released={RELEASED} />)
    expect(tick(container, 'strength').dataset.state).toBe('on')
    expect(tick(container, 'nutrition').dataset.state).toBe('off')
    expect(tick(container, 'sleep').dataset.state).toBe('soon')
    expect(tick(container, 'nutrition').querySelector('[data-icon="lock"]')).toBeTruthy()
    // Off and coming soon axes are dashed; an active one is not.
    expect(tick(container, 'nutrition').querySelector('line')!.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(tick(container, 'sleep').querySelector('line')!.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(tick(container, 'strength').querySelector('line')!.getAttribute('stroke-dasharray')).toBeNull()
    expect(radarDescription(RADAR, enabled, RELEASED)).toBe('Strength 82%, Nutrition: off, Sleep coming soon, Habits coming soon')

    fireEvent.click(screen.getByRole('button', { name: 'Turn on Nutrition' }))
    expect(screen.getByTestId('nutrition-setup')).toBeTruthy()
    // The lock opens the activation only, not the detail sheet behind it.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a pillar without active weeks at the center with its state', () => {
    const radar = { strength: { current: null, previous: null }, nutrition: { current: 0.5, previous: 0.25 } }
    const { container } = render(<PillarRadar radar={radar} enabled={ALL_ON} released={RELEASED} />)
    expect(within(tick(container, 'strength')).getByText('No weeks yet')).toBeTruthy()
    const vertex = container.querySelector('[data-vertex="strength"]')!
    expect([vertex.getAttribute('cx'), vertex.getAttribute('cy')]).toEqual(centre(container))
    const other = container.querySelector('[data-vertex="nutrition"]')!
    expect([other.getAttribute('cx'), other.getAttribute('cy')]).not.toEqual(centre(container))
    expect(radarDescription(radar, ALL_ON, RELEASED)).toBe('Strength: no weeks yet, Nutrition 50%, Sleep coming soon, Habits coming soon')
  })

  it('draws the previous four weeks behind', () => {
    const { container } = render(<PillarRadar radar={RADAR} enabled={ALL_ON} released={RELEASED} />)
    const series = [...container.querySelectorAll('.recharts-radar')]
    expect(series).toHaveLength(2)
    // Earlier in the SVG is drawn first, so behind.
    expect(series[0].classList.contains('radar-previous')).toBe(true)
    expect(series[1].classList.contains('radar-current')).toBe(true)
    expect(series[0].querySelector('path')!.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('opens the detail sheet with both windows', () => {
    render(<PillarRadar radar={RADAR} enabled={ALL_ON} released={RELEASED} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pillar details' }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('columnheader', { name: 'Last 4 weeks' })).toBeTruthy()
    expect(within(sheet).getByRole('columnheader', { name: '4 weeks before' })).toBeTruthy()
    const row = (name: string) => within(sheet).getByRole('row', { name: new RegExp('^' + name) })
    expect(within(row('Strength')).getByText('82%')).toBeTruthy()
    expect(within(row('Strength')).getByText('70%')).toBeTruthy()
    expect(within(row('Nutrition')).getByText('64%')).toBeTruthy()
    expect(within(row('Nutrition')).getByText('No weeks yet')).toBeTruthy()
    expect(within(row('Sleep')).getAllByText('Coming soon')).toHaveLength(2)
  })

  it('renders an older cached progress without a radar', () => {
    const { container } = render(<PillarRadar radar={undefined} enabled={ALL_ON} released={RELEASED} />)
    expect(tick(container, 'strength').dataset.state).toBe('on')
    expect(within(tick(container, 'strength')).getByText('No weeks yet')).toBeTruthy()
  })
})
