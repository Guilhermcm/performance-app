// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import SleepStats from './SleepStats'
import { setLang } from '../../lib/i18n.js'
import { nightOf } from './test-sleep'
import type { StatNight } from './stats'
import type { NightClass } from './types'

const n = (night: string, bed_time = '23:00', duration_min = 480, goal_min: number | null = 480): StatNight =>
  ({ night, bed_time, duration_min, goal_min })
const ON: NightClass = { logged: true, on_target: true, rested: false, bed_diff_min: 0 }

const TODAY = '2026-10-12' // a Monday
const tile = (name: string) => screen.getByTestId(`sleep-stat-${name}`)
const value = (name: string) => tile(name).querySelector('[data-stat-value]')!

afterEach(async () => { cleanup(); await setLang('en') })

describe('SleepStats', () => {
  it('shows the regularity as a spread with its word', async () => {
    await setLang('pt-BR')
    // The case of stats.test.ts: SD of 30 minutes around 23:00.
    const stat = [n('2026-10-08', '22:50'), n('2026-10-09', '23:10'), n('2026-10-10', '23:30'), n('2026-10-11', '00:10')]
    render(<SleepStats stat={stat} closed={[]} open={[]} today={TODAY} target={5} bedTarget="23:00" />)
    expect(tile('regularity').textContent).toContain('± 30 min · estável')
    expect(tile('regularity').textContent).toContain('Regularidade')
  })

  it('says there are too few nights to measure the regularity with two', async () => {
    await setLang('pt-BR')
    render(<SleepStats stat={[n('2026-10-10'), n('2026-10-11')]} closed={[]} open={[]} today={TODAY} target={5} bedTarget="23:00" />)
    expect(value('regularity').textContent).toBe('–')
    expect(tile('regularity').textContent).toContain('Poucas noites para medir')
  })

  it('shows a dash and "no nights logged" with no data, and a debt of 0', async () => {
    await setLang('pt-BR')
    render(<SleepStats stat={[]} closed={[]} open={[]} today={TODAY} target={5} bedTarget="23:00" />)
    expect(value('average').textContent).toBe('–')
    expect(tile('average').textContent).toContain('Sem noites registradas')
    expect(value('debt').textContent).toBe('0')
    expect(value('nights').textContent).toBe('0/5')
    expect(tile('nights').textContent).not.toContain('a confirmar')
  })

  it('averages the last 7 days with the last 30 below', () => {
    const stat = [n('2026-10-12', '23:00', 420), n('2026-10-10', '23:00', 480), n('2026-10-06', '23:00', 540), n('2026-09-20', '23:00', 300)]
    render(<SleepStats stat={stat} closed={[]} open={[]} today={TODAY} target={5} bedTarget="23:00" />)
    expect(value('average').textContent).toBe('8h')
    expect(tile('average').textContent).toContain('30 days: 7h 15')
  })

  it('shows the week debt as a duration', () => {
    render(<SleepStats stat={[n('2026-10-12', '23:00', 400)]} closed={[]} open={[]} today={TODAY} target={5} bedTarget="23:00" />)
    expect(value('debt').textContent).toBe('1h 20')
  })

  it('counts the nights on target over T, with the open ones to confirm', async () => {
    await setLang('pt-BR')
    const today = '2026-10-17' // the Saturday of that week
    const closed = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map(night => nightOf({ night }))
    render(<SleepStats stat={[]} closed={closed} open={[{ night: '2026-10-16', cls: ON }, { night: today, cls: { ...ON, on_target: false } }]}
      today={today} target={5} bedTarget="23:00" />)
    expect(value('nights').textContent).toBe('4/5')
    expect(tile('nights').textContent).toContain('+1 a confirmar')
  })

  it('writes every number in tabular mono figures', () => {
    render(<SleepStats stat={[n('2026-10-12')]} closed={[]} open={[]} today={TODAY} target={5} bedTarget="23:00" />)
    const values = document.querySelectorAll('[data-stat-value]')
    expect(values).toHaveLength(4)
    for (const v of values) expect(v.className).toMatch(/\bfont-mono\b.*\btabular-nums\b|\btabular-nums\b.*\bfont-mono\b/)
  })
})
