// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'

// The session the client holds: the queue only goes out for the account signed in.
const auth = vi.hoisted(() => ({ user: null as string | null }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: auth.user ? { access_token: 't', user: { id: auth.user } } : null } }) } }
}))
const h = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
const api = vi.hoisted(() => ({ updateCheckin: vi.fn(), upsertCheckin: vi.fn(), fetchMyCheckins: vi.fn(), hasCheckin: vi.fn() }))
vi.mock('./checkin-api', async orig => ({ ...(await orig<typeof import('./checkin-api')>()), ...api }))
vi.mock('./photo-src', () => ({
  useCheckinPhoto: (_photo: unknown, path: string | null) => ({ url: path ? 'https://photos/' + path : null, failed: false, fail() {}, retry() {} })
}))
vi.mock('../gamification/events', () => ({ emit: vi.fn(), flush: vi.fn(async () => ({ sent: 0, left: 0 })) }))

import EditCheckinSheet from './EditCheckinSheet'
import CheckinFlow from './CheckinFlow'
import { useCheckins, type CheckinPatch } from './useCheckins'
import { memoryOutboxBackend, pendingCheckins, setCheckinOutboxBackend } from './outbox'
import { useProfile } from '../profile/useProfile'
import { DEF, useStore } from '../../store/useStore.js'
import type { CheckinRow } from './types'

const ME = '00000000-0000-4000-8000-00000000000a'
const BENCH = '0025'
const PUSH = { id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 1, reps: 8, mode: 'reps' }] }
// Saturday 10/10/2026, noon in Sao Paulo.
const NOW = new Date('2026-10-10T15:00:00Z')
const DETAIL = { entries: [{ id: BENCH, sets: [{ w: 60, r: 8, done: true as const }] }] }
const rowOf = (over: Partial<CheckinRow> = {}): CheckinRow => ({
  id: 'c1', user_id: ME, day: '2026-10-09', activity: 'strength', routine_id: 'r1', routine_name: 'Push', title: 'Push day',
  caption: 'Chest done', note: 'Left knee', duration_min: 55, visibility: 'private', photo_path: `${ME}/c1.jpg`, detail: null,
  created_at: '2026-10-09T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', ...over
})
const edit = vi.fn(async (_id: string, _p: CheckinPatch, _b?: CheckinRow) => {})
const realEdit = useCheckins.getState().edit
const onOpenChange = vi.fn()
const onSaved = vi.fn()

function setup(row: CheckinRow = rowOf(), workouts: unknown[] = [], { stub = true } = {}) {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', routines: [PUSH], workouts, exWeights: {} }, user: { id: ME } })
  useProfile.setState({ profile: { id: ME, timezone: 'America/Sao_Paulo' } as never })
  if (stub) useCheckins.setState({ userId: ME, edit })
  return render(<EditCheckinSheet open onOpenChange={onOpenChange} id={row.id} day={row.day} row={row} onSaved={onSaved} />)
}
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement | HTMLTextAreaElement
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  edit.mockClear(); onOpenChange.mockClear(); onSaved.mockClear()
  h.toast.mockReset(); h.toast.success.mockReset(); h.toast.error.mockReset()
  Object.values(api).forEach(f => f.mockReset())
})
afterEach(() => {
  cleanup(); vi.useRealTimers()
  useCheckins.setState({ userId: null, edit: realEdit, mine: [], today: [], dropped: [] })
  useProfile.setState({ profile: null })
})

describe('editing a posted check-in', () => {
  it('opens with what was posted, and the day, activity and photo locked', () => {
    setup()
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { name: 'Edit check-in' })).toBeTruthy()
    expect(field('Title').value).toBe('Push day')
    expect(field('Caption').value).toBe('Chest done')
    expect(field('Private note').value).toBe('Left knee')
    expect(screen.getByRole('radio', { name: 'Only me' }).getAttribute('aria-checked')).toBe('true')
    // Shown, but not something to change: no photo inputs, no activity choice.
    const locked = screen.getByRole('group', { name: 'Day, activity and photo' })
    expect(within(locked).getByText('Friday 9 October')).toBeTruthy()
    expect(within(locked).getByText('Strength training · Push')).toBeTruthy()
    expect((within(locked).getByRole('img') as HTMLImageElement).src).toBe(`https://photos/${ME}/c1.jpg`)
    expect(screen.getByText('Day, activity and photo stay as they are. To change them, delete the check-in and post it again.')).toBeTruthy()
    expect(sheet.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Running' })).toBeNull()
    expect(screen.queryByLabelText('Was it yesterday?')).toBeNull()
    // Nothing changed yet, nothing to save.
    expect(save().disabled).toBe(true)
  })

  it('saves only what changed', async () => {
    const row = rowOf()
    setup(row)
    fireEvent.change(field('Title'), { target: { value: '  Push, heavy  ' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Friends' }))
    await act(async () => { fireEvent.click(save()) })
    expect(edit).toHaveBeenCalledWith('c1', { title: 'Push, heavy', visibility: 'friends' }, row)
    expect(h.toast.success).toHaveBeenCalledWith('Check-in saved.')
    expect(onSaved).toHaveBeenCalledWith({ ...row, title: 'Push, heavy', visibility: 'friends' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('clears the caption and the note to nothing, and keeps the limits of a new check-in', async () => {
    setup()
    fireEvent.change(field('Caption'), { target: { value: '   ' } })
    fireEvent.change(field('Private note'), { target: { value: '' } })
    fireEvent.change(field('Title'), { target: { value: 'x'.repeat(80) } })
    expect(field('Title').value).toHaveLength(60)
    await act(async () => { fireEvent.click(save()) })
    expect(edit).toHaveBeenCalledWith('c1', { title: 'x'.repeat(60), caption: null, note: null }, expect.anything())
  })

  it('asks for a title before saving', () => {
    setup()
    fireEvent.change(field('Title'), { target: { value: '  ' } })
    expect(screen.getByText('Give it a title.')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('edits the detail and the history session that goes with it', async () => {
    setup(rowOf({ detail: DETAIL }), [{ id: 'c1', d: '2026-10-09', start: 0, end: 0, routineIds: ['r1'], routineId: 'r1', name: 'Push', bw: null,
      entries: [{ id: BENCH, sets: [{ w: 60, r: 8, done: true }] }], prs: [] }])
    expect(screen.getByText('Workout detailed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const sheets = screen.getAllByRole('dialog')
    const detail = sheets[sheets.length - 1]
    fireEvent.change(within(detail).getByLabelText('Set 1 · Weight (kg)'), { target: { value: '65' } })
    fireEvent.click(within(detail).getByRole('button', { name: 'Save' }))
    await act(async () => { fireEvent.click(save()) })
    const next = { entries: [{ id: BENCH, sets: [{ w: 65, r: 8, done: true }] }], unit: 'kg' as const }
    expect(edit).toHaveBeenCalledWith('c1', { detail: next }, expect.anything())
    const w = (useStore.getState() as { S: { workouts: { id: string; entries: { sets: { w: number }[] }[] }[] } }).S.workouts.find(x => x.id === 'c1')!
    expect(w.entries[0].sets[0].w).toBe(65)
  })

  it('keeps the detail of a check-in from a live workout read-only', () => {
    setup(rowOf({ detail: DETAIL }), [{ id: 'w9', d: '2026-10-09', checkinId: 'c1', entries: [{ id: BENCH, sets: [{ w: 80, r: 5, done: true }] }] }])
    expect(screen.getByText('From the workout you logged in the app')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Detail workout' })).toBeNull()
  })

  it('reads the check-in from the server when this phone does not have it', async () => {
    const row = rowOf({ day: '2026-08-01' })
    api.fetchMyCheckins.mockResolvedValue([rowOf({ id: 'other', day: '2026-08-01' }), row])
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), routines: [PUSH], workouts: [] }, user: { id: ME } })
    useProfile.setState({ profile: { id: ME, timezone: 'America/Sao_Paulo' } as never })
    useCheckins.setState({ userId: ME, edit, mine: [] })
    render(<EditCheckinSheet open onOpenChange={onOpenChange} id="c1" day="2026-08-01" />)
    await waitFor(() => expect(field('Title').value).toBe('Push day'))
    expect(api.fetchMyCheckins).toHaveBeenCalledWith('2026-08-01', '2026-08-01')
  })
})

describe('editing through the queue', () => {
  const network = () => new TypeError('Failed to fetch')
  const refusal = () => Object.assign(new Error('item_immutable'), { code: 'P0001' })

  beforeEach(async () => {
    localStorage.clear()
    setCheckinOutboxBackend(memoryOutboxBackend())
    useCheckins.getState().reset()
    auth.user = ME
    useProfile.setState({ profile: { id: ME, timezone: 'America/Sao_Paulo' } as never, userId: ME, status: 'ready' } as never)
    api.fetchMyCheckins.mockResolvedValue([rowOf()])
    await useCheckins.getState().bind(ME)
  })

  it('queues an edit made offline and shows it at once, waiting to go up', async () => {
    api.updateCheckin.mockRejectedValue(network())
    setup(useCheckins.getState().mine[0], [], { stub: false })
    fireEvent.change(field('Title'), { target: { value: 'Offline title' } })
    await act(async () => { fireEvent.click(save()) })
    await waitFor(() => expect(api.updateCheckin).toHaveBeenCalled())
    const ops = await pendingCheckins(ME)
    expect(ops).toHaveLength(1)
    expect(ops[0].row).toMatchObject({ id: 'c1', title: 'Offline title', day: '2026-10-09', activity: 'strength', photo_path: `${ME}/c1.jpg` })
    expect(useCheckins.getState().mine[0]).toMatchObject({ title: 'Offline title', pending: true })
  })

  it('says once, with the generic notice, when the server refuses the edit', async () => {
    api.updateCheckin.mockRejectedValue(refusal())
    setup(useCheckins.getState().mine[0], [], { stub: false })
    render(<CheckinFlow />)
    fireEvent.change(field('Title'), { target: { value: 'Refused title' } })
    await act(async () => { fireEvent.click(save()) })
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Couldn’t save a change to a check-in.'))
    expect(await pendingCheckins(ME)).toHaveLength(0)
  })
})
