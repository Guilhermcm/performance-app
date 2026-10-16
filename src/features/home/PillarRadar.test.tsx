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
vi.mock('../sleep/SleepSetup', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="sleep-setup" /> : null)
}))
vi.mock('../habits/HabitsSetup', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="habits-setup" /> : null)
}))
const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))

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

const RELEASED_SLEEP: PillarKey[] = ['strength', 'nutrition', 'sleep']
const SLEEP_ON = { strength: true, nutrition: true, sleep: true }
const RADAR_SLEEP: Progress['radar'] = { ...RADAR, sleep: { current: 0.5, previous: 0.25 } }

const RELEASED_HABITS: PillarKey[] = ['strength', 'nutrition', 'sleep', 'habits']
const HABITS_ON = { strength: true, nutrition: true, sleep: true, habits: true }
const RADAR_HABITS: Progress['radar'] = { ...RADAR_SLEEP, habits: { current: 0.4, previous: 0.3 } }

afterEach(() => { cleanup(); h.nav.mockClear() })

describe('PillarRadar', () => {
  it('describes the chart in text', async () => {
    expect(radarDescription(RADAR, ALL_ON, RELEASED)).toBe('Training 82%, Nutrition 64%, Sleep coming soon, Habits coming soon')
    render(<PillarRadar radar={RADAR} enabled={ALL_ON} released={RELEASED} />)
    expect(screen.getByText('Training 82%, Nutrition 64%, Sleep coming soon, Habits coming soon')).toBeTruthy()
    await setLang('pt-BR')
    try {
      expect(radarDescription(RADAR, ALL_ON, RELEASED)).toBe('Treino 82%, Nutrição 64%, Sono em breve, Hábitos em breve')
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
    expect(radarDescription(RADAR, enabled, RELEASED)).toBe('Training 82%, Nutrition: off, Sleep coming soon, Habits coming soon')

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
    expect(radarDescription(radar, ALL_ON, RELEASED)).toBe('Training: no weeks yet, Nutrition 50%, Sleep coming soon, Habits coming soon')
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
    expect(within(row('Training')).getByText('82%')).toBeTruthy()
    expect(within(row('Training')).getByText('70%')).toBeTruthy()
    expect(within(row('Nutrition')).getByText('64%')).toBeTruthy()
    expect(within(row('Nutrition')).getByText('No weeks yet')).toBeTruthy()
    expect(within(row('Sleep')).getAllByText('Coming soon')).toHaveLength(2)
  })

  it('renders an older cached progress without a radar', () => {
    const { container } = render(<PillarRadar radar={undefined} enabled={ALL_ON} released={RELEASED} />)
    expect(tick(container, 'strength').dataset.state).toBe('on')
    expect(within(tick(container, 'strength')).getByText('No weeks yet')).toBeTruthy()
  })

  describe('with sleep released', () => {
    it('describes the sleep axis in text', async () => {
      expect(radarDescription(RADAR_SLEEP, SLEEP_ON, RELEASED_SLEEP)).toBe('Training 82%, Nutrition 64%, Sleep 50%, Habits coming soon')
      await setLang('pt-BR')
      try {
        expect(radarDescription(RADAR_SLEEP, SLEEP_ON, RELEASED_SLEEP)).toBe('Treino 82%, Nutrição 64%, Sono 50%, Hábitos em breve')
      } finally {
        await setLang('en')
      }
    })

    it('locks sleep while it is off and opens its activation', () => {
      const enabled = { strength: true, nutrition: true, sleep: false }
      const { container } = render(<PillarRadar radar={RADAR_SLEEP} enabled={enabled} released={RELEASED_SLEEP} />)
      expect(tick(container, 'sleep').dataset.state).toBe('off')
      expect(tick(container, 'sleep').querySelector('[data-icon="lock"]')).toBeTruthy()
      expect(radarDescription(RADAR_SLEEP, enabled, RELEASED_SLEEP)).toBe('Training 82%, Nutrition 64%, Sleep: off, Habits coming soon')
      fireEvent.click(screen.getByRole('button', { name: 'Turn on Sleep' }))
      expect(screen.getByTestId('sleep-setup')).toBeTruthy()
      expect(screen.queryByTestId('nutrition-setup')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('turns on each pillar from the detail sheet', () => {
      render(<PillarRadar radar={RADAR_SLEEP} enabled={{ strength: true, nutrition: false, sleep: false }} released={RELEASED_SLEEP} />)
      fireEvent.click(screen.getByRole('button', { name: 'Pillar details' }))
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn on Sleep' }))
      expect(screen.getByTestId('sleep-setup')).toBeTruthy()
      expect(screen.queryByTestId('nutrition-setup')).toBeNull()
    })

    it('shows sleep without active weeks at the center with its state', () => {
      const radar = { ...RADAR, sleep: { current: null, previous: null } }
      const { container } = render(<PillarRadar radar={radar} enabled={SLEEP_ON} released={RELEASED_SLEEP} />)
      expect(tick(container, 'sleep').dataset.state).toBe('on')
      expect(within(tick(container, 'sleep')).getByText('No weeks yet')).toBeTruthy()
      const vertex = container.querySelector('[data-vertex="sleep"]')!
      expect([vertex.getAttribute('cx'), vertex.getAttribute('cy')]).toEqual(centre(container))
      expect(radarDescription(radar, SLEEP_ON, RELEASED_SLEEP)).toBe('Training 82%, Nutrition 64%, Sleep: no weeks yet, Habits coming soon')
    })

    it('opens the sleep screen from the axis label and from the detail sheet', () => {
      const { container } = render(<PillarRadar radar={RADAR_SLEEP} enabled={SLEEP_ON} released={RELEASED_SLEEP} />)
      const open = within(tick(container, 'sleep')).getByRole('button', { name: 'Open Sleep' })
      expect(within(open).getByText('50%')).toBeTruthy()
      fireEvent.click(open)
      expect(h.nav).toHaveBeenCalledWith('/sono')
      // The label goes to the screen only, not to the detail sheet behind it.
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Pillar details' }))
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open Sleep' }))
      expect(h.nav).toHaveBeenCalledTimes(2)
      expect(h.nav).toHaveBeenLastCalledWith('/sono')
    })

    it('reads a cached radar without sleep', () => {
      const { container } = render(<PillarRadar radar={RADAR} enabled={SLEEP_ON} released={RELEASED_SLEEP} />)
      expect(tick(container, 'sleep').dataset.state).toBe('on')
      expect(within(tick(container, 'sleep')).getByText('No weeks yet')).toBeTruthy()
      expect(radarDescription(RADAR, SLEEP_ON, RELEASED_SLEEP)).toBe('Training 82%, Nutrition 64%, Sleep: no weeks yet, Habits coming soon')
    })
  })

  describe('with habits released', () => {
    it('describes the habits axis in text, with nothing coming soon', async () => {
      expect(radarDescription(RADAR_HABITS, HABITS_ON, RELEASED_HABITS)).toBe('Training 82%, Nutrition 64%, Sleep 50%, Habits 40%')
      render(<PillarRadar radar={RADAR_HABITS} enabled={HABITS_ON} released={RELEASED_HABITS} />)
      expect(screen.getByText('Training 82%, Nutrition 64%, Sleep 50%, Habits 40%')).toBeTruthy()
      expect(screen.queryByText(/coming soon/i)).toBeNull()
      await setLang('pt-BR')
      try {
        expect(radarDescription(RADAR_HABITS, HABITS_ON, RELEASED_HABITS)).toBe('Treino 82%, Nutrição 64%, Sono 50%, Hábitos 40%')
      } finally {
        await setLang('en')
      }
    })

    it('locks habits while it is off and opens its activation', () => {
      const enabled = { ...HABITS_ON, habits: false }
      const { container } = render(<PillarRadar radar={RADAR_HABITS} enabled={enabled} released={RELEASED_HABITS} />)
      expect(tick(container, 'habits').dataset.state).toBe('off')
      expect(tick(container, 'habits').querySelector('[data-icon="lock"]')).toBeTruthy()
      expect(tick(container, 'habits').querySelector('line')!.getAttribute('stroke-dasharray')).toBeTruthy()
      expect(radarDescription(RADAR_HABITS, enabled, RELEASED_HABITS)).toBe('Training 82%, Nutrition 64%, Sleep 50%, Habits: off')
      fireEvent.click(screen.getByRole('button', { name: 'Turn on Habits' }))
      expect(screen.getByTestId('habits-setup')).toBeTruthy()
      expect(screen.queryByTestId('sleep-setup')).toBeNull()
      expect(screen.queryByTestId('nutrition-setup')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('turns habits on from the detail sheet', () => {
      render(<PillarRadar radar={RADAR_HABITS} enabled={{ ...HABITS_ON, habits: false }} released={RELEASED_HABITS} />)
      fireEvent.click(screen.getByRole('button', { name: 'Pillar details' }))
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn on Habits' }))
      expect(screen.getByTestId('habits-setup')).toBeTruthy()
    })

    it('shows habits without active weeks at the center with its state', () => {
      const radar = { ...RADAR_SLEEP, habits: { current: null, previous: null } }
      const { container } = render(<PillarRadar radar={radar} enabled={HABITS_ON} released={RELEASED_HABITS} />)
      expect(tick(container, 'habits').dataset.state).toBe('on')
      expect(within(tick(container, 'habits')).getByText('No weeks yet')).toBeTruthy()
      const vertex = container.querySelector('[data-vertex="habits"]')!
      expect([vertex.getAttribute('cx'), vertex.getAttribute('cy')]).toEqual(centre(container))
      expect(radarDescription(radar, HABITS_ON, RELEASED_HABITS)).toBe('Training 82%, Nutrition 64%, Sleep 50%, Habits: no weeks yet')
    })

    it('opens the habits screen from the axis label and from the detail sheet', () => {
      const { container } = render(<PillarRadar radar={RADAR_HABITS} enabled={HABITS_ON} released={RELEASED_HABITS} />)
      const open = within(tick(container, 'habits')).getByRole('button', { name: 'Open Habits' })
      expect(within(open).getByText('40%')).toBeTruthy()
      fireEvent.click(open)
      expect(h.nav).toHaveBeenCalledWith('/habitos')
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Pillar details' }))
      const sheet = screen.getByRole('dialog')
      expect(within(within(sheet).getByRole('row', { name: /^Habits/ })).getByText('30%')).toBeTruthy()
      fireEvent.click(within(sheet).getByRole('button', { name: 'Open Habits' }))
      expect(h.nav).toHaveBeenCalledTimes(2)
      expect(h.nav).toHaveBeenLastCalledWith('/habitos')
    })

    it('reads a cached radar without habits', () => {
      const { container } = render(<PillarRadar radar={RADAR_SLEEP} enabled={HABITS_ON} released={RELEASED_HABITS} />)
      expect(tick(container, 'habits').dataset.state).toBe('on')
      expect(within(tick(container, 'habits')).getByText('No weeks yet')).toBeTruthy()
      expect(radarDescription(RADAR_SLEEP, HABITS_ON, RELEASED_HABITS)).toBe('Training 82%, Nutrition 64%, Sleep 50%, Habits: no weeks yet')
    })
  })
})
