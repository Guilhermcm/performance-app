// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../../lib/i18n.js'
import { shiftDay } from '../nutrition/days'
import { bedtimeDescription, bedtimeSeries, deviationText, durationDescription, durationSeries, durationState, type DurationPoint } from './chart-data'
import { logOf, nightOf, targetOf } from './test-sleep'

// Friday 30 October 2026: the 30 days run from 1 October.
const TODAY = '2026-10-30'

afterEach(async () => { await setLang('en') })

describe('durationSeries', () => {
  it('has one item per day for the last 30 days, null where nothing was logged', () => {
    const closed = [
      nightOf({ night: '2026-10-01', duration_min: 470, on_target: true }),
      nightOf({ night: '2026-10-10', logged: false, on_target: false, duration_min: null, bed_time: null, wake_time: null }),
      nightOf({ night: '2026-10-20', duration_min: 400, on_target: false }),
    ]
    const logs = { [TODAY]: logOf({ night: TODAY, bed_time: '23:10', wake_time: '07:00', duration_min: 470 }) }
    const s = durationSeries(closed, logs, [targetOf()], TODAY)
    expect(s).toHaveLength(30)
    expect(s[0].night).toBe('2026-10-01')
    expect(s[29].night).toBe(TODAY)
    expect(s[0]).toEqual({ night: '2026-10-01', duration: 470, goal: 480, onTarget: true, open: false })
    // A closed night without a log, and a day with nothing at all, are both empty.
    expect(s[9]).toMatchObject({ night: '2026-10-10', duration: null, onTarget: false })
    expect(s[4]).toMatchObject({ night: '2026-10-05', duration: null, goal: 480, onTarget: false })
    expect(s[19]).toMatchObject({ duration: 400, onTarget: false })
    // Today's open night is judged by the goal in force, as a preview, and stays to confirm.
    expect(s[29]).toEqual({ night: TODAY, duration: 470, goal: 480, onTarget: true, open: true })
    expect(s.filter(p => p.open).map(p => p.night)).toEqual([TODAY])
    expect(s.filter(p => p.duration == null)).toHaveLength(27)
  })

  it('steps the goal line on the day a new goal starts (Review Focus 2)', () => {
    // 8h until the 14th; 7h30 from the 15th. The closed nights carry the goal they were judged by.
    const targets = [targetOf({ valid_from: '2026-09-01', goal_min: 480 }), targetOf({ valid_from: '2026-10-15', goal_min: 450 })]
    const closed = [
      nightOf({ night: '2026-10-14', target: { goal_min: 480, bed_target: '23:00' } }),
      nightOf({ night: '2026-10-15', target: { goal_min: 450, bed_target: '23:00' } }),
    ]
    const s = durationSeries(closed, {}, targets, TODAY)
    const goal = (night: string) => s.find(p => p.night === night)!.goal
    expect(goal('2026-10-13')).toBe(480)
    expect(goal('2026-10-14')).toBe(480)
    expect(goal('2026-10-15')).toBe(450)
    expect(goal('2026-10-16')).toBe(450)
    expect(s.slice(0, 14).every(p => p.goal === 480)).toBe(true)
    expect(s.slice(14).every(p => p.goal === 450)).toBe(true)
  })

  it('leaves the goal out on nights with no goal in force', () => {
    const s = durationSeries([], {}, [targetOf({ valid_from: '2026-10-20' })], TODAY)
    expect(s.find(p => p.night === '2026-10-19')!.goal).toBeNull()
    expect(s.find(p => p.night === '2026-10-20')!.goal).toBe(480)
  })
})

describe('bedtimeSeries', () => {
  it('keeps the logged nights of the last 14 days, with the deviation held to 3 hours', () => {
    const closed = [
      nightOf({ night: '2026-10-16', bed_time: '22:00' }), // 15 days back: out
      nightOf({ night: '2026-10-17', bed_time: '22:00' }),
      nightOf({ night: '2026-10-20', logged: false, on_target: false, duration_min: null, bed_time: null, wake_time: null }),
      nightOf({ night: '2026-10-25', bed_time: '19:00', wake_time: '05:00' }),
    ]
    const logs = { [TODAY]: logOf({ night: TODAY, bed_time: '03:30', wake_time: '10:00', duration_min: 390 }) }
    const s = bedtimeSeries(closed, logs, '23:00', TODAY)
    expect(s).toEqual([
      { night: '2026-10-17', dev: -60, clamped: null },
      { night: '2026-10-25', dev: -180, clamped: 'down' },
      { night: TODAY, dev: 180, clamped: 'up' },
    ])
  })

  it('does not clamp a night exactly 3 hours off', () => {
    const logs = { [TODAY]: logOf({ night: TODAY, bed_time: '02:00', wake_time: '09:00', duration_min: 420 }) }
    expect(bedtimeSeries([], logs, '23:00', TODAY)).toEqual([{ night: TODAY, dev: 180, clamped: null }])
  })

  it('measures across midnight against the target', () => {
    const logs = { [TODAY]: logOf({ night: TODAY, bed_time: '00:10', wake_time: '07:30', duration_min: 440 }) }
    expect(bedtimeSeries([], logs, '23:00', TODAY)[0].dev).toBe(70)
  })
})

const point = (over: Partial<DurationPoint>, i: number): DurationPoint =>
  ({ night: shiftDay(TODAY, i - 29), duration: null, goal: 480, onTarget: false, open: false, ...over })

describe('descriptions', () => {
  // 20 logged nights averaging 7h 25 (445 min), 18 of them on target.
  const series = Array.from({ length: 30 }, (_, i) =>
    i < 20 ? point({ duration: i % 2 ? 440 : 450, onTarget: i < 18 }, i) : point({}, i))

  it('describes the duration chart', async () => {
    expect(durationDescription(series)).toBe('Average of 7h 25 over the last 30 days, 18 nights on target')
    await setLang('pt-BR')
    expect(durationDescription(series)).toBe('Média de 7h 25 nos últimos 30 dias, 18 noites no alvo')
  })

  it('says one night in the singular, and when nothing was logged', () => {
    const one = series.map((p, i) => (i === 0 ? p : { ...p, onTarget: false }))
    expect(durationDescription(one)).toBe('Average of 7h 25 over the last 30 days, 1 night on target')
    expect(durationDescription(series.map(p => ({ ...p, duration: null, onTarget: false })))).toBe('No nights logged in the last 30 days')
  })

  it('describes the bedtime chart', async () => {
    const bed = [
      { night: '2026-10-17', dev: -60, clamped: null },
      { night: '2026-10-20', dev: 45, clamped: null },
      { night: '2026-10-25', dev: -45, clamped: null },
      { night: TODAY, dev: 180, clamped: 'up' as const },
    ]
    expect(bedtimeDescription(bed)).toBe('Last 14 days: 4 nights logged, 2 within 45 min of the target')
    expect(bedtimeDescription(bed.slice(1, 2))).toBe('Last 14 days: 1 night logged, 1 within 45 min of the target')
    expect(bedtimeDescription([])).toBe('No nights logged in the last 14 days')
    await setLang('pt-BR')
    expect(bedtimeDescription(bed)).toBe('Últimos 14 dias: 4 noites registradas, 2 com até 45 min de diferença do alvo')
  })
})

describe('row texts', () => {
  it('says where a night stands', () => {
    expect(durationState(point({}, 0))).toBe('Not logged')
    expect(durationState(point({ duration: 470, onTarget: true }, 0))).toBe('On target')
    expect(durationState(point({ duration: 400 }, 0))).toBe('Off target')
    expect(durationState(point({ duration: 400, goal: null }, 0))).toBe('Logged night')
    // A night not closed yet is not settled, whatever its preview says.
    expect(durationState(point({ duration: 470, onTarget: true, open: true }, 0))).toBe('To confirm')
    expect(durationState(point({ duration: 400, open: true }, 0))).toBe('To confirm')
  })

  it('agrees a logged night in pt-BR', async () => {
    await setLang('pt-BR')
    expect(durationState(point({ duration: 400, goal: null }, 0))).toBe('Registrada')
    expect(durationState(point({ duration: 400, open: true }, 0))).toBe('A confirmar')
  })

  it('writes the bedtime deviation in words', async () => {
    expect(deviationText({ night: TODAY, dev: 70, clamped: null })).toBe('1h10 later')
    expect(deviationText({ night: TODAY, dev: -25, clamped: null })).toBe('25 min earlier')
    expect(deviationText({ night: TODAY, dev: 0, clamped: null })).toBe('Right on time')
    expect(deviationText({ night: TODAY, dev: 180, clamped: 'up' })).toBe('More than 3h later')
    expect(deviationText({ night: TODAY, dev: -180, clamped: 'down' })).toBe('More than 3h earlier')
    await setLang('pt-BR')
    expect(deviationText({ night: TODAY, dev: 70, clamped: null })).toBe('1h10 depois')
    expect(deviationText({ night: TODAY, dev: 180, clamped: 'up' })).toBe('Mais de 3h depois')
  })
})
