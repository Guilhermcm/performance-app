// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// The charts load for real (on demand); Recharts gets a fixed size since happy-dom has no layout.
vi.mock('recharts', async orig => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 340, height: 208 })
}))
vi.mock('motion/react', async orig => ({ ...(await orig<typeof import('motion/react')>()), useReducedMotion: () => true }))
const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('sonner', () => ({ toast: h.toast }))
// The sheets have their own tests; here only what the screen hands them matters.
vi.mock('./TrackerSheet', () => ({
  default: ({ open, tracker }: { open: boolean; tracker?: { id: string } }) =>
    (open ? <div role="dialog" aria-label="tracker-sheet" data-tracker={tracker?.id ?? 'new'} /> : null)
}))
vi.mock('./EntrySheet', () => ({
  default: ({ open, tracker, entry, mode }: { open: boolean; tracker: { id: string }; entry?: { id: string }; mode: string }) =>
    (open ? <div role="dialog" aria-label="entry-sheet" data-tracker={tracker.id} data-entry={entry?.id ?? 'new'} data-mode={mode} /> : null)
}))

import TrackerDetail from './TrackerDetail'
import appSource from '../../App.jsx?raw'
import { useTrackers } from './useTrackers'
import { useProfile } from '../profile/useProfile'
import { shiftDay } from '../nutrition/days'
import { setLang } from '../../lib/i18n.js'
import { trackerOf, entryOf, T1, T2, ME } from './test-trackers'
import type { Profile } from '../profile/types'
import type { Tracker, TrackerEntry } from './types'

// Wednesday 2026-10-14 at 09:00 in Sao Paulo (UTC-3).
const TODAY = '2026-10-14'
const realProfile = useProfile.getState()
const realTrackers = useTrackers.getState()

const WATER = trackerOf({ id: T1, name: 'Água', icon: 'droplet' })
const MOOD = trackerOf({
  id: T2, name: 'Humor', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 1,
  options: [{ id: 'ruim0001', text: 'ruim' }, { id: 'bom00001', text: 'bom' }]
})
const back = (n: number) => shiftDay(TODAY, -n)

// 24 days with water in the last 30: 1,5 L on the even days back, 1,0 + 1,3 L on the odd ones
// (average 1,9 L, lowest 1,5, highest 2,3), and one more day 40 days back.
const WATER_ENTRIES: TrackerEntry[] = [
  entryOf(back(40), { id: 'w-old', value: 2 }),
  ...Array.from({ length: 24 }, (_, i) => (i % 2 === 0
    ? [entryOf(back(i), { id: `w${i}`, value: 1.5, note: i === 0 ? 'depois do treino' : null })]
    : [entryOf(back(i), { id: `w${i}a`, at: '08:00', value: 1 }), entryOf(back(i), { id: `w${i}b`, at: '20:00', value: 1.3 })])).flat(),
]
// 20 moods over the last 15 days: 12 bom, 8 ruim.
const MOOD_ENTRIES: TrackerEntry[] = Array.from({ length: 20 }, (_, i) =>
  entryOf(back(i % 15), { id: `m${i}`, tracker_id: T2, value: null, option: i < 12 ? 'bom00001' : 'ruim0001', at: `1${i % 10}:00` }))

const store = (over: Partial<ReturnType<typeof useTrackers.getState>> = {}) =>
  useTrackers.setState({
    ...realTrackers, userId: ME, status: 'ready', droppedNotice: null,
    trackers: [WATER, MOOD] as Tracker[], entries: [...WATER_ENTRIES, ...MOOD_ENTRIES], from: back(89), ...over
  })

const open = (id: string) => render(
  <MemoryRouter initialEntries={[`/trackers/${id}`]}>
    <Routes>
      <Route path="/trackers" element={<p>LIST</p>} />
      <Route path="/trackers/:id" element={<TrackerDetail />} />
    </Routes>
  </MemoryRouter>
)
const stat = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling!.textContent
const entries = () => screen.getByRole('region', { name: 'Registros' })

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
  localStorage.clear()
  h.toast.mockReset()
  await setLang('pt-BR')
  useProfile.setState({ status: 'ready', profile: { id: ME, timezone: 'America/Sao_Paulo' } as unknown as Profile })
  store()
})
afterEach(async () => {
  cleanup(); vi.useRealTimers()
  useProfile.setState(realProfile); useTrackers.setState(realTrackers)
  await setLang('en')
})

describe('TrackerDetail', () => {
  it('shows the tracker with 30 days by default, the description and the stats', async () => {
    open(T1)
    expect(screen.getByRole('heading', { level: 1, name: 'Água' })).toBeTruthy()
    const thirty = screen.getByRole('button', { name: '30 dias' })
    expect(thirty.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '90 dias' }).getAttribute('aria-pressed')).toBe('false')
    expect(await screen.findByText('Média de 1,9 L nos últimos 30 dias, 24 dias com registro')).toBeTruthy()
    expect(stat('Média')).toBe('1,9 L')
    expect(stat('Mínimo')).toBe('1,5 L')
    expect(stat('Máximo')).toBe('2,3 L')
    expect(stat('Dias com registro')).toBe('24')
    expect(screen.getByText('Último: hoje')).toBeTruthy()
  })

  it('switches to 90 days', async () => {
    open(T1)
    fireEvent.click(screen.getByRole('button', { name: '90 dias' }))
    expect(screen.getByRole('button', { name: '90 dias' }).getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByText('Média de 1,9 L nos últimos 90 dias, 25 dias com registro')).toBeTruthy()
    expect(stat('Dias com registro')).toBe('25')
    expect(within(entries()).getByText('2,0 L')).toBeTruthy()
  })

  it('lists the entries of the period by day, newest first, with time, value and note', () => {
    open(T1)
    const days = within(entries()).getAllByRole('heading', { level: 3 })
    expect(days).toHaveLength(24)
    const items = within(entries()).getAllByRole('button')
    expect(items).toHaveLength(36)
    expect(items[0].textContent).toContain('09:00')
    expect(items[0].textContent).toContain('1,5 L')
    expect(items[0].textContent).toContain('depois do treino')
    // Yesterday: the evening entry first.
    expect(items[1].textContent).toContain('20:00')
    expect(items[1].textContent).toContain('1,3 L')
    expect(items[2].textContent).toContain('08:00')
    // The entry 40 days back is outside the 30 days.
    expect(within(entries()).queryByText('2,0 L')).toBeNull()
  })

  it('opens the full entry sheet to edit an entry', () => {
    open(T1)
    fireEvent.click(within(entries()).getAllByRole('button')[1])
    const sheet = screen.getByRole('dialog', { name: 'entry-sheet' })
    expect(sheet.getAttribute('data-entry')).toBe('w1b')
    expect(sheet.getAttribute('data-mode')).toBe('full')
  })

  it('logs with the plus button and edits the tracker', () => {
    open(T1)
    fireEvent.click(screen.getByRole('button', { name: 'Registrar em Água' }))
    const sheet = screen.getByRole('dialog', { name: 'entry-sheet' })
    expect(sheet.getAttribute('data-entry')).toBe('new')
    expect(sheet.getAttribute('data-mode')).toBe('quick')
    fireEvent.click(screen.getByRole('button', { name: 'Editar tracker' }))
    expect(screen.getByRole('dialog', { name: 'tracker-sheet' }).getAttribute('data-tracker')).toBe(T1)
  })

  it('shows the chart as a table: day, summary and how many entries', async () => {
    open(T1)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver como tabela' }))
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(x => x.textContent).slice(0, 3)).toEqual(['Dia', 'Total do dia', 'Registros'])
    expect(within(table).getAllByRole('row')).toHaveLength(25)
  })

  it('shows the most frequent option, the bars and only the day stats for a label tracker', async () => {
    open(T2)
    expect(await screen.findByText('Mais frequente: bom, 12 de 20 registros')).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="label-bar"]')).toHaveLength(2)
    expect(stat('Dias com registro')).toBe('15')
    expect(screen.queryByText('Média', { selector: 'dt' })).toBeNull()
    expect(within(entries()).getAllByText('bom').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }))
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').map(x => x.textContent)).toEqual(['Opção', 'Registros'])
  })

  it('says an unknown tracker no longer exists, with a link to the list', () => {
    open('nope')
    expect(screen.getByText('Esse tracker não existe mais')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Ver seus trackers' })
    expect(link.getAttribute('href')).toBe('/trackers')
    fireEvent.click(link)
    expect(screen.getByText('LIST')).toBeTruthy()
  })

  it('goes back to the list when opened directly', () => {
    open(T1)
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByText('LIST')).toBeTruthy()
  })

  it('shows a skeleton while the first load runs, never the missing tracker', () => {
    store({ status: 'loading', trackers: [], entries: [] })
    open(T1)
    expect(screen.getByTestId('tracker-detail-skeleton').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText('Esse tracker não existe mais')).toBeNull()
  })

  it('says an archived tracker is archived, offers to reactivate it and keeps its entries editable, never a new entry', async () => {
    store({ trackers: [{ ...WATER, archived_at: '2026-10-10T12:00:00.000Z' }, MOOD] })
    open(T1)
    expect(screen.getByText('Arquivado. Você ainda pode editar e apagar os registros.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Registrar em Água' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar tracker' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reativar' }))
    expect(screen.getByRole('dialog', { name: 'tracker-sheet' }).getAttribute('data-tracker')).toBe(T1)
    expect(await screen.findByText('Média de 1,9 L nos últimos 30 dias, 24 dias com registro')).toBeTruthy()
    expect(stat('Média')).toBe('1,9 L')
    fireEvent.click(within(entries()).getAllByRole('button')[0])
    const sheet = screen.getByRole('dialog', { name: 'entry-sheet' })
    expect(sheet.getAttribute('data-entry')).toBe('w0')
    expect(sheet.getAttribute('data-mode')).toBe('full')
  })

  it('says once that the queue dropped entries, in the language of the moment, then forgets it', async () => {
    store({ droppedNotice: 'tracker_archived' })
    open(T1)
    expect(h.toast).toHaveBeenCalledTimes(1)
    expect(h.toast).toHaveBeenCalledWith('Alguns registros de trackers arquivados não foram salvos.')
    expect(useTrackers.getState().droppedNotice).toBeNull()
  })

  it('waits for the detail chunk on the detail skeleton (App.jsx)', () => {
    expect(appSource).toMatch(/path="\/trackers\/:id" element=\{<Suspense fallback=\{<TrackerDetailSkeleton \/>\}><TrackerDetail \/><\/Suspense>\}/)
  })
})
