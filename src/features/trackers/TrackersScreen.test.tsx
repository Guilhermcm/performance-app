// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
// The sheets have their own tests; here only what the screen hands them matters.
vi.mock('./TrackerSheet', () => ({
  default: ({ open, tracker }: { open: boolean; tracker?: { id: string } }) =>
    (open ? <div role="dialog" aria-label="tracker-sheet" data-tracker={tracker?.id ?? 'new'} /> : null)
}))
vi.mock('./EntrySheet', () => ({
  default: ({ open, tracker, mode }: { open: boolean; tracker: { id: string }; mode: string }) =>
    (open ? <div role="dialog" aria-label="entry-sheet" data-tracker={tracker.id} data-mode={mode} /> : null)
}))

import TrackersScreen from './TrackersScreen'
import { useTrackers } from './useTrackers'
import { useProfile } from '../profile/useProfile'
import { setLang } from '../../lib/i18n.js'
import { trackerOf, entryOf, T1, T2, ME } from './test-trackers'
import type { Profile } from '../profile/types'
import type { Tracker, TrackerEntry } from './types'

// Wednesday 2026-10-14 at 09:00 in Sao Paulo (UTC-3).
const TODAY = '2026-10-14'
const realProfile = useProfile.getState()
const realTrackers = useTrackers.getState()
const refresh = vi.fn(async () => {})
const move = vi.fn()
const dismissDropped = vi.fn()

const T3 = '00000000-0000-0000-0000-0000000000c3'
const T4 = '00000000-0000-0000-0000-0000000000c4'
const WATER = trackerOf({ id: T1, name: 'Água', icon: 'droplet', sort: 0 })
const WEIGHT = trackerOf({ id: T2, name: 'Peso', icon: 'heart', unit: 'kg', decimals: 1, aggregate: 'avg', sort: 1 })
const MOOD = trackerOf({
  id: T3, name: 'Humor', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 2,
  options: [{ id: 'ruim0001', text: 'ruim' }, { id: 'bom00001', text: 'bom' }]
})
const READING = trackerOf({ id: T4, name: 'Leitura', icon: 'book', kind: 'duration', unit: null, decimals: null, aggregate: 'sum', sort: 3 })
const OLD = trackerOf({ id: 'old', name: 'Antigo', icon: 'pen', sort: 4, archived_at: '2026-10-01T12:00:00.000Z' })
const ENTRIES: TrackerEntry[] = [
  entryOf('2026-10-12', { tracker_id: T2, value: 72.4 }),
  entryOf('2026-10-13', { tracker_id: T3, value: null, option: 'bom00001' }),
  entryOf(TODAY, { tracker_id: T1, value: 1.8 }),
]

const profile = () =>
  useProfile.setState({ status: 'ready', profile: { id: ME, timezone: 'America/Sao_Paulo' } as unknown as Profile })
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })
const store = (over: Partial<ReturnType<typeof useTrackers.getState>> = {}) =>
  useTrackers.setState({
    ...realTrackers, refresh, move, dismissDropped, userId: ME, status: 'ready', droppedNotice: null,
    trackers: [WATER, WEIGHT, MOOD, READING] as Tracker[], entries: ENTRIES, from: '2026-07-17', ...over
  })
const list = () => screen.getByRole('list', { name: /^(Your trackers|Seus trackers)$/ })
const rows = () => within(list()).getAllByRole('listitem')

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
  setOnline(true)
  localStorage.clear()
  ;[h.nav, h.toast, refresh, move, dismissDropped].forEach(f => f.mockReset())
  await setLang('pt-BR')
  profile()
  store()
})
afterEach(async () => {
  cleanup(); vi.useRealTimers(); setOnline(true)
  useProfile.setState(realProfile); useTrackers.setState(realTrackers)
  await setLang('en')
})

describe('TrackersScreen', () => {
  it('lists the active trackers in order with icon, name and the last value', () => {
    render(<TrackersScreen />)
    const items = rows()
    expect(items).toHaveLength(4)
    expect(items.map(li => within(li).getByTestId('tracker-name').textContent)).toEqual(['Água', 'Peso', 'Humor', 'Leitura'])
    expect(within(items[0]).getByText('1,8 L hoje')).toBeTruthy()
    expect(within(items[1]).getByText('72,4 kg há 2 dias')).toBeTruthy()
    expect(within(items[2]).getByText('bom ontem')).toBeTruthy()
    expect(items[0].querySelector('svg')).toBeTruthy()
  })

  it('says there is nothing in the window for a tracker without entries', () => {
    render(<TrackersScreen />)
    expect(within(rows()[3]).getByText('Nada nos últimos 90 dias')).toBeTruthy()
  })

  it('opens the quick entry of the tracker with the plus button', () => {
    render(<TrackersScreen />)
    fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Registrar em Peso' }))
    const sheet = screen.getByRole('dialog', { name: 'entry-sheet' })
    expect(sheet.getAttribute('data-tracker')).toBe(T2)
    expect(sheet.getAttribute('data-mode')).toBe('quick')
    expect(h.nav).not.toHaveBeenCalled()
  })

  it('opens the detail when the row is tapped', () => {
    render(<TrackersScreen />)
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /^Água/ }))
    expect(h.nav).toHaveBeenCalledWith(`/trackers/${T1}`)
  })

  it('reorders with arrows of at least 44 px, and the ends cannot go further', () => {
    render(<TrackersScreen />)
    const up = within(rows()[1]).getByRole('button', { name: 'Mover para cima' })
    const down = within(rows()[1]).getByRole('button', { name: 'Mover para baixo' })
    expect(up.className).toContain('size-11')
    expect(down.className).toContain('size-11')
    fireEvent.click(up)
    expect(move).toHaveBeenLastCalledWith(T2, -1)
    fireEvent.click(down)
    expect(move).toHaveBeenLastCalledWith(T2, 1)
    expect(within(rows()[0]).getByRole('button', { name: 'Mover para cima' }).hasAttribute('disabled')).toBe(true)
    expect(within(rows()[3]).getByRole('button', { name: 'Mover para baixo' }).hasAttribute('disabled')).toBe(true)
  })

  it('opens the creation sheet with New tracker', () => {
    render(<TrackersScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Novo tracker' }))
    expect(screen.getByRole('dialog', { name: 'tracker-sheet' }).getAttribute('data-tracker')).toBe('new')
  })

  it('invites to create the first tracker when there is none', () => {
    store({ trackers: [], entries: [] })
    render(<TrackersScreen />)
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Crie seu primeiro tracker' }))
    expect(screen.getByRole('dialog', { name: 'tracker-sheet' }).getAttribute('data-tracker')).toBe('new')
  })

  it('shows a skeleton while the first load runs', () => {
    store({ status: 'loading', trackers: [], entries: [] })
    render(<TrackersScreen />)
    expect(screen.getByTestId('trackers-skeleton').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('offers a retry when the first pull failed with nothing saved', () => {
    store({ status: 'error', trackers: [], entries: [] })
    render(<TrackersScreen />)
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Não foi possível carregar seus trackers.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Crie seu primeiro tracker' })).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the saved copy offline and keeps the plus button', () => {
    setOnline(false)
    render(<TrackersScreen />)
    expect(screen.getByText(/^Sem conexão/)).toBeTruthy()
    expect(within(rows()[0]).getByText('1,8 L hoje')).toBeTruthy()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Registrar em Água' }))
    expect(screen.getByRole('dialog', { name: 'entry-sheet' })).toBeTruthy()
  })

  it('keeps the archived trackers collapsed with their count, and reactivates through the sheet', () => {
    store({ trackers: [WATER, OLD, { ...OLD, id: 'old2', name: 'Outro', sort: 5 }] })
    render(<TrackersScreen />)
    const region = screen.getByRole('region', { name: 'Arquivados' })
    const toggle = within(region).getByRole('button', { name: /Arquivados/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(toggle).getByText('2')).toBeTruthy()
    expect(within(region).queryByText('Antigo')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // No quick entry for an archived tracker: the server refuses new entries there.
    expect(within(region).queryByRole('button', { name: /Registrar em/ })).toBeNull()
    fireEvent.click(within(region).getByRole('button', { name: /Antigo/ }))
    expect(screen.getByRole('dialog', { name: 'tracker-sheet' }).getAttribute('data-tracker')).toBe('old')
    expect(h.nav).not.toHaveBeenCalled()
  })

  it('shows the archived section even when no tracker is active', () => {
    store({ trackers: [OLD], entries: [] })
    render(<TrackersScreen />)
    expect(screen.getByRole('button', { name: 'Crie seu primeiro tracker' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Arquivados' })).toBeTruthy()
  })

  it('says once that the queue dropped entries, then forgets it', () => {
    store({ droppedNotice: 'Algumas mudanças nos trackers não puderam ser salvas.' })
    render(<TrackersScreen />)
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith('Algumas mudanças nos trackers não puderam ser salvas.')
    expect(dismissDropped).toHaveBeenCalledTimes(1)
  })

  it('says nothing when no entries were dropped', () => {
    render(<TrackersScreen />)
    expect(h.toast).not.toHaveBeenCalled()
    expect(dismissDropped).not.toHaveBeenCalled()
  })
})
