// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  nav: vi.fn(), state: null as unknown, online: true, toast: vi.fn(), fetchMyCheckins: vi.fn()
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav, useLocation: () => ({ state: h.state }) }))
vi.mock('@/lib/use-online', () => ({ useOnline: () => h.online }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('./checkin-api', () => ({ fetchMyCheckins: h.fetchMyCheckins }))
vi.mock('./photo-src', () => ({
  useCheckinPhoto: (_photo: unknown, path: string | null) => ({ url: path ? 'https://photos/' + path : null, failed: false, fail() {}, retry() {} })
}))

import MyTrainings from './MyTrainings'
import { useCheckins, type MyCheckin } from './useCheckins'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { progressOf } from '../gamification/test-progress'
import { DEF, useStore } from '../../store/useStore.js'
import { exOr } from '../../lib/exercises.js'
import { exerciseNameFor } from '../../lib/i18n.js'

const ME = 'u1'
const BENCH = '0025'
// Saturday 10/10/2026, noon in Sao Paulo. This phone keeps the check-ins from 26/09 on.
const NOW = new Date('2026-10-10T15:00:00Z')
const row = (id: string, day: string, over: Partial<MyCheckin> = {}): MyCheckin => ({
  id, day, activity: 'strength', routine_id: 'r1', routine_name: 'Push', title: 'Gym ' + id, caption: null, note: null,
  duration_min: null, visibility: 'friends', photo_path: `${ME}/${id}.jpg`, detail: null, created_at: day + 'T15:00:00Z', ...over
})
const remove = vi.fn(async () => {})
const realRemove = useCheckins.getState().remove

function setup({ mine = [] as MyCheckin[], workouts = [] as unknown[] } = {}) {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', workouts }, user: { id: ME } })
  useProfile.setState({ profile: { id: ME, timezone: 'America/Sao_Paulo', days_per_week: 3 } as never })
  useCheckins.setState({ userId: ME, mine, today: mine.filter(r => r.day === '2026-10-10'), remove })
  render(<MyTrainings />)
}
const day = (re: RegExp) => screen.getAllByRole('button').find(b => re.test(b.getAttribute('aria-label') ?? ''))!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  h.nav.mockReset(); h.toast.mockReset(); h.fetchMyCheckins.mockReset().mockResolvedValue([])
  h.state = null; h.online = true
  remove.mockClear()
})
afterEach(() => {
  cleanup(); vi.useRealTimers()
  useCheckins.setState({ userId: null, mine: [], today: [], remove: realRemove })
  useProfile.setState({ profile: null })
  useProgress.getState().reset()
})

describe('My workouts', () => {
  it('shows the month with the photo of each day with a check-in', () => {
    setup({ mine: [row('c1', '2026-10-07'), row('c2', '2026-10-07'), row('c3', '2026-10-09')] })
    expect(screen.getByRole('heading', { name: 'My workouts' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy()
    const wed = day(/7 October: 2 check-ins$/)
    expect(wed.getAttribute('data-media')).toBe('true')
    // The newest of the day is the one shown.
    expect((wed.querySelector('img') as HTMLImageElement).src).toBe('https://photos/u1/c1.jpg')
    expect(day(/9 October: 1 check-in$/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /8 October: No check-in$/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /12 October: Not yet$/ })).toBeTruthy()
    // The whole month is on this phone: nothing to ask the server.
    expect(h.fetchMyCheckins).not.toHaveBeenCalled()
  })

  it("tells this week's training days and the last day the server confirmed", () => {
    useProgress.setState({ status: 'ready', progress: progressOf(700, {}, { training: { confirms_on: '2026-10-12', last_closed: { day: '2026-10-08', detailed: false, xp: 210 } } }) })
    setup({ mine: [row('c1', '2026-10-07'), row('c3', '2026-10-09')] })
    expect(screen.getByText('2 of 3 days this week')).toBeTruthy()
    expect(screen.getByText('Thursday workout confirmed, +210 XP')).toBeTruthy()
    expect(screen.getByText('A day counts two days later, when it closes.')).toBeTruthy()
  })

  it('opens a day with its check-ins, the private note and the detailed session', () => {
    const live = { id: 'w9', d: '2026-10-07', checkinId: 'c2', entries: [{ id: BENCH, sets: [{ w: 80, r: 5, done: true }] }] }
    const own = { id: 'c1', d: '2026-10-07', entries: [{ id: BENCH, sets: [{ w: 60, r: 8, done: true }, { w: 62.5, r: 6, done: true }] }] }
    setup({
      mine: [
        row('c1', '2026-10-07', { note: 'Left knee a bit sore', caption: 'Back at it', visibility: 'private', duration_min: 55 }),
        row('c2', '2026-10-07', { activity: 'run', routine_id: null, routine_name: null })
      ],
      workouts: [own, live]
    })
    fireEvent.click(day(/7 October: 2 check-ins$/))
    const sheet = screen.getByRole('dialog')
    const first = within(sheet).getByRole('article', { name: 'Gym c1' })
    expect(within(first).getByText('Back at it')).toBeTruthy()
    expect(within(first).getByText('Private note')).toBeTruthy()
    expect(within(first).getByText('Left knee a bit sore')).toBeTruthy()
    expect(within(first).getByText('Only me')).toBeTruthy()
    expect(within(first).getByText('Strength training · Push · 55 min')).toBeTruthy()
    expect(within(first).getByText('Workout detailed')).toBeTruthy()
    expect(within(first).getByText(exerciseNameFor(exOr(BENCH)))).toBeTruthy()
    expect(within(first).getByText('60 kg × 8 · 62.5 kg × 6')).toBeTruthy()
    // A live workout linked to its check-in is its detail too.
    const second = within(sheet).getByRole('article', { name: 'Gym c2' })
    expect(within(second).getByText('Running')).toBeTruthy()
    expect(within(second).getByText('Friends')).toBeTruthy()
    expect(within(second).getByText('80 kg × 5')).toBeTruthy()
    expect(within(second).queryByText('Private note')).toBeNull()
  })

  it('reads the detail of the check-in when the session is not on this phone', () => {
    setup({ mine: [row('c1', '2026-10-07', { detail: { entries: [{ id: BENCH, sets: [{ w: 50, r: 10, done: true }] }] } })] })
    fireEvent.click(day(/7 October: 1 check-in$/))
    expect(within(screen.getByRole('dialog')).getByText('50 kg × 10')).toBeTruthy()
  })

  it("labels a check-in's own detail with the unit it was typed in (final review m2)", () => {
    // posted in kg, read after the profile switched to lb, before the session synced
    setup({ mine: [row('c1', '2026-10-07', { detail: { unit: 'kg', entries: [{ id: BENCH, sets: [{ w: 60, r: 8, done: true }] }] } })] })
    act(() => useStore.setState((s: any) => ({ S: { ...s.S, unit: 'lb' } })))
    fireEvent.click(day(/7 October: 1 check-in$/))
    expect(within(screen.getByRole('dialog')).getByText('60 kg × 8')).toBeTruthy()
  })

  it('opens a run check-in with its run detail and no sets', () => {
    const detail = { run: { status: 'unplanned' as const, distance_km: 6.2, rpe: 7 } }
    setup({ mine: [row('c1', '2026-10-07', { activity: 'run', routine_id: null, routine_name: null, duration_min: 38, detail })] })
    fireEvent.click(day(/7 October: 1 check-in$/))
    const entry = within(screen.getByRole('dialog')).getByRole('article', { name: 'Gym c1' })
    expect(within(entry).getByText('Running · 38 min')).toBeTruthy()
    expect(within(entry).queryByText('Workout detailed')).toBeNull()
    expect(within(entry).getByRole('button', { name: 'Edit check-in' })).toBeTruthy()
  })

  it('opens the day it was sent to', () => {
    h.state = { day: '2026-10-09' }
    setup({ mine: [row('c3', '2026-10-09')] })
    expect(within(screen.getByRole('dialog')).getByRole('article', { name: 'Gym c3' })).toBeTruthy()
  })

  it("asks the server for older days and lays this phone's copies over the recent ones", async () => {
    h.fetchMyCheckins.mockResolvedValue([
      row('old', '2026-09-03'),
      row('c5', '2026-09-28', { title: 'Old title' }),
      // Deleted on this phone, the delete still on its way: this phone's copy is the truth.
      row('gone', '2026-09-27')
    ])
    setup({ mine: [row('c5', '2026-09-28', { title: 'New title', pending: true })] })
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => expect(day(/3 September: 1 check-in$/)).toBeTruthy())
    // Only the days before this phone's window: 26/09 on are already here.
    expect(h.fetchMyCheckins).toHaveBeenCalledWith('2026-09-01', '2026-09-25')
    expect(screen.getByRole('img', { name: /27 September: No check-in$/ })).toBeTruthy()
    fireEvent.click(day(/28 September: 1 check-in$/))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('article', { name: 'New title' })).toBeTruthy()
    expect(within(sheet).getByText('Sending…')).toBeTruthy()
    expect(within(sheet).queryByText('Old title')).toBeNull()
  })

  it('says when a month has no check-in', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => expect(screen.getByText('No check-ins this month.')).toBeTruthy())
  })

  it('says when a month cannot be read, and tries again', async () => {
    h.fetchMyCheckins.mockRejectedValueOnce(new Error('offline'))
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => expect(screen.getByText('Could not load your check-ins.')).toBeTruthy())
    h.fetchMyCheckins.mockResolvedValue([row('old', '2026-09-03')])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(day(/3 September: 1 check-in$/)).toBeTruthy())
  })

  it('asks for a connection to see an older month offline', () => {
    h.online = false
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('Connect to see this month.')).toBeTruthy()
    expect(h.fetchMyCheckins).not.toHaveBeenCalled()
  })

  it('deletes a check-in after asking', async () => {
    const r = row('c3', '2026-10-09')
    setup({ mine: [r] })
    fireEvent.click(day(/9 October: 1 check-in$/))
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete check-in' }))
    expect(within(sheet).getByText('Delete this check-in?')).toBeTruthy()
    expect(within(sheet).getByText('The photo goes too. If the day is still open, it stops counting.')).toBeTruthy()
    expect(remove).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' })) })
    expect(remove).toHaveBeenCalledWith('c3', r)
    expect(h.toast).toHaveBeenCalledWith('Check-in deleted.')
  })

  it('edits a check-in from its day', () => {
    const r = row('c3', '2026-10-09', { note: 'Easy' })
    setup({ mine: [r] })
    fireEvent.click(day(/9 October: 1 check-in$/))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit check-in' }))
    const edit = screen.getAllByRole('dialog').find(d => within(d).queryByRole('heading', { name: 'Edit check-in' }))!
    expect((within(edit).getByLabelText('Title') as HTMLInputElement).value).toBe('Gym c3')
    expect((within(edit).getByLabelText('Private note') as HTMLTextAreaElement).value).toBe('Easy')
  })

  it('goes back to the Plan', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(h.nav).toHaveBeenCalledWith('/plan')
  })
})
