// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import CheckinFlow, { openCheckin, openCheckinCamera, closeCheckin, useCheckinFlow, suggestTitle } from './CheckinFlow'
import { useCheckins, type CheckinInput } from './useCheckins'
import { PhotoError } from './photo'
import { useProfile } from '../profile/useProfile'
import { DEF, useStore } from '../../store/useStore.js'
import { setLang } from '../../lib/i18n.js'
import { closeDrawer } from '../social/test-drawer'
import type { Item, RunPlan, Session } from '../run/types'

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

function setup({ week = { 6: ['r1', 'r2'] } as Record<number, string[]>, visibility = 'friends', share = false, workouts = [] as unknown[], runPlan = null as RunPlan | null } = {}) {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg', routines: [PUSH, LEGS], week, dayPlan: {}, workouts, exWeights: {}, weekStart: 1, runPlan }, user: { id: ME } })
  useProfile.setState({ profile: { id: ME, timezone: 'America/Sao_Paulo', checkin_visibility: visibility, share_activity: share } as never })
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

  it('keeps a rear camera input on the page, which the center tap clicks, and its photo moves on to the post', () => {
    setup()
    const camera = document.querySelector('input[type="file"][capture="environment"]') as HTMLInputElement
    expect(camera).toBeTruthy()
    expect(camera.getAttribute('accept')).toBe('image/*')
    const click = vi.spyOn(camera, 'click').mockImplementation(() => {})
    act(() => openCheckinCamera())
    expect(click).toHaveBeenCalledTimes(1)
    expect(useCheckinFlow.getState().open).toBe(true)
    fireEvent.change(camera, { target: { files: [photo()] } })
    expect(titleField()).toBeTruthy()
  })

  it('when the camera is cancelled, the photo step offers the camera and the gallery', () => {
    setup()
    const camera = document.querySelector('input[type="file"][capture="environment"]') as HTMLInputElement
    vi.spyOn(camera, 'click').mockImplementation(() => {})
    act(() => openCheckinCamera())
    // Nothing was picked: no change event.
    expect(postButton()).toBeNull()
    expect((screen.getByLabelText('Take photo') as HTMLInputElement).getAttribute('capture')).toBe('environment')
    expect((screen.getByLabelText('Choose from gallery') as HTMLInputElement).hasAttribute('capture')).toBe(false)
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

  it('closes the panel when its host leaves the page, so it never pops up later (final review I1)', () => {
    setup()
    open({ activity: 'run' })
    expect(useCheckinFlow.getState().open).toBe(true)
    cleanup()
    expect(useCheckinFlow.getState().open).toBe(false)
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

  it('starts on Friends by default, with the old workouts sharing off', async () => {
    setup({ share: false })
    open(); pickPhoto()
    expect(radio('Friends').getAttribute('aria-checked')).toBe('true')
    expect(radio('Only me').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(postButton()!)
    await settle()
    expect(post.mock.calls[0][0].visibility).toBe('friends')
  })

  it('starts on Only me when the profile says private, whatever share_activity says', async () => {
    setup({ visibility: 'private', share: true })
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
    expect(post.mock.calls[0][0].detail).toEqual({ entries: [{ id: BENCH, sets: [{ w: 45, r: 8, done: true }] }], unit: 'kg' })
    const S = useStore.getState().S
    expect(S.workouts.map((w: { id: string }) => w.id)).toEqual(['w1', 'c1'])
    expect(S.workouts[1]).toMatchObject({ d: '2026-10-10', routineId: 'r1', entries: [{ id: BENCH, sets: [{ w: 45, r: 8, done: true }] }] })
  })

  it('keeps the suggested load when the draft detail is reopened before posting', () => {
    setup({ workouts: [{ id: 'w1', d: '2026-10-03', start: 1, end: 2, routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: [],
      entries: [{ id: BENCH, rid: 'r1', target: PUSH.ex[0], sets: [{ w: 42.5, r: 8, done: true }, { w: 42.5, r: 8, done: true }] }] }] })
    open(); pickPhoto()
    fireEvent.click(screen.getByRole('button', { name: 'Detail workout' }))
    let sheet = screen.getAllByRole('dialog').at(-1)!
    expect(within(sheet).getByText('suggested 45 kg')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    sheet = screen.getAllByRole('dialog').at(-1)!
    expect(within(sheet).getByText('suggested 45 kg')).toBeTruthy()
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

  it('from a live workout the routine is locked, so the detail never names another routine', () => {
    const live = { id: 'live', d: '2026-10-10', start: NOW.getTime() - 50 * 60000, end: NOW.getTime(), routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: [],
      entries: [{ id: BENCH, rid: 'r1', target: PUSH.ex[0], sets: [{ w: 40, r: 8, done: true }] }] }
    setup({ week: {}, workouts: [live] })
    open({ routineId: 'r1', detail: { entries: [{ id: BENCH, sets: [{ w: 40, r: 8, done: true as const }] }] }, fromWorkout: 'live' })
    pickPhoto()
    const routine = screen.getByLabelText('Routine') as HTMLSelectElement
    expect(routine.disabled).toBe(true)
    expect(routine.value).toBe('r1')
  })

  it('without a live workout the routine can still be changed', () => {
    setup()
    open(); pickPhoto()
    expect((screen.getByLabelText('Routine') as HTMLSelectElement).disabled).toBe(false)
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

describe('the run part of the check-in (phase 1e-b)', () => {
  // Weeks start on Monday: week 2 runs from 5 to 11 October. Saturday the 10th (today) has the
  // interval run; Friday the 9th (yesterday) the easy run.
  const INTERVALS: Item[] = [{ zone: 'easy', min: 10 }, { repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] }, { zone: 'easy', min: 5 }]
  const sessions = (w: number, sat: Item[] = INTERVALS): Session[] => [
    { id: `w${w}-s1`, type: 'intervals', day: 6, blocks: sat },
    { id: `w${w}-s2`, type: 'easy', day: 5, blocks: [{ zone: 'easy', min: 30 }] },
  ]
  const planOf = (sat?: Item[]): RunPlan => ({
    version: 1, goal: '10k', goalType: 'finish', startDate: '2026-09-28', weekStart: 1,
    answers: { goal: '10k', goalType: 'finish', weeks: 2, reference: { kind: 'none' }, days: 2, longDay: 0 },
    vdotSource: null, dismissed: {},
    weeks: [{ index: 1, phase: 'build', recovery: false, sessions: sessions(1, sat) }, { index: 2, phase: 'build', recovery: false, sessions: sessions(2, sat) }],
  })
  const PLANNED = { week: 2, session: 'w2-s1', type: 'intervals', blocks: INTERVALS }
  const runSetup = (runPlan: RunPlan | null = planOf(), gallery = 'Choose from gallery') => {
    setup({ week: {}, runPlan }); open({ activity: 'run' })
    fireEvent.change(screen.getByLabelText(gallery), { target: { files: [photo()] } })
  }
  const duration = () => screen.getByLabelText('Duration (min)') as HTMLInputElement
  const sent = async () => { fireEvent.click(postButton()!); await settle(); return post.mock.calls[0][0] }
  const DIST_NOTE = 'Distance goes from 0.1 to 100 km, with two decimals at most.'

  it('opens on running when asked, with the day\'s workout instead of "Detail workout"', () => {
    runSetup()
    expect(radio('Running').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Interval run')).toBeTruthy()
    expect(screen.getByText('10 easy + 5 × (2 hard, 2 easy) + 5 easy')).toBeTruthy()
    expect(radio('Done as planned')).toBeTruthy()
    expect(radio('Adjust')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Detail workout' })).toBeNull()
    expect(screen.queryByText('Off the plan')).toBeNull()
  })

  it('also shows it when running is picked by hand on a strength day', () => {
    setup({ runPlan: planOf() })
    open(); pickPhoto()
    expect(radio('Strength training').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('Interval run')).toBeNull()
    fireEvent.click(radio('Running'))
    expect(screen.getByText('Interval run')).toBeTruthy()
    expect(screen.queryByLabelText('Routine')).toBeNull()
  })

  it('"Done as planned" links the run to a copy of the workout and fills an empty duration with its minutes', async () => {
    runSetup()
    expect(duration().value).toBe('')
    fireEvent.click(radio('Done as planned'))
    expect(duration().value).toBe('35')
    expect(titleField().value).toBe('Running · 35 min')
    const input = await sent()
    expect(input).toMatchObject({ day: '2026-10-10', activity: 'run', routineId: null, durationMin: 35 })
    expect(input.detail).toEqual({ run: { planned: PLANNED, status: 'as_planned' } })
    // A copy: the plan itself is not what went out.
    const plan = (useStore.getState().S as { runPlan: RunPlan }).runPlan
    expect((input.detail as { run: { planned: { blocks: Item[] } } }).run.planned.blocks).not.toBe(plan.weeks[1].sessions[0].blocks)
  })

  it('keeps a duration already typed, and never fills more than 600 minutes', () => {
    runSetup()
    fireEvent.change(duration(), { target: { value: '42' } })
    fireEvent.click(radio('Done as planned'))
    expect(duration().value).toBe('42')
    cleanup()
    runSetup(planOf([{ zone: 'easy', min: 300 }, { zone: 'easy', min: 300 }, { zone: 'easy', min: 100 }]))
    fireEvent.click(radio('Done as planned'))
    expect(duration().value).toBe('600')
    expect(postButton()!.disabled).toBe(false)
  })

  it('"Adjust" opens the workout\'s blocks, and a change posts as adjusted with the blocks run', async () => {
    runSetup()
    fireEvent.click(radio('Adjust'))
    const first = screen.getByRole('group', { name: 'Part 1' })
    expect((within(first).getByLabelText('Minutes') as HTMLInputElement).value).toBe('10')
    fireEvent.change(within(screen.getByRole('group', { name: 'Part 2.1' })).getByLabelText('Zone'), { target: { value: 'moderate' } })
    fireEvent.change(within(first).getByLabelText('Minutes'), { target: { value: '15' } })
    const input = await sent()
    expect(input.detail).toEqual({ run: { planned: PLANNED, status: 'adjusted', blocks: [
      { zone: 'easy', min: 15 }, { repeat: 5, blocks: [{ zone: 'moderate', min: 2 }, { zone: 'easy', min: 2 }] }, { zone: 'easy', min: 5 },
    ] } })
  })

  it('a block out of range says why and stops the post', () => {
    runSetup()
    fireEvent.click(radio('Adjust'))
    const minutes = within(screen.getByRole('group', { name: 'Part 3' })).getByLabelText('Minutes')
    fireEvent.change(minutes, { target: { value: '0' } })
    expect(screen.getByText('Minutes go from 1 to 300.')).toBeTruthy()
    expect(postButton()!.disabled).toBe(true)
    fireEvent.change(minutes, { target: { value: '301' } })
    expect(postButton()!.disabled).toBe(true)
    fireEvent.change(minutes, { target: { value: '5' } })
    expect(postButton()!.disabled).toBe(false)
    const repeats = within(screen.getByRole('group', { name: 'Part 2' })).getByLabelText('Repeats')
    fireEvent.change(repeats, { target: { value: '1' } })
    expect(screen.getByText('Repeats go from 2 to 20.')).toBeTruthy()
    expect(postButton()!.disabled).toBe(true)
    fireEvent.change(repeats, { target: { value: '21' } })
    expect(postButton()!.disabled).toBe(true)
    fireEvent.change(repeats, { target: { value: '6' } })
    expect(postButton()!.disabled).toBe(false)
  })

  it('without a workout that day: "Off the plan", and a distance posts as unplanned', async () => {
    runSetup(null)
    expect(screen.getByText('Off the plan')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Done as planned' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Distance (km)'), { target: { value: '5' } })
    expect((await sent()).detail).toEqual({ run: { status: 'unplanned', distance_km: 5 } })
  })

  it('off the plan with no distance and no effort, the run goes with no detail (Decision 3)', async () => {
    runSetup(null)
    expect((await sent()).detail).toBeNull()
  })

  it('on a plan day that was not linked, the run goes off the plan with its effort', async () => {
    runSetup()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: '6' }))
    expect((await sent()).detail).toEqual({ run: { status: 'unplanned', rpe: 6 } })
  })

  it('a distance the database would refuse says why and stops the post (Review Focus 2)', () => {
    runSetup()
    const field = screen.getByLabelText('Distance (km)')
    for (const text of ['0,05', '100,5', '6,255', 'abc']) {
      fireEvent.change(field, { target: { value: text } })
      expect(screen.getByText(DIST_NOTE), text).toBeTruthy()
      expect(postButton()!.disabled, text).toBe(true)
    }
    for (const text of ['6,25', '6.2', '']) {
      fireEvent.change(field, { target: { value: text } })
      expect(screen.queryByText(DIST_NOTE), text).toBeNull()
      expect(postButton()!.disabled, text).toBe(false)
    }
  })

  it('"Was it yesterday?" links the run to yesterday\'s workout (Review Focus 3)', async () => {
    runSetup()
    fireEvent.click(radio('Done as planned'))
    fireEvent.click(screen.getByRole('switch', { name: 'Was it yesterday?' }))
    expect(screen.getByText('Easy run')).toBeTruthy()
    expect(screen.queryByText('Interval run')).toBeNull()
    expect(radio('Done as planned').getAttribute('aria-checked')).toBe('true')
    const input = await sent()
    expect(input.day).toBe('2026-10-09')
    expect(input.detail).toEqual({ run: { planned: { week: 2, session: 'w2-s2', type: 'easy', blocks: [{ zone: 'easy', min: 30 }] }, status: 'as_planned' } })
  })

  it('"Was it yesterday?" refills a duration filled from the workout, but not one typed (R2 T4-M2)', async () => {
    runSetup()
    fireEvent.click(radio('Done as planned'))
    expect(duration().value).toBe('35')
    const day = screen.getByRole('switch', { name: 'Was it yesterday?' })
    fireEvent.click(day)
    expect(duration().value).toBe('30')
    fireEvent.click(day)
    expect(duration().value).toBe('35')
    fireEvent.click(day)
    const input = await sent()
    expect(input).toMatchObject({ day: '2026-10-09', durationMin: 30 })
    cleanup(); post.mockClear()
    runSetup()
    fireEvent.click(radio('Done as planned'))
    fireEvent.change(duration(), { target: { value: '41' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Was it yesterday?' }))
    expect(duration().value).toBe('41')
  })

  it('"Was it yesterday?" to a day with no workout clears the duration filled from the workout', () => {
    const plan = planOf()
    plan.weeks[1].sessions = plan.weeks[1].sessions.filter(s => s.day === 6)
    runSetup(plan)
    fireEvent.click(radio('Done as planned'))
    expect(duration().value).toBe('35')
    fireEvent.click(screen.getByRole('switch', { name: 'Was it yesterday?' }))
    expect(screen.getByText('Off the plan')).toBeTruthy()
    expect(duration().value).toBe('')
  })

  it('a wrong distance left behind by another activity does not block the post unseen (R2 T4-M1)', async () => {
    runSetup(null)
    fireEvent.change(screen.getByLabelText('Distance (km)'), { target: { value: 'abc' } })
    expect(postButton()!.disabled).toBe(true)
    fireEvent.click(radio('Cycling'))
    fireEvent.click(radio('Running'))
    expect((screen.getByLabelText('Distance (km)') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText(DIST_NOTE)).toBeNull()
    expect(postButton()!.disabled).toBe(false)
    expect((await sent()).detail).toBeNull()
  })

  it('a distance still being typed after its separator keeps the post off without a note (R2 T4-M3)', () => {
    runSetup(null)
    const field = screen.getByLabelText('Distance (km)')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '6,' } })
    expect(screen.queryByText(DIST_NOTE)).toBeNull()
    expect(postButton()!.disabled).toBe(true)
    fireEvent.change(field, { target: { value: '6,2' } })
    expect(postButton()!.disabled).toBe(false)
  })

  it('"Was it yesterday?" picked first links to yesterday\'s workout too', async () => {
    runSetup()
    fireEvent.click(screen.getByRole('switch', { name: 'Was it yesterday?' }))
    fireEvent.click(radio('Done as planned'))
    expect((await sent()).detail).toMatchObject({ run: { planned: { session: 'w2-s2' }, status: 'as_planned' } })
  })

  it('a run detail never goes with another activity', async () => {
    runSetup()
    fireEvent.click(radio('Done as planned'))
    fireEvent.click(radio('Cycling'))
    const input = await sent()
    expect(input).toMatchObject({ activity: 'bike', detail: null })
  })

  it('speaks the language of the app', async () => {
    await setLang('pt-BR')
    try {
      runSetup(planOf(), 'Escolher da galeria')
      expect(screen.getByRole('radio', { name: 'Fiz como planejado' })).toBeTruthy()
      expect(screen.getByRole('radio', { name: 'Ajustar' })).toBeTruthy()
      expect(screen.getByRole('radiogroup', { name: 'Esforço' })).toBeTruthy()
      fireEvent.change(screen.getByLabelText('Distância (km)'), { target: { value: 'abc' } })
      expect(screen.getByText('Distância de 0,1 a 100 km, até duas casas.')).toBeTruthy()
      cleanup()
      runSetup(null, 'Escolher da galeria')
      expect(screen.getByText('Fora do plano')).toBeTruthy()
    } finally { await setLang('en') }
  })
})
