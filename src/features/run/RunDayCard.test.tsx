// @vitest-environment happy-dom
// The run card of a day in the Plan's week schedule (spec §6.4): the workout's name, its blocks in
// one line, the pace ranges (or how each zone feels without a VDOT), the fit warning against the
// strength week as it is now, and "Change day" with the warnings a move would bring.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import { useStore } from '../../store/useStore.js'
import RunDayCard, { weekDayIso } from './RunDayCard'
import { useCheckinFlow } from '../checkin/open-checkin'
import { setLang } from '../../lib/i18n.js'
import { formatPaceRange, zonePaces } from './vdot'
import type { RunLog } from './run-log'
import type { RunPlan, Session } from './types'

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))

// Wednesday 14 October 2026. With the week on Monday, this week runs from 12 to 18 October.
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SUN = 0
const LEGS = { id: 'legs', name: 'Legs', emoji: null, ex: [{ id: 'x-squat', sets: 6, bp: 'upper legs' }] }

const easy = (min: number) => ({ zone: 'easy' as const, min })
const intervals = (day: number): Session => ({ id: 'w1-s2', type: 'intervals', day, blocks: [easy(10), { repeat: 4, blocks: [{ zone: 'hard', min: 4 }] }, easy(10)] })
const tempo = (day: number): Session => ({ id: 'w1-s3', type: 'tempo', day, blocks: [easy(10), { zone: 'moderate', min: 20 }, easy(5)] })
const long = (day: number): Session => ({ id: 'w1-s1', type: 'long', day, blocks: [easy(50)] })

function planWith(sessions: Session[], over: Partial<RunPlan> = {}): RunPlan {
  return {
    version: 1, goal: '10k', goalType: 'finish', startDate: '2026-10-12',
    answers: { goal: '10k', goalType: 'finish', weeks: 10, reference: { kind: 'race', distanceM: 5000, minutes: 25, date: '2026-10-01' }, days: 3, longDay: SUN },
    vdot: 38.3, vdotSource: 'race', vdotDate: '2026-10-01',
    weeks: [
      { index: 1, phase: 'build', recovery: false, sessions },
      { index: 2, phase: 'build', recovery: false, sessions: sessions.map(s => ({ ...s, id: s.id.replace('w1', 'w2') })) },
    ],
    dismissed: {},
    ...over,
  }
}

const card = (day: number) => render(<RunDayCard day={day} iso={weekDayIso('2026-10-14', 1, day)} />)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T15:00:00'))
  setS({ week: {}, routines: [LEGS], weekStart: 1, runPlan: planWith([long(SUN), intervals(WED), tempo(FRI)]) })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('weekDayIso', () => {
  it('gives the date of a weekday in the week of today, for both week starts', () => {
    expect(weekDayIso('2026-10-14', 1, SUN)).toBe('2026-10-18')
    expect(weekDayIso('2026-10-14', 0, SUN)).toBe('2026-10-11')
    expect(weekDayIso('2026-10-18', 1, MON)).toBe('2026-10-12')
    expect(weekDayIso('2026-10-18', 0, MON)).toBe('2026-10-19')
  })
})

describe('RunDayCard', () => {
  it('shows the workout name, its blocks in one line and the pace ranges of its zones', () => {
    card(WED)
    expect(screen.getByRole('heading', { name: 'Interval run' })).toBeTruthy()
    expect(screen.getByText('10 easy + 4 × 4 hard + 10 easy')).toBeTruthy()
    const paces = zonePaces(38.3)
    expect(screen.getByText(formatPaceRange(paces.easy))).toBeTruthy()
    expect(screen.getByText(formatPaceRange(paces.hard))).toBeTruthy()
    expect(screen.queryByText(formatPaceRange(paces.moderate))).toBeNull()
    expect(screen.getByText('36 min')).toBeTruthy()
  })

  it('without a VDOT shows only how each zone feels', () => {
    setS({ runPlan: planWith([long(SUN), intervals(WED), tempo(FRI)], { vdot: undefined, vdotSource: null, vdotDate: undefined }) })
    card(WED)
    expect(screen.getByText('you can hold a conversation')).toBeTruthy()
    expect(screen.getByText('only a few words')).toBeTruthy()
    expect(document.body.textContent).not.toContain('/km')
  })

  it('renders nothing on a day without a run', () => {
    const { container } = card(MON)
    expect(container.textContent).toBe('')
  })

  it('warns in words when the strength week of now breaks a fit rule', () => {
    card(WED)
    expect(screen.queryByText('Interval run the day after leg day')).toBeNull()
    cleanup()
    // Legs moved to Tuesday after the plan was fitted: the warning is live, not stored.
    setS({ week: { [TUE]: ['legs'] } })
    card(WED)
    expect(screen.getByText('Interval run the day after leg day')).toBeTruthy()
  })

  it('reads an old strength week with a bare routine id', () => {
    setS({ week: { [TUE]: 'legs' } })
    card(WED)
    expect(screen.getByText('Interval run the day after leg day')).toBeTruthy()
  })

  it('moves a run to another day of this week from today on, with the warning before the move', () => {
    card(WED)
    fireEvent.click(screen.getByRole('button', { name: 'Change day: Interval run' }))
    const dialog = screen.getByRole('dialog')
    const options = within(dialog).getAllByRole('button').filter(b => b.dataset.day != null)
    // Today is Wednesday: Thursday to Sunday, in the order the week is shown; not the day it is on.
    expect(options.map(b => b.dataset.day)).toEqual([String(THU), String(FRI), '6', String(SUN)])
    // Thursday sits right before the tempo run on Friday.
    expect(within(options[0]).getByText('Two hard days in a row')).toBeTruthy()
    expect(within(options[3]).queryByText('Two hard days in a row')).toBeNull()
    fireEvent.click(options[0])
    expect(screen.queryByRole('dialog')).toBeNull()
    const week1 = S().runPlan.weeks[0].sessions as Session[]
    expect(week1.find(s => s.id === 'w1-s2')!.day).toBe(THU)
    // Only this week changes.
    expect((S().runPlan.weeks[1].sessions as Session[]).find(s => s.id === 'w2-s2')!.day).toBe(WED)
    cleanup()
    // After the move every session's warnings are recomputed: the tempo run now follows a hard day.
    card(FRI)
    expect(screen.getByText('Two hard days in a row')).toBeTruthy()
  })

  it('has no "Change day" when no other day is left this week', () => {
    vi.setSystemTime(new Date('2026-10-18T15:00:00'))
    render(<RunDayCard day={SUN} iso="2026-10-18" />)
    expect(screen.getByRole('heading', { name: 'Long run' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Change day/ })).toBeNull()
  })

  it('on today\'s card offers "Log run", which opens the check-in on running', () => {
    useCheckinFlow.setState({ open: false, opts: {} })
    card(WED)
    fireEvent.click(screen.getByRole('button', { name: 'Log run' }))
    expect(useCheckinFlow.getState()).toMatchObject({ open: true, opts: { activity: 'run' } })
    useCheckinFlow.setState({ open: false, opts: {} })
  })

  it('says "Log run" in the language of the app', async () => {
    await setLang('pt-BR')
    try {
      card(WED)
      expect(screen.getByRole('button', { name: 'Registrar corrida' })).toBeTruthy()
    } finally { await setLang('en') }
  })

  it('has no "Log run" on another day', () => {
    card(FRI)
    expect(screen.getByRole('heading', { name: 'Tempo run' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Log run' })).toBeNull()
  })

  it('maps dates with the week start the plan was made with, not the one of now (R2 M4-2)', () => {
    // Made with Monday weeks: Sunday the 18th is week 1's long run. The person now starts weeks on Sunday.
    setS({ weekStart: 0, runPlan: { ...planWith([long(SUN), intervals(WED), tempo(FRI)]), weekStart: 1 } })
    render(<RunDayCard day={SUN} iso="2026-10-18" />)
    expect(screen.getByRole('heading', { name: 'Long run' })).toBeTruthy()
    cleanup()
    // Change day offers the rest of the plan's week (to Sunday the 18th), not the Sunday week.
    render(<RunDayCard day={WED} iso="2026-10-14" />)
    fireEvent.click(screen.getByRole('button', { name: 'Change day: Interval run' }))
    const options = within(screen.getByRole('dialog')).getAllByRole('button').filter(b => b.dataset.day != null)
    expect(options.map(b => b.dataset.day)).toEqual([String(THU), String(FRI), '6', String(SUN)])
  })
})


describe('RunDayCard: workouts done (spec §8.1)', () => {
  const log = (id: string, day: string, run: RunLog['run'] = null): RunLog => ({ id, day, duration_min: 30, run })
  const cardWith = (day: number, logs: RunLog[]) => render(<RunDayCard day={day} iso={weekDayIso('2026-10-14', 1, day)} logs={logs} />)
  afterEach(async () => { await setLang('en') })

  it('marks a workout done with an icon and the word, by its link or by its day', () => {
    // An unlinked run on Monday counts for nothing; one on Wednesday counts for the intervals.
    cardWith(WED, [log('a', '2026-10-12'), log('b', '2026-10-14')])
    const done = screen.getByText('Run done')
    expect(done.closest('[data-slot="run-done"]')!.querySelector('svg')).toBeTruthy()
    cleanup()
    // The tempo of Friday, run on Tuesday and linked to it.
    cardWith(FRI, [log('c', '2026-10-13', { planned: { week: 1, session: 'w1-s3', type: 'tempo', blocks: [easy(30)] }, status: 'as_planned' })])
    expect(screen.getByText('Run done')).toBeTruthy()
  })

  it('shows nothing for a workout not done yet, or without the logs', () => {
    cardWith(WED, [log('a', '2026-10-12')])
    expect(screen.queryByText('Run done')).toBeNull()
    cleanup()
    card(WED)
    expect(screen.queryByText('Run done')).toBeNull()
  })

  it('says "Feito" in pt-BR', async () => {
    await setLang('pt-BR')
    cardWith(WED, [log('b', '2026-10-14')])
    expect(screen.getByText('Feito')).toBeTruthy()
  })
})

describe('RunDayCard on race week (final review I1 and M6)', () => {
  // The race is on Sunday the 18th, the last day of this Monday week.
  const raceWeek = (sessions: Session[], over: Partial<RunPlan> = {}) =>
    setS({ runPlan: planWith(sessions, { raceDate: '2026-10-18', answers: { ...planWith([]).answers, weeks: undefined, raceDate: '2026-10-18' }, ...over }) })

  it('marks race day with the distance, and no run', () => {
    raceWeek([long(MON), intervals(WED), tempo(FRI)])
    card(SUN)
    expect(screen.getByRole('heading', { name: 'Race day' })).toBeTruthy()
    expect(screen.getByText('10 km')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Long run' })).toBeNull()
  })

  it('marks race day of a half marathon too, but nothing for a plan without a race', () => {
    raceWeek([long(MON), intervals(WED), tempo(FRI)], { goal: 'half' })
    card(SUN)
    expect(screen.getByText('Half marathon')).toBeTruthy()
    cleanup()
    raceWeek([long(MON), intervals(WED), tempo(FRI)], { goal: 'start' })
    const { container } = card(SUN)
    expect(container.textContent).toBe('')
  })

  it('counts race day as a hard day: a quality run the day before it is warned about', () => {
    raceWeek([long(MON), intervals(WED), tempo(6)])
    card(6)
    expect(screen.getByText('Two hard days in a row')).toBeTruthy()
  })

  it('offers only days before the race, with the warning for the day before', () => {
    raceWeek([long(MON), intervals(WED), tempo(FRI)])
    card(FRI)
    fireEvent.click(screen.getByRole('button', { name: 'Change day: Tempo run' }))
    const options = within(screen.getByRole('dialog')).getAllByRole('button').filter(b => b.dataset.day != null)
    // Today is Wednesday: Wednesday, Thursday and Saturday; not Friday (it is on it), not Sunday (the race).
    expect(options.map(b => b.dataset.day)).toEqual([String(WED), String(THU), '6'])
    expect(within(options[2]).getByText('Two hard days in a row')).toBeTruthy()
  })
})
