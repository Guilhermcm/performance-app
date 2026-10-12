// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { exerciseNameFor, setLang, t } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { REFS } from './references'
import { RANGES } from './goal'
import { estimateMinutes } from './time'
import AnalysisScreen from './AnalysisScreen'

const h = vi.hoisted(() => ({ nav: vi.fn(), toast: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('../../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))
const goal = (g: string | null) =>
  useProfile.setState({ profile: { id: 'u1', goal: g, level: 'intermediate', days_per_week: 3 } as never })
const name = (id: string) => exerciseNameFor((EXIDX as Record<string, unknown>)[id])

// A push day on Monday: chest 6 sets (low, one day), back and legs at 0 (missing), far more push
// than pull.
const PUSH = { id: 'push', name: 'Push', emoji: 'star', ex: [{ id: '0025', sets: 3 }, { id: '1278', sets: 3 }] }
const pushDay = (extra: AnyState = {}) => setS({ routines: [structuredClone(PUSH)], week: { 1: ['push'] }, customEx: [], program: undefined, ...extra })

const region = (n: string | RegExp) => screen.getByRole('region', { name: n })
const endSheetAnimation = () => {
  for (const slot of ['drawer-content', 'drawer-overlay']) {
    const el = document.querySelector(`[data-slot="${slot}"]`)
    if (el) fireEvent.animationEnd(el)
  }
}
const chestAlert = () => screen.getByRole('article', { name: 'Chest below ideal' })
const openChestApply = () => {
  const apply = within(chestAlert()).getByRole('button', { name: /^Apply/ })
  apply.focus()
  fireEvent.click(apply)
  return { apply, dialog: screen.getByRole('dialog') }
}

beforeEach(() => {
  h.nav.mockClear(); h.toast.mockClear()
  goal('hypertrophy')
  pushDay()
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
})
afterEach(async () => { cleanup(); useProfile.setState({ profile: null }); await setLang('en') })

describe('AnalysisScreen: profile', () => {
  it('shows the goal on top and no invitation when there is one', () => {
    render(<AnalysisScreen />)
    expect(screen.getByRole('heading', { level: 1, name: 'Plan analysis' })).toBeTruthy()
    expect(screen.getByText('Goal: hypertrophy')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set your goal in Profile' })).toBeNull()
  })

  it('maps the goal to its profile', () => {
    goal('strength')
    render(<AnalysisScreen />)
    expect(screen.getByText('Goal: strength')).toBeTruthy()
    cleanup()
    goal('fat_loss')
    render(<AnalysisScreen />)
    expect(screen.getByText('Goal: general health')).toBeTruthy()
  })

  it('with no goal, reads as hypertrophy and links to the Profile', () => {
    goal(null)
    render(<AnalysisScreen />)
    expect(screen.getByText('Goal: hypertrophy')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set your goal in Profile' }))
    expect(h.nav).toHaveBeenCalledWith('/perfil')
  })

  it('on an empty plan asks for a program, with a link to Programs', () => {
    setS({ routines: [], week: {} })
    render(<AnalysisScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a program to start' }))
    expect(h.nav).toHaveBeenCalledWith('/plan/programas')
    expect(screen.queryByRole('region', { name: 'Weekly sets per muscle' })).toBeNull()
  })

  it('Back goes to the Plan on a first entry', () => {
    render(<AnalysisScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith('/plan')
  })
})

describe('AnalysisScreen: volume', () => {
  it('draws one bar per group with its value in text, against the range', () => {
    render(<AnalysisScreen />)
    const volume = region('Weekly sets per muscle')
    const rows = within(volume).getAllByTestId('volume-row')
    expect(rows.map(r => r.dataset.group)).toEqual(['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'])
    const chest = rows[0]
    expect(chest.textContent).toContain('Chest')
    expect(chest.textContent).toContain('Below ideal')
    expect(within(chest).getByTestId('volume-value').textContent).toBe('6')
    expect(rows[1].textContent).toContain('No sets')
    expect(volume.textContent).toContain('Recommended range: 10 to 20 sets a week')
  })

  it('shows half sets with one decimal', () => {
    // the incline fly also trains the shoulders as a secondary muscle: 0.5 per set
    setS({ routines: [{ ...structuredClone(PUSH), ex: [{ id: '1278', sets: 3 }] }] })
    render(<AnalysisScreen />)
    const values = within(region('Weekly sets per muscle')).getAllByTestId('volume-value').map(v => v.textContent)
    expect(values.some(v => v === '1.5')).toBe(true)
  })

  it('cites the sources of the range in its ⓘ', () => {
    render(<AnalysisScreen />)
    fireEvent.click(within(region('Weekly sets per muscle')).getByRole('button', { name: 'See source' }))
    const pop = screen.getByRole('dialog')
    for (const ref of RANGES.hypertrophy.refs) expect(pop.textContent).toContain(REFS[ref as keyof typeof REFS].title)
  })

  it('uses the range of the profile', () => {
    goal('strength')
    render(<AnalysisScreen />)
    expect(region('Weekly sets per muscle').textContent).toContain('Recommended range: 6 to 12 sets a week')
  })

  it('"Show as table" shows the same numbers in a table, and goes back to the chart', () => {
    render(<AnalysisScreen />)
    const volume = region('Weekly sets per muscle')
    fireEvent.click(within(volume).getByRole('button', { name: 'Show as table' }))
    const table = within(volume).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Muscle', 'Sets', 'Range', 'Status'])
    const chest = within(table).getByRole('row', { name: /Chest/ })
    expect(within(chest).getAllByRole('cell').map(c => c.textContent)).toEqual(['6', '10 to 20', 'Below ideal'])
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(within(volume).queryAllByTestId('volume-row')).toHaveLength(0)
    fireEvent.click(within(volume).getByRole('button', { name: 'Show as chart' }))
    expect(within(volume).queryByRole('table')).toBeNull()
    expect(within(volume).getAllByTestId('volume-row')).toHaveLength(10)
  })

  it('lists the exercises with no known muscle', () => {
    const custom = { id: 'c1', n: 'Sled push', custom: true, bp: 'upper legs' }
    pushDay({
      customEx: [custom, { id: 'c2', n: 'Farmer walk', custom: true, bp: 'upper legs' }],
      routines: [{ ...structuredClone(PUSH), ex: [...PUSH.ex, { id: 'c1', sets: 3 }, { id: 'c2', sets: 2 }] }],
    })
    render(<AnalysisScreen />)
    const volume = region('Weekly sets per muscle')
    expect(volume.textContent).toContain('2 exercises with no known muscle')
    expect(volume.textContent).toContain('Sled push')
    expect(volume.textContent).toContain('Farmer walk')
  })

  it('says one exercise in the singular, and nothing when every muscle is known', () => {
    pushDay({ customEx: [{ id: 'c1', n: 'Sled push', custom: true, bp: 'upper legs' }], routines: [{ ...structuredClone(PUSH), ex: [...PUSH.ex, { id: 'c1', sets: 3 }] }] })
    render(<AnalysisScreen />)
    expect(screen.getByText('1 exercise with no known muscle')).toBeTruthy()
    cleanup()
    pushDay()
    render(<AnalysisScreen />)
    expect(screen.queryByText(/no known muscle/)).toBeNull()
  })
})

describe('AnalysisScreen: frequency, balance and time', () => {
  it('frequency: days per group, with the recommendation and its source', () => {
    render(<AnalysisScreen />)
    const freq = region('Frequency')
    expect(freq.textContent).toContain('Each muscle twice a week or more.')
    expect(within(freq).getByTestId('frequency-chest').textContent).toContain('1 day')
    fireEvent.click(within(freq).getByRole('button', { name: 'See source' }))
    expect(screen.getByRole('dialog').textContent).toContain(REFS.schoenfeld2016.title)
  })

  it('balance: the sentence with no number, and a rule-of-thumb ⓘ', () => {
    render(<AnalysisScreen />)
    const balance = region('Balance')
    expect(balance.textContent).toContain('You do far more pushing sets than pulling sets.')
    expect(balance.textContent).not.toMatch(/\d/)
    fireEvent.click(within(balance).getByRole('button', { name: 'See source' }))
    const pop = screen.getByRole('dialog')
    expect(pop.textContent).toContain('Rule of thumb')
    expect(within(pop).queryByRole('link')).toBeNull()
  })

  it('balance: says it is balanced when it is', () => {
    setS({ routines: [{ ...structuredClone(PUSH), ex: [{ id: '0025', sets: 3 }, { id: '2330', sets: 3 }] }] })
    render(<AnalysisScreen />)
    expect(region('Balance').textContent).toContain('Push and pull are balanced.')
  })

  it('time: about N min per routine, and an ⓘ that explains the sum without a reference', () => {
    render(<AnalysisScreen />)
    const time = region('Time per routine')
    const minutes = estimateMinutes(PUSH)
    expect(within(time).getByTestId('minutes-push').textContent).toBe(`PushAbout ${minutes} min`)
    fireEvent.click(within(time).getByRole('button', { name: 'How the time is estimated' }))
    const pop = screen.getByRole('dialog')
    expect(pop.textContent).toContain('40 s')
    expect(pop.textContent).toContain('5 min')
    expect(within(pop).queryByRole('link')).toBeNull()
  })
})

describe('AnalysisScreen: alerts and Apply', () => {
  it('lists the alerts in order; the ones without a suggestion say what to change by hand', () => {
    render(<AnalysisScreen />)
    const alerts = within(region('Alerts')).getAllByRole('article')
    expect(alerts[0].getAttribute('aria-labelledby')).toBeTruthy()
    const titles = alerts.map(a => a.querySelector('h3')?.textContent)
    expect(titles.indexOf('Back with no sets')).toBeLessThan(titles.indexOf('Chest below ideal'))
    const freq = screen.getByRole('article', { name: 'Chest with low frequency' })
    expect(within(freq).queryByRole('button', { name: /^Apply/ })).toBeNull()
    expect(freq.textContent).toContain('Train it on 2 or more days a week, with at least 2 sets each day.')
    const balance = screen.getByRole('article', { name: 'More push than pull' })
    expect(within(balance).queryByRole('button', { name: /^Apply/ })).toBeNull()
    expect(balance.textContent).toContain('Add sets to the smaller side, or take some from the bigger one.')
  })

  it('Apply shows the change before and after, and Cancel changes nothing and gives the focus back', async () => {
    render(<AnalysisScreen />)
    const { apply, dialog } = openChestApply()
    expect(dialog.textContent).toContain(`${name('0025')}: 3 → 5 sets`)
    expect(dialog.textContent).toContain(`${name('1278')}: 3 → 5 sets`)
    expect(within(dialog).getByText('Push')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog.getAttribute('data-state')).toBe('closed'))
    endSheetAnimation()
    await waitFor(() => expect(document.activeElement).toBe(apply))
    expect(S().routines[0].ex.map((e: AnyState) => e.sets)).toEqual([3, 3])
    expect(h.toast).not.toHaveBeenCalled()
  })

  it('confirming applies, recomputes the analysis, moves the focus and offers Undo, which restores', async () => {
    render(<AnalysisScreen />)
    const { dialog } = openChestApply()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(S().routines[0].ex.map((e: AnyState) => e.sets)).toEqual([5, 5])
    await waitFor(() => expect(dialog.getAttribute('data-state')).toBe('closed'))
    endSheetAnimation()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Alerts' })))
    // chest is at 10 now: in range, its alert and its Apply are gone
    const chest = within(region('Weekly sets per muscle')).getAllByTestId('volume-row')[0]
    expect(within(chest).getByTestId('volume-value').textContent).toBe('10')
    expect(screen.queryByRole('article', { name: 'Chest below ideal' })).toBeNull()

    expect(h.toast).toHaveBeenCalledWith('Change applied', expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }))
    act(() => h.toast.mock.calls[0][1].action.onClick())
    expect(S().routines[0].ex.map((e: AnyState) => e.sets)).toEqual([3, 3])
    expect(h.toast).toHaveBeenLastCalledWith('Change undone')
    expect(screen.getByRole('article', { name: 'Chest below ideal' })).toBeTruthy()
  })

  it('adding an exercise shows it as added, in its routine', () => {
    render(<AnalysisScreen />)
    const back = screen.getByRole('article', { name: 'Back with no sets' })
    fireEvent.click(within(back).getByRole('button', { name: /^Apply/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(`${name('2330')}: added with 3 sets`)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(S().routines[0].ex.map((e: AnyState) => e.id)).toContain('2330')
  })

  it('Undo does nothing once the screen is gone', () => {
    render(<AnalysisScreen />)
    const { dialog } = openChestApply()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    cleanup()
    h.toast.mock.calls[0][1].action.onClick()
    expect(h.toast).toHaveBeenLastCalledWith('Nothing to undo')
    expect(S().routines[0].ex.map((e: AnyState) => e.sets)).toEqual([5, 5])
  })

  it('only the last change can be undone', async () => {
    render(<AnalysisScreen />)
    let { dialog } = openChestApply()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(dialog.getAttribute('data-state')).toBe('closed'))
    endSheetAnimation()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const back = screen.getByRole('article', { name: 'Back with no sets' })
    fireEvent.click(within(back).getByRole('button', { name: /^Apply/ }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    act(() => h.toast.mock.calls[0][1].action.onClick())
    expect(h.toast).toHaveBeenLastCalledWith('Nothing to undo')
    expect(S().routines[0].ex.map((e: AnyState) => e.sets).slice(0, 2)).toEqual([5, 5])
  })

  it('a balanced plan has no alerts', () => {
    // strength, with no frequency alert: a plan whose every group sits in 6 to 12 is balanced
    goal('strength')
    const ex = ([['0025', 3], ['2330', 6], ['0426', 1], ['0241', 1], ['0739', 4], ['0586', 2], ['1409', 1], ['0605', 3], ['0175', 3]] as const)
      .map(([id, sets]) => ({ id, sets }))
    setS({ routines: [{ id: 'a', name: 'A', emoji: 'star', ex }], week: { 1: ['a'], 3: ['a'] } })
    render(<AnalysisScreen />)
    expect(region('Alerts').textContent).toContain('Balanced plan for strength')
    expect(within(region('Alerts')).queryAllByRole('article')).toHaveLength(0)
  })
})

describe('AnalysisScreen in pt-BR', () => {
  it('translates the screen', async () => {
    await setLang('pt-BR')
    render(<AnalysisScreen />)
    expect(screen.getByText('Objetivo: hipertrofia')).toBeTruthy()
    const volume = region('Séries por músculo na semana')
    expect(volume.textContent).toContain('Faixa recomendada: 10 a 20 séries por semana')
    expect(within(volume).getByRole('button', { name: 'Ver como tabela' })).toBeTruthy()
    expect(region('Tempo por rotina').textContent).toMatch(/cerca de \d+ min/i)
    expect(region('Equilíbrio').textContent).toContain('Você faz bem mais séries de empurrar do que de puxar.')
    const chest = screen.getByRole('article', { name: 'Peito abaixo do ideal' })
    fireEvent.click(within(chest).getByRole('button', { name: /^Aplicar/ }))
    expect(screen.getByRole('dialog').textContent).toContain(`${name('0025')}: 3 → 5 séries`)
  })

  it('names the hamstrings group "Posterior de coxa" here only, and states the frequency rule (review I1, I2)', async () => {
    await setLang('pt-BR')
    render(<AnalysisScreen />)
    const rows = within(region('Séries por músculo na semana')).getAllByTestId('volume-row')
    expect(rows.find(r => r.dataset.group === 'hamstrings')?.textContent).toContain('Posterior de coxa')
    expect(screen.getByRole('article', { name: 'Peito com frequência baixa' }).textContent)
      .toContain('Treine esse músculo em 2 dias da semana ou mais, com pelo menos 2 séries em cada dia.')
    // the rest of the app keeps its own name for the muscle
    expect(t('hamstrings')).toBe('isquiotibiais')
    expect(t('Hamstrings')).toBe('Isquiotibiais')
  })
})

describe('AnalysisScreen with routines but nothing scheduled (review M6)', () => {
  it('points to the week schedule instead of the programs', () => {
    setS({ week: {} })
    render(<AnalysisScreen />)
    expect(screen.queryByRole('button', { name: 'Pick a program to start' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Put a routine on a day of the week' }))
    expect(h.nav).toHaveBeenCalledWith('/plan')
  })
})
