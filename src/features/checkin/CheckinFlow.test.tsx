// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import CheckinFlow, { openCheckin, closeCheckin, useCheckinFlow, suggestTitle } from './CheckinFlow'
import { useCheckins, type CheckinInput } from './useCheckins'
import { PhotoError } from './photo'
import { useProfile } from '../profile/useProfile'
import { DEF, useStore } from '../../store/useStore.js'
import { setLang } from '../../lib/i18n.js'
import { closeDrawer } from '../social/test-drawer'

const ME = '00000000-0000-4000-8000-00000000000a'
const BENCH = '0025'
// 2026-10-10 is a Saturday; noon in São Paulo.
const NOW = new Date('2026-10-10T15:00:00Z')
const PUSH = { id: 'r1', name: 'Push', emoji: 'dumbbell', ex: [{ id: BENCH, sets: 2, reps: 8, mode: 'reps' }] }
const LEGS = { id: 'r2', name: 'Legs', emoji: 'dumbbell', ex: [{ id: '0032', sets: 3, reps: 10, mode: 'reps' }] }
const post = vi.fn(async (_: CheckinInput) => 'c1')
const realPost = useCheckins.getState().post

const photo = () => new File([new Uint8Array(20)], 'gym.jpg', { type: 'image/jpeg' })
const pickPhoto = (f: File = photo()) => fireEvent.change(screen.getByLabelText('Choose from gallery'), { target: { files: [f] } })
const postButton = () => screen.queryByRole('button', { name: 'Post' }) as HTMLButtonElement | null
const radio = (name: string) => screen.getByRole('radio', { name })
const titleField = () => screen.getByLabelText('Title') as HTMLInputElement
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

function setup({ week = { 6: ['r1', 'r2'] } as Record<number, string[]>, share = true, workouts = [] as unknown[] } = {}) {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', routines: [PUSH, LEGS], week, dayPlan: {}, workouts, exWeights: {} }, user: { id: ME } })
  useProfile.setState({ profile: { id: ME, timezone: 'America/Sao_Paulo', share_activity: share } as never })
  render(<CheckinFlow />)
}
const open = (opts?: Parameters<typeof openCheckin>[0]) => act(() => openCheckin(opts))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  useCheckins.setState({ userId: ME, post, dropped: [] })
  post.mockReset().mockResolvedValue('c1')
  h.toast.mockReset(); h.toast.success.mockReset(); h.toast.error.mockReset()
  useCheckinFlow.setState({ open: false, opts: {} })
})
afterEach(() => {
  cleanup(); vi.useRealTimers()
  useCheckins.setState({ post: realPost, userId: null })
  useProfile.setState({ profile: null })
})

describe('the check-in panel', () => {
  it('opens on the photo, and choosing one moves on to the post', () => {
    setup()
    expect(screen.queryByRole('dialog')).toBeNull()
    open()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New check-in')).toBeTruthy()
    const camera = screen.getByLabelText('Take photo') as HTMLInputElement
    expect(camera.type).toBe('file')
    expect(camera.getAttribute('accept')).toBe('image/*')
    expect(camera.getAttribute('capture')).toBe('environment')
    // No photo, no way to post.
    expect(postButton()).toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()
    pickPhoto()
    expect(titleField()).toBeTruthy()
    expect(postButton()!.disabled).toBe(false)
  })

  it('on a day with routines, picks strength training and the first routine, with the others as options', () => {
    setup()
    open(); pickPhoto()
    expect(radio('Strength training').getAttribute('aria-checked')).toBe('true')
    const routine = screen.getByLabelText('Routine') as HTMLSelectElement
    expect(routine.value).toBe('r1')
    expect([...routine.options].map(o => o.value)).toEqual(['', 'r1', 'r2'])
    expect(titleField().value).toBe('Strength training · Push')
    fireEvent.change(routine, { target: { value: 'r2' } })
    expect(titleField().value).toBe('Strength training · Legs')
  })

  it('suggests the title in the language of the app', async () => {
    await setLang('pt-BR')
    try {
      expect(suggestTitle('strength', 'Push', null)).toBe('Musculação · Push')
      expect(suggestTitle('strength', 'Push', 55)).toBe('Musculação · Push · 55 min')
      expect(suggestTitle('run', null, null)).toBe('Corrida')
    } finally { await setLang('en') }
  })

  it('keeps an edited title, up to 60 characters, with a counter', () => {
    setup()
    open(); pickPhoto()
    fireEvent.change(titleField(), { target: { value: 'x'.repeat(70) } })
    expect(titleField().value).toHaveLength(60)
    expect(titleField().maxLength).toBe(60)
    expect(screen.getByText('60/60')).toBeTruthy()
    // A title written by hand stays when the routine changes.
    fireEvent.change(titleField(), { target: { value: 'Peito pesado' } })
    fireEvent.change(screen.getByLabelText('Routine'), { target: { value: 'r2' } })
    expect(titleField().value).toBe('Peito pesado')
  })

  it('counts the caption and the private note against 500', () => {
    setup()
    open(); pickPhoto()
    const caption = screen.getByLabelText('Caption') as HTMLTextAreaElement
    const note = screen.getByLabelText('Private note') as HTMLTextAreaElement
    expect(caption.maxLength).toBe(500)
    expect(note.maxLength).toBe(500)
    fireEvent.change(caption, { target: { value: 'Peito e ombro' } })
    expect(screen.getByText('13/500')).toBeTruthy()
    fireEvent.change(note, { target: { value: 'y'.repeat(600) } })
    expect(note.value).toHaveLength(500)
    expect(screen.getByText('500/500')).toBeTruthy()
  })

  it('posts with everything filled in, and closes', async () => {
    setup()
    open()
    const f = photo()
    pickPhoto(f)
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '55' } })
    expect(titleField().value).toBe('Strength training · Push · 55 min')
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Peito e ombro' } })
    fireEvent.change(screen.getByLabelText('Private note'), { target: { value: 'joelho ok' } })
    fireEvent.click(postButton()!)
    await settle()
    expect(post).toHaveBeenCalledWith({
      day: '2026-10-10', activity: 'strength', routineId: 'r1', routineName: 'Push', title: 'Strength training · Push · 55 min',
      caption: 'Peito e ombro', note: 'joelho ok', durationMin: 55, visibility: 'friends', photo: f, detail: null
    })
    expect(h.toast.success).toHaveBeenCalledWith('Check-in posted.')
    expect(useCheckinFlow.getState().open).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Was it yesterday?" moves the day', async () => {
    setup()
    open(); pickPhoto()
    fireEvent.click(screen.getByRole('switch', { name: 'Was it yesterday?' }))
    expect(screen.getByText('It counts for yesterday.')).toBeTruthy()
    fireEvent.click(postButton()!)
    await settle()
    expect(post.mock.calls[0][0].day).toBe('2026-10-09')
  })

  it('starts on the profile’s default visibility', async () => {
    setup({ share: false })
    open(); pickPhoto()
    expect(radio('Only me').getAttribute('aria-checked')).toBe('true')
    expect(radio('Friends').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(radio('Friends'))
    fireEvent.click(postButton()!)
    await settle()
    expect(post.mock.calls[0][0].visibility).toBe('friends')
  })

  it('on a rest day asks for the activity before posting', async () => {
    setup({ week: {} })
    open(); pickPhoto()
    expect(screen.queryByLabelText('Routine')).toBeNull()
    expect(postButton()!.disabled).toBe(true)
    expect(screen.getByText('Pick an activity.')).toBeTruthy()
    fireEvent.click(radio('Running'))
    expect(titleField().value).toBe('Running')
    fireEvent.click(postButton()!)
    await settle()
    expect(post.mock.calls[0][0]).toMatchObject({ activity: 'run', routineId: null, routineName: null, detail: null })
  })

  it('refuses a duration out of 1 to 600 and an empty title', () => {
    setup()
    open(); pickPhoto()
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '601' } })
    expect(postButton()!.disabled).toBe(true)
    expect(screen.getByText('Duration goes from 1 to 600 minutes.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '' } })
    fireEvent.change(titleField(), { target: { value: '   ' } })
    expect(postButton()!.disabled).toBe(true)
    expect(screen.getByText('Give it a title.')).toBeTruthy()
  })

  it('opens with the routine it was given', () => {
    setup({ week: {} })
    open({ routineId: 'r2' }); pickPhoto()
    expect(radio('Strength training').getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText('Routine') as HTMLSelectElement).value).toBe('r2')
  })

  it('Detail workout opens the routine’s exercises and writes the session with the check-in id', async () => {
    setup({ workouts: [{ id: 'w1', d: '2026-10-03', start: 1, end: 2, routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: [],
      entries: [{ id: BENCH, rid: 'r1', target: PUSH.ex[0], sets: [{ w: 42.5, r: 8, done: true }] }] }] })
    open(); pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Detail workout' }))
    const sheet = screen.getAllByRole('dialog').at(-1)!
    expect((within(sheet).getByLabelText('Set 1 · Weight (kg)') as HTMLInputElement).value).toBe('42.5')
    fireEvent.change(within(sheet).getByLabelText('Set 1 · Weight (kg)'), { target: { value: '45' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Workout detailed')).toBeTruthy()
    fireEvent.click(postButton()!)
    await settle()
    expect(post.mock.calls[0][0].detail).toEqual({ entries: [{ id: BENCH, sets: [{ w: 45, r: 8, done: true }] }] })
    const S = useStore.getState().S
    expect(S.workouts.map((w: { id: string }) => w.id)).toEqual(['w1', 'c1'])
    expect(S.workouts[1]).toMatchObject({ d: '2026-10-10', routineId: 'r1', entries: [{ id: BENCH, sets: [{ w: 45, r: 8, done: true }] }] })
  })

  it('has no detail for an activity other than strength training', () => {
    setup()
    open(); pickPhoto()
    expect(screen.getByRole('button', { name: 'Detail workout' })).toBeTruthy()
    fireEvent.click(radio('Running'))
    expect(screen.queryByRole('button', { name: 'Detail workout' })).toBeNull()
  })

  it('from a finished live workout: routine, detail and duration come filled in, and no second session is written', async () => {
    const live = { id: 'live', d: '2026-10-10', start: NOW.getTime() - 50 * 60000, end: NOW.getTime(), routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: [],
      entries: [{ id: BENCH, rid: 'r1', target: PUSH.ex[0], sets: [{ w: 40, r: 8, done: true }] }] }
    setup({ week: {}, workouts: [live] })
    const detail = { entries: [{ id: BENCH, sets: [{ w: 40, r: 8, done: true as const }] }] }
    open({ routineId: 'r1', detail, fromWorkout: 'live' })
    // The photo is still the first thing asked.
    expect(postButton()).toBeNull()
    pickPhoto()
    expect((screen.getByLabelText('Routine') as HTMLSelectElement).value).toBe('r1')
    expect((screen.getByLabelText('Duration (min)') as HTMLInputElement).value).toBe('50')
    expect(screen.getByText('From the workout you logged in the app')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Detail workout' })).toBeNull()
    fireEvent.click(postButton()!)
    await settle()
    expect(post.mock.calls[0][0]).toMatchObject({ routineId: 'r1', durationMin: 50, detail })
    const S = useStore.getState().S
    expect(S.workouts).toHaveLength(1)
    expect(S.workouts[0]).toMatchObject({ id: 'live', checkinId: 'c1' })
  })

  it('leaving without a photo creates nothing, and runs what was waiting for the panel to close', () => {
    setup()
    const after = vi.fn()
    open({ onClose: after })
    act(() => closeDrawer(screen.getByRole('dialog')))
    expect(post).not.toHaveBeenCalled()
    expect(useCheckinFlow.getState().open).toBe(false)
    expect(after).toHaveBeenCalledTimes(1)
    act(() => closeCheckin())
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('a photo that cannot be opened asks for another one and posts nothing', async () => {
    setup()
    post.mockRejectedValue(new PhotoError('photo_unreadable'))
    open(); pickPhoto()
    fireEvent.click(postButton()!)
    await settle()
    expect(h.toast.error).toHaveBeenCalledWith('Couldn’t open this photo. Try the camera.')
    expect(useCheckinFlow.getState().open).toBe(true)
    expect(postButton()).toBeNull()
    expect(screen.getByLabelText('Take photo')).toBeTruthy()
  })

  it('says once what the server refused, then forgets it', () => {
    setup()
    act(() => useCheckins.setState({ dropped: [{ id: 'x', reason: 'edit_refused', title: 'Corrida' }] }))
    expect(h.toast).toHaveBeenCalledWith('Couldn’t save a change to a check-in.')
    expect(useCheckins.getState().dropped).toEqual([])
  })
})
