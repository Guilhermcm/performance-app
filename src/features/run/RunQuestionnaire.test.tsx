// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./run-actions', async importOriginal => {
  const real = await importOriginal<typeof import('./run-actions')>()
  return { ...real, applyRunPlan: vi.fn(real.applyRunPlan) }
})

import { useStore } from '../../store/useStore.js'
import { applyRunPlan, calendarAnswers } from './run-actions'
import { checkAnswers } from './models'
import { predictMinutes, vdotFrom } from './vdot'
import RunQuestionnaire, { formatClock, parseClock } from './RunQuestionnaire'
import type { Answers } from './types'

type AnyState = Record<string, any>
const S = () => useStore.getState().S as AnyState
const setS = (patch: AnyState) => useStore.setState((s: AnyState) => ({ S: { ...s.S, ...patch }, user: null }))
const onOpenChange = vi.fn()

// Wednesday 14 October 2026; the week starts on Monday, so week 1 starts on 12 October.
const TODAY = '2026-10-14'

const show = (initial?: Answers) => render(<RunQuestionnaire open onOpenChange={onOpenChange} initial={initial} />)
const heading = () => screen.getByRole('heading', { level: 2 }).textContent
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const radio = (name: string | RegExp) => screen.getByRole('radio', { name }) as HTMLButtonElement
const next = () => fireEvent.click(button('Continue'))
const back = () => fireEvent.click(button('Back'))
const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement
const type = (label: string | RegExp, value: string) => fireEvent.change(field(label), { target: { value } })
const progress = () => screen.getByRole('progressbar').getAttribute('aria-label')

const T = {
  goal: 'What is your goal?',
  type: 'Finish it or beat a time?',
  deadline: 'When is the race?',
  reference: 'How is your running today?',
  days: 'When do you run?'
}

// From the goal to the reference step of a race goal, by number of weeks.
function toReference(goal: string, weeks: string) {
  fireEvent.click(radio(goal)); next()
  next()
  fireEvent.click(radio('Number of weeks'))
  type('Number of weeks', weeks); next()
}

const answers10k: Answers = {
  goal: '10k', goalType: 'finish', weeks: 12, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: 0
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T15:00:00'))
  onOpenChange.mockReset()
  vi.mocked(applyRunPlan).mockClear()
  setS({ week: {}, routines: [], weekStart: 1, runPlan: undefined })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('clock times', () => {
  it('reads h:mm:ss and m:ss and writes them back', () => {
    expect(parseClock('1:45:30')).toBe(105.5)
    expect(parseClock('25:30')).toBe(25.5)
    expect(parseClock(' 0:25:00 ')).toBe(25)
    for (const bad of ['', '25', '1:5', '1:60:00', '25:61', 'abc', '1:2:3:4']) expect(parseClock(bad)).toBeNull()
    expect(formatClock(105.5)).toBe('1:45:30')
    expect(formatClock(25.5)).toBe('25:30')
    expect(formatClock(59.999)).toBe('1:00:00')
  })
})

describe('RunQuestionnaire: steps', () => {
  it('walks the five steps of a race goal with back and continue, keeping the answers', () => {
    show()
    expect(heading()).toBe(T.goal)
    expect(progress()).toBe('Step 1 of 5')
    expect(button('Continue').disabled).toBe(true)
    fireEvent.click(radio('10 km')); next()
    expect(heading()).toBe(T.type)
    expect(progress()).toBe('Step 2 of 5')
    next()
    expect(heading()).toBe(T.deadline)
    fireEvent.click(radio('Number of weeks'))
    type('Number of weeks', '12'); next()
    expect(heading()).toBe(T.reference)
    fireEvent.click(radio('I run without stopping'))
    type('How many minutes?', '30'); next()
    expect(heading()).toBe(T.days)
    expect(progress()).toBe('Step 5 of 5')
    back()
    expect(heading()).toBe(T.reference)
    expect(field('How many minutes?').value).toBe('30')
    back(); back(); back()
    expect(heading()).toBe(T.goal)
    expect(radio('10 km').getAttribute('aria-checked')).toBe('true')
  })

  it('skips the goal type and the deadline for "stay in shape"', () => {
    show()
    fireEvent.click(radio('Stay in shape')); next()
    expect(heading()).toBe(T.reference)
    expect(progress()).toBe('Step 2 of 3')
    back()
    expect(heading()).toBe(T.goal)
  })

  it('skips the goal type and the deadline for "start running", which has no deadline', () => {
    show()
    fireEvent.click(radio('Start running')); next()
    expect(heading()).toBe(T.reference)
    expect(progress()).toBe('Step 2 of 3')
  })

  it('offers "I don\'t run yet" only to start running', () => {
    show()
    fireEvent.click(radio('Start running')); next()
    expect(radio("I don't run yet")).toBeTruthy()
    fireEvent.click(radio("I don't run yet"))
    expect(button('Continue').disabled).toBe(false)
    back()
    fireEvent.click(radio('5 km')); next(); next()
    fireEvent.click(radio('Number of weeks')); type('Number of weeks', '8'); next()
    expect(screen.queryByRole('radio', { name: "I don't run yet" })).toBeNull()
    // The answer given for start running does not carry over.
    expect(button('Continue').disabled).toBe(true)
  })
})

describe('RunQuestionnaire: goal type', () => {
  it('without a race reference, offers only finishing and explains when a time goal opens up', () => {
    show()
    fireEvent.click(radio('5 km')); next()
    expect(radio('Finish the race')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Beat a time' })).toBeNull()
    expect(screen.getByText(/opens up after a run with distance and time/)).toBeTruthy()
  })

  it('with a race reference, offers a target time in h:mm:ss', () => {
    show({ goal: '5k', goalType: 'finish', weeks: 10, reference: { kind: 'race', distanceM: 5000, minutes: 28, date: '2026-10-01' }, days: 3, longDay: 0 })
    next()
    expect(screen.queryByText(/opens up after a run/)).toBeNull()
    fireEvent.click(radio('Beat a time'))
    expect(button('Continue').disabled).toBe(true)
    type('Target time', '27')
    expect(screen.getByText('Enter a time from 3 min to 6 h, as h:mm:ss.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('Target time', '26:30')
    expect(button('Continue').disabled).toBe(false)
  })

  it('drops a time goal when the reference stops being a race', () => {
    show({ goal: '5k', goalType: 'time', targetMinutes: 27, weeks: 10, reference: { kind: 'race', distanceM: 5000, minutes: 28, date: '2026-10-01' }, days: 3, longDay: 0 })
    next(); next(); next()
    fireEvent.click(radio('I run without stopping'))
    type('How many minutes?', '30')
    back(); back()
    expect(heading()).toBe(T.type)
    expect(radio('Finish the race').getAttribute('aria-checked')).toBe('true')
  })
})

describe('RunQuestionnaire: deadline', () => {
  it('blocks a race date under 4 weeks or over 52 weeks from today and says why', () => {
    show()
    fireEvent.click(radio('10 km')); next(); next()
    expect(radio('Race date').getAttribute('aria-checked')).toBe('true')
    expect(button('Continue').disabled).toBe(true)
    type('Race date', '2026-11-10')
    expect(screen.getByText('Pick a date at least 4 weeks from today.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('Race date', '2027-10-14')
    expect(screen.getByText('Pick a date up to 52 weeks from today.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('Race date', '2027-10-13')
    expect(screen.queryByText(/Pick a date/)).toBeNull()
    expect(button('Continue').disabled).toBe(false)
  })

  it('blocks a number of weeks outside 4 to 52', () => {
    show()
    fireEvent.click(radio('10 km')); next(); next()
    fireEvent.click(radio('Number of weeks'))
    type('Number of weeks', '53')
    expect(screen.getByText('Enter between 4 and 52 weeks.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('Number of weeks', '3')
    expect(button('Continue').disabled).toBe(true)
    type('Number of weeks', '20')
    expect(button('Continue').disabled).toBe(false)
  })

  it('too short with room to finish: offers the minimum deadline with the new date, or finishing', () => {
    show()
    fireEvent.click(radio('10 km')); next(); next()
    // Week 1 starts on 12 October; the race week is the 7th.
    type('Race date', '2026-11-29')
    expect(screen.getByText('This plan needs at least 10 weeks.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    const shorter = button('Just finish the race, with a shorter plan')
    expect(shorter).toBeTruthy()
    fireEvent.click(button(/^Use the minimum: /))
    expect(field('Race date').value).toBe('2026-12-20')
    expect(calendarAnswers({ ...answers10k, weeks: undefined, raceDate: '2026-12-20' }, TODAY, 1).weeks).toBe(10)
    expect(screen.queryByText('This plan needs at least 10 weeks.')).toBeNull()
    expect(button('Continue').disabled).toBe(false)
  })

  it('too short: choosing to finish keeps the date and moves on with a finish goal', () => {
    show()
    fireEvent.click(radio('10 km')); next(); next()
    fireEvent.click(radio('Number of weeks'))
    type('Number of weeks', '7')
    fireEvent.click(button('Just finish the race, with a shorter plan'))
    expect(screen.getByText('Shorter plan, to finish the race.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(false)
    next()
    fireEvent.click(radio('I run without stopping')); type('How many minutes?', '30'); next()
    fireEvent.click(button('Create plan'))
    expect(vi.mocked(applyRunPlan).mock.calls[0][1]).toEqual({ goal: '10k', goalType: 'finish', weeks: 7, reference: { kind: 'continuous', minutes: 30 }, days: 3, longDay: 0 })
  })

  it('too short with no room to finish: offers only the minimum deadline', () => {
    show()
    fireEvent.click(radio('10 km')); next(); next()
    fireEvent.click(radio('Number of weeks'))
    type('Number of weeks', '5')
    expect(screen.getByText('This plan needs at least 10 weeks.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /shorter plan/ })).toBeNull()
    fireEvent.click(button('Use the minimum: 10 weeks'))
    expect(field('Number of weeks').value).toBe('10')
    expect(button('Continue').disabled).toBe(false)
  })
})

describe('RunQuestionnaire: today', () => {
  it('validates a race reference inline: distance, time, a future date and a pace slower than 20 min/km', () => {
    show()
    toReference('10 km', '12')
    fireEvent.click(radio('I have a recent time'))
    expect(button('Continue').disabled).toBe(true)
    type('Distance (km)', '50')
    expect(screen.getByText('Enter a distance from 1 to 42.195 km.')).toBeTruthy()
    type('Distance (km)', '5')
    type('Time', '1:45:00')
    type('Date', '2026-10-01')
    expect(screen.getByText('That is 21:00 per km. Check the distance and the time.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('Time', '28:00')
    expect(screen.queryByText(/per km/)).toBeNull()
    type('Date', '2026-10-15')
    expect(screen.getByText('The date cannot be in the future.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('Date', '2026-10-14')
    expect(button('Continue').disabled).toBe(false)
  })

  it('reads a decimal comma in the distance', () => {
    show()
    toReference('Half marathon', '16')
    fireEvent.click(radio('I have a recent time'))
    type('Distance (km)', '21,0975'); type('Time', '2:05:00'); type('Date', '2026-10-01')
    next(); fireEvent.click(button('Create plan'))
    expect(vi.mocked(applyRunPlan).mock.calls[0][1].reference).toEqual({ kind: 'race', distanceM: 21097.5, minutes: 125, date: '2026-10-01' })
  })

  it('a reference older than 3 months asks for another or to go on without pace', () => {
    show()
    toReference('10 km', '12')
    fireEvent.click(radio('I have a recent time'))
    type('Distance (km)', '10'); type('Time', '55:00'); type('Date', '2026-07-13')
    expect(screen.getByText(/more than 3 months old/)).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    fireEvent.click(button('Enter another'))
    for (const label of ['Distance (km)', 'Time', 'Date']) expect(field(label).value).toBe('')
    type('Distance (km)', '10'); type('Time', '55:00'); type('Date', '2026-07-13')
    fireEvent.click(button('Go on without pace'))
    expect(screen.getByText('No pace: the plan goes by feel.')).toBeTruthy()
    next(); fireEvent.click(button('Create plan'))
    expect(vi.mocked(applyRunPlan).mock.calls[0][1].reference).toEqual({ kind: 'none' })
  })

  it('a target out of reach shows today\'s pace and offers the possible time', () => {
    const initial: Answers = { goal: '5k', goalType: 'time', targetMinutes: 20, weeks: 8, reference: { kind: 'race', distanceM: 5000, minutes: 30, date: '2026-10-01' }, days: 3, longDay: 0 }
    const result = checkAnswers(calendarAnswers(initial, TODAY, 1), TODAY)
    expect(result).toMatchObject({ ok: false, reason: 'time_out_of_reach' })
    const possible = (result as { possibleMinutes: number }).possibleMinutes
    show(initial)
    next(); next(); next()
    expect(heading()).toBe(T.reference)
    expect(screen.getByText(`Your pace today gives about ${formatClock(predictMinutes(vdotFrom(5000, 30), 5000))}.`)).toBeTruthy()
    expect(screen.getByText(`By race day, about ${formatClock(possible)} is within reach.`)).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    fireEvent.click(button(`Use ${formatClock(possible)}`))
    expect(screen.queryByText(/Your pace today/)).toBeNull()
    next(); fireEvent.click(button('Redo plan')); fireEvent.click(button('Replace'))
    const used = vi.mocked(applyRunPlan).mock.calls[0][1]
    expect(used.goalType).toBe('time')
    expect(formatClock(used.targetMinutes!)).toBe(formatClock(possible))
    expect(checkAnswers(calendarAnswers(used, TODAY, 1), TODAY).ok).toBe(true)
  })

  it('suggests 5 km or staying in shape to someone who already runs 40 minutes, without blocking', () => {
    show()
    fireEvent.click(radio('Start running')); next()
    fireEvent.click(radio('I run without stopping'))
    type('How many minutes?', '39')
    expect(screen.queryByText(/may suit you better/)).toBeNull()
    type('How many minutes?', '40')
    expect(screen.getByText(/You already run 40 minutes without stopping/)).toBeTruthy()
    expect(button('Continue').disabled).toBe(false)
  })

  it('takes 1 to 180 continuous minutes', () => {
    show()
    fireEvent.click(radio('Stay in shape')); next()
    fireEvent.click(radio('I run without stopping'))
    type('How many minutes?', '181')
    expect(screen.getByText('Enter from 1 to 180 minutes.')).toBeTruthy()
    expect(button('Continue').disabled).toBe(true)
    type('How many minutes?', '180')
    expect(button('Continue').disabled).toBe(false)
  })
})

describe('RunQuestionnaire: days and creating', () => {
  it('offers only the days the goal allows', () => {
    show()
    toReference('10 km', '12')
    fireEvent.click(radio('I run without stopping')); type('How many minutes?', '30'); next()
    const days = within(screen.getByRole('radiogroup', { name: 'Runs per week' }))
    expect(days.getAllByRole('radio').map(r => r.textContent)).toEqual(['3', '4'])
    cleanup()
    show()
    toReference('5 km', '8')
    fireEvent.click(radio('I run without stopping')); type('How many minutes?', '30'); next()
    expect(within(screen.getByRole('radiogroup', { name: 'Runs per week' })).getAllByRole('radio').map(r => r.textContent)).toEqual(['2', '3', '4'])
  })

  it('lists the long run days in the order of the person\'s week', () => {
    setS({ weekStart: 0 })
    show()
    fireEvent.click(radio('Stay in shape')); next()
    fireEvent.click(radio('I run without stopping')); type('How many minutes?', '30'); next()
    const longDay = within(screen.getByRole('radiogroup', { name: 'Long run day' }))
    expect(longDay.getAllByRole('radio').map(r => r.getAttribute('aria-label'))).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  it('creates the plan with applyRunPlan inside update, shows a preview and closes', () => {
    show()
    toReference('10 km', '12')
    fireEvent.click(radio('I run without stopping')); type('How many minutes?', '30'); next()
    fireEvent.click(radio('4'))
    fireEvent.click(radio('Saturday'))
    expect(screen.getByText('12 weeks')).toBeTruthy()
    expect(screen.getByText('First week')).toBeTruthy()
    fireEvent.click(button('Create plan'))
    const expected: Answers = { goal: '10k', goalType: 'finish', weeks: 12, reference: { kind: 'continuous', minutes: 30 }, days: 4, longDay: 6 }
    expect(applyRunPlan).toHaveBeenCalledTimes(1)
    expect(vi.mocked(applyRunPlan).mock.calls[0].slice(1)).toEqual([expected, TODAY])
    expect(S().runPlan.answers).toEqual(expected)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('with earlier answers, fills the fields and asks before replacing the plan', () => {
    const initial: Answers = { goal: '10k', goalType: 'time', targetMinutes: 50, raceDate: '2027-01-24', reference: { kind: 'race', distanceM: 10000, minutes: 52, date: '2026-09-20' }, days: 4, longDay: 6 }
    show(initial)
    expect(radio('10 km').getAttribute('aria-checked')).toBe('true')
    next()
    expect(radio('Beat a time').getAttribute('aria-checked')).toBe('true')
    expect(field('Target time').value).toBe('50:00')
    next()
    expect(field('Race date').value).toBe('2027-01-24')
    next()
    expect(radio('I have a recent time').getAttribute('aria-checked')).toBe('true')
    expect(field('Distance (km)').value).toBe('10')
    expect(field('Time').value).toBe('52:00')
    expect(field('Date').value).toBe('2026-09-20')
    next()
    expect(radio('4').getAttribute('aria-checked')).toBe('true')
    expect(radio('Saturday').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(button('Redo plan'))
    expect(applyRunPlan).not.toHaveBeenCalled()
    expect(screen.getByText('Replace your current running plan?')).toBeTruthy()
    fireEvent.click(button('Cancel'))
    expect(screen.queryByText('Replace your current running plan?')).toBeNull()
    expect(applyRunPlan).not.toHaveBeenCalled()
    fireEvent.click(button('Redo plan'))
    fireEvent.click(button('Replace'))
    expect(vi.mocked(applyRunPlan).mock.calls[0][1]).toEqual(initial)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
