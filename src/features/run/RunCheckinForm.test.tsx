// @vitest-environment happy-dom
// The run part of the check-in (spec §7.1, plan decisions 1 to 3): the planned workout with "Done
// as planned" and "Adjust", or "Off the plan"; the distance and the effort.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import RunCheckinForm, { relinkRun } from './RunCheckinForm'
import { checkRunDetail, type RunDetail, type RunPlanned } from './run-detail'
import { setLang } from '../../lib/i18n.js'

const PLANNED: RunPlanned = {
  week: 2, session: 'w2-s1', type: 'intervals',
  blocks: [{ zone: 'easy', min: 10 }, { repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] }, { zone: 'easy', min: 5 }],
}
const YESTERDAY: RunPlanned = { week: 2, session: 'w2-s2', type: 'easy', blocks: [{ zone: 'easy', min: 30 }] }

const seen = vi.fn()
const minutes = vi.fn()
function Harness({ planned = PLANNED as RunPlanned | null, value = null as RunDetail | null }) {
  const [run, setRun] = useState(value)
  return <RunCheckinForm planned={planned} value={run} onChange={v => { seen(v); setRun(v) }} onPlannedMinutes={minutes} />
}
const last = () => seen.mock.calls.at(-1)![0] as RunDetail | null
const radio = (name: string) => screen.getByRole('radio', { name })
const distance = () => screen.getByLabelText('Distance (km)') as HTMLInputElement
const DIST_NOTE = 'Distance goes from 0.1 to 100 km, with two decimals at most.'

afterEach(() => { cleanup(); seen.mockReset(); minutes.mockReset() })

describe('RunCheckinForm with a planned workout', () => {
  it('shows the workout type and its blocks in one line, with "Done as planned" and "Adjust", neither on', () => {
    render(<Harness />)
    expect(screen.getByText('Interval run')).toBeTruthy()
    expect(screen.getByText('10 easy + 5 × (2 hard, 2 easy) + 5 easy')).toBeTruthy()
    expect(radio('Done as planned').getAttribute('aria-checked')).toBe('false')
    expect(radio('Adjust').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Off the plan')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Part 1' })).toBeNull()
  })

  it('"Done as planned" links the run to a copy of the workout and gives its minutes', () => {
    render(<Harness />)
    fireEvent.click(radio('Done as planned'))
    expect(last()).toEqual({ planned: PLANNED, status: 'as_planned' })
    expect(last()!.planned).not.toBe(PLANNED)
    expect(minutes).toHaveBeenCalledWith(35)
    expect(checkRunDetail(last(), 'run')).toBe(true)
    // Tapped again, the link goes; with nothing else there is nothing to send.
    fireEvent.click(radio('Done as planned'))
    expect(last()).toBeNull()
  })

  it('"Adjust" opens the workout\'s blocks; a change goes out as adjusted with the blocks run', () => {
    render(<Harness />)
    fireEvent.click(radio('Adjust'))
    expect(last()).toEqual({ planned: PLANNED, blocks: PLANNED.blocks, status: 'adjusted' })
    expect(minutes).not.toHaveBeenCalled()
    fireEvent.change(within(screen.getByRole('group', { name: 'Part 2.1' })).getByLabelText('Zone'), { target: { value: 'moderate' } })
    fireEvent.change(within(screen.getByRole('group', { name: 'Part 2.1' })).getByLabelText('Minutes'), { target: { value: '3' } })
    expect(last()).toEqual({
      planned: PLANNED, status: 'adjusted',
      blocks: [{ zone: 'easy', min: 10 }, { repeat: 5, blocks: [{ zone: 'moderate', min: 3 }, { zone: 'easy', min: 2 }] }, { zone: 'easy', min: 5 }],
    })
    expect(checkRunDetail(last(), 'run')).toBe(true)
    // The plan's copy stays as the plan had it.
    expect(PLANNED.blocks[1]).toEqual({ repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] })
    // Back to as planned: no blocks.
    fireEvent.click(radio('Done as planned'))
    expect(last()).toEqual({ planned: PLANNED, status: 'as_planned' })
    expect(screen.queryByRole('group', { name: 'Part 1' })).toBeNull()
  })

  it('a block out of range goes out as something the check refuses', () => {
    render(<Harness />)
    fireEvent.click(radio('Adjust'))
    fireEvent.change(within(screen.getByRole('group', { name: 'Part 1' })).getByLabelText('Minutes'), { target: { value: '301' } })
    expect(screen.getByText('Minutes go from 1 to 300.')).toBeTruthy()
    expect(checkRunDetail(last(), 'run')).toBe(false)
    fireEvent.change(within(screen.getByRole('group', { name: 'Part 2' })).getByLabelText('Repeats'), { target: { value: '21' } })
    expect(screen.getByText('Repeats go from 2 to 20.')).toBeTruthy()
    expect(checkRunDetail(last(), 'run')).toBe(false)
  })

  it('keeps the distance and the effort with the link', () => {
    render(<Harness />)
    fireEvent.change(distance(), { target: { value: '6,2' } })
    fireEvent.click(radio('7'))
    fireEvent.click(radio('Done as planned'))
    expect(last()).toEqual({ planned: PLANNED, status: 'as_planned', distance_km: 6.2, rpe: 7 })
    // Unlinked, it is a run off the plan with what was typed.
    fireEvent.click(radio('Done as planned'))
    expect(last()).toEqual({ status: 'unplanned', distance_km: 6.2, rpe: 7 })
  })
})

describe('RunCheckinForm without a planned workout', () => {
  it('says "Off the plan" and sends nothing until a distance or an effort is given', () => {
    render(<Harness planned={null} />)
    expect(screen.getByText('Off the plan')).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Done as planned' })).toBeNull()
    fireEvent.change(distance(), { target: { value: '5' } })
    expect(last()).toEqual({ status: 'unplanned', distance_km: 5 })
    fireEvent.change(distance(), { target: { value: '' } })
    expect(last()).toBeNull()
    fireEvent.click(radio('8'))
    expect(last()).toEqual({ status: 'unplanned', rpe: 8 })
    // Tapped again, the effort goes.
    fireEvent.click(radio('8'))
    expect(last()).toBeNull()
  })

  it('takes the distances parseKm takes, and says why the others are wrong (Review Focus 2)', () => {
    render(<Harness planned={null} />)
    for (const [text, km] of [['6,25', 6.25], ['6.2', 6.2], ['0,1', 0.1], ['100', 100], [' 12,34 ', 12.34]] as const) {
      fireEvent.change(distance(), { target: { value: text } })
      expect(last(), text).toEqual({ status: 'unplanned', distance_km: km })
      expect(checkRunDetail(last(), 'run'), text).toBe(true)
      expect(screen.queryByText(DIST_NOTE), text).toBeNull()
      expect(distance().hasAttribute('aria-invalid')).toBe(false)
    }
    for (const text of ['0,05', '100,5', '6,255', 'abc', '6,', '-1']) {
      fireEvent.change(distance(), { target: { value: text } })
      expect(screen.getByText(DIST_NOTE), text).toBeTruthy()
      expect(distance().getAttribute('aria-invalid')).toBe('true')
      // Never something the database refuses: what goes out fails the same check.
      expect(last(), text).not.toBeNull()
      expect(checkRunDetail(last(), 'run'), text).toBe(false)
    }
    fireEvent.change(distance(), { target: { value: '' } })
    expect(screen.queryByText(DIST_NOTE)).toBeNull()
    expect(last()).toBeNull()
  })

  it('has the effort from 1 to 10 in a radio group named "Effort"', () => {
    render(<Harness planned={null} />)
    const group = screen.getByRole('radiogroup', { name: 'Effort' })
    expect(within(group).getAllByRole('radio').map(r => r.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    fireEvent.click(within(group).getByRole('radio', { name: '10' }))
    expect(last()).toEqual({ status: 'unplanned', rpe: 10 })
    expect(within(group).getByRole('radio', { name: '10' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('RunCheckinForm on an edit', () => {
  it('opens with what was saved: the link, the distance in the language and the effort', async () => {
    await setLang('pt-BR')
    try {
      render(<Harness value={{ planned: PLANNED, status: 'as_planned', distance_km: 6.2, rpe: 7 }} />)
      expect(radio('Fiz como planejado').getAttribute('aria-checked')).toBe('true')
      expect((screen.getByLabelText('Distância (km)') as HTMLInputElement).value).toBe('6,2')
      expect(within(screen.getByRole('radiogroup', { name: 'Esforço' })).getByRole('radio', { name: '7' }).getAttribute('aria-checked')).toBe('true')
      fireEvent.change(screen.getByLabelText('Distância (km)'), { target: { value: '6,255' } })
      expect(screen.getByText('Distância de 0,1 a 100 km, até duas casas.')).toBeTruthy()
    } finally { await setLang('en') }
  })

  it('opens an adjusted run with the blocks that were run', () => {
    const blocks = [{ zone: 'moderate' as const, min: 40 }]
    render(<Harness value={{ planned: PLANNED, blocks, status: 'adjusted' }} />)
    expect(radio('Adjust').getAttribute('aria-checked')).toBe('true')
    expect((within(screen.getByRole('group', { name: 'Part 1' })).getByLabelText('Minutes') as HTMLInputElement).value).toBe('40')
  })
})

describe('relinkRun ("Was it yesterday?")', () => {
  it('moves a linked run to the other day\'s workout, keeping how it went', () => {
    expect(relinkRun({ planned: PLANNED, status: 'as_planned', distance_km: 5 }, YESTERDAY))
      .toEqual({ planned: YESTERDAY, status: 'as_planned', distance_km: 5 })
    // Blocks adjusted for one workout say nothing about another: they start from the new one.
    expect(relinkRun({ planned: PLANNED, blocks: [{ zone: 'easy', min: 40 }], status: 'adjusted', rpe: 6 }, YESTERDAY))
      .toEqual({ planned: YESTERDAY, blocks: [{ zone: 'easy', min: 30 }], status: 'adjusted', rpe: 6 })
  })

  it('without a workout that day, a linked run goes off the plan, or to nothing', () => {
    expect(relinkRun({ planned: PLANNED, status: 'as_planned', rpe: 6 }, null)).toEqual({ status: 'unplanned', rpe: 6 })
    expect(relinkRun({ planned: PLANNED, status: 'as_planned' }, null)).toBeNull()
  })

  it('leaves a run that was not linked as it is', () => {
    expect(relinkRun({ status: 'unplanned', distance_km: 5 }, YESTERDAY)).toEqual({ status: 'unplanned', distance_km: 5 })
    expect(relinkRun(null, YESTERDAY)).toBeNull()
  })
})
