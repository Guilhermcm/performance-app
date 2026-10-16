import { describe, it, expect } from 'vitest'
import {
  RUN_CAP, canMark, cardOrder, daysLeft, habitRun, habitWeekAwards, lateness, newTarget, validChecks, weekDots, weekSummary,
} from './week'
import type { HabitPeriod } from './types'

// 2026-10-05 is a Monday.
const MON = '2026-10-05'
const WED = '2026-10-07'
const FRI = '2026-10-09'
const SAT = '2026-10-10'
const SUN = '2026-10-11'

describe('daysLeft and newTarget', () => {
  it('counts today up to Sunday', () => {
    expect(daysLeft(MON)).toBe(7)
    expect(daysLeft(WED)).toBe(5)
    expect(daysLeft(SUN)).toBe(1)
  })
  it('caps the new target at the days left', () => {
    expect(newTarget(7, WED)).toBe(5)
    expect(newTarget(3, WED)).toBe(3)
    expect(newTarget(4, SUN)).toBe(1)
  })
})

describe('validChecks', () => {
  const habits = [{ id: 'b', sort: 0 }, { id: 'a', sort: 1 }]
  it('keeps the first target checks per habit in day order', () => {
    const checks = [
      { habit_id: 'a', day: '2026-10-08' }, { habit_id: 'a', day: '2026-10-05' },
      { habit_id: 'a', day: '2026-10-06' },
    ]
    expect(validChecks(checks, { a: 2, b: 0 }, habits)).toEqual([
      { habit_id: 'a', day: '2026-10-05' }, { habit_id: 'a', day: '2026-10-06' },
    ])
  })
  it('orders a day by sort, then id', () => {
    const checks = [
      { habit_id: 'a', day: MON }, { habit_id: 'b', day: MON }, { habit_id: 'c', day: MON },
    ]
    const hs = [...habits, { id: 'c', sort: 0 }]
    expect(validChecks(checks, { a: 1, b: 1, c: 1 }, hs).map(c => c.habit_id)).toEqual(['b', 'c', 'a'])
  })
  it('drops checks of habits without a target', () => {
    expect(validChecks([{ habit_id: 'z', day: MON }], { z: 1 }, habits)).toEqual([])
  })
})

describe('weekSummary', () => {
  const habits = [{ id: 'a', sort: 0 }, { id: 'b', sort: 1 }]
  it('sums Q and C and reports each habit', () => {
    const checks = [
      { habit_id: 'a', day: MON }, { habit_id: 'a', day: '2026-10-06' }, { habit_id: 'a', day: WED },
      { habit_id: 'b', day: MON },
    ]
    expect(weekSummary(checks, { a: 2, b: 3 }, habits)).toEqual({
      q: 5, c: 3,
      byHabit: { a: { target: 2, done: 3, valid: 2 }, b: { target: 3, done: 1, valid: 1 } },
    })
  })
  it('gives c = 0 when Q = 0', () => {
    const s = weekSummary([{ habit_id: 'a', day: MON }], {}, habits)
    expect(s.q).toBe(0)
    expect(s.c).toBe(0)
    expect(s.byHabit.a).toEqual({ target: 0, done: 1, valid: 0 })
  })
})

describe('lateness', () => {
  it('is not late while the missing checks fit in the days left', () => {
    expect(lateness(3, 1, false, FRI)).toEqual({ late: false, missing: 2, days: 3 })
  })
  it('is late when the missing checks need every remaining day', () => {
    expect(lateness(3, 1, false, SAT)).toEqual({ late: true, missing: 2, days: 2 })
  })
  it('does not count today once it was checked', () => {
    expect(lateness(3, 1, true, SAT)).toEqual({ late: true, missing: 2, days: 1 })
  })
  it('is never late when the target is met', () => {
    expect(lateness(3, 3, false, SAT)).toEqual({ late: false, missing: 0, days: 2 })
    expect(lateness(3, 4, false, SAT).missing).toBe(0)
  })
})

describe('cardOrder', () => {
  it('puts the complete habits last and keeps sort inside each group', () => {
    const rows = [
      { id: 'a', sort: 0, done: 2, target: 2 },
      { id: 'c', sort: 2, done: 0, target: 3 },
      { id: 'b', sort: 1, done: 1, target: 1 },
      { id: 'd', sort: 3, done: 1, target: 4 },
    ]
    expect(cardOrder(rows).map(r => r.id)).toEqual(['c', 'd', 'a', 'b'])
    expect(rows.map(r => r.id)).toEqual(['a', 'c', 'b', 'd'])
  })
})

describe('habitRun', () => {
  // today = 2026-10-28 (Wednesday): the last judged week starts on 2026-10-19 (<= today - 8 = 10-20).
  const today = '2026-10-28'
  const weeks = ['2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28']
  const counted = (ws: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      habit_id: 'h', day: `${ws.slice(0, 8)}${String(Number(ws.slice(8)) + i).padStart(2, '0')}`, counted: true as boolean | null,
    }))
  const target = (ws: string, t: number) => ({ habit_id: 'h', week_start: ws, target: t })
  // A loaded window that reaches far enough back for these runs.
  const FROM = '2026-08-01'

  it('counts consecutive judged weeks and ignores the week not judged yet', () => {
    const targets = [target('2026-10-26', 1), ...weeks.slice(0, 3).map(w => target(w, 2))]
    const checks = [...counted('2026-10-26', 1), ...weeks.slice(0, 3).flatMap(w => counted(w, 2))]
    expect(habitRun('h', { targets, checks }, today, FROM)).toBe(3)
  })
  it('stops at the week without a target row', () => {
    const targets = [target(weeks[0], 2), target(weeks[2], 2)]
    const checks = [...counted(weeks[0], 2), ...counted(weeks[2], 2)]
    expect(habitRun('h', { targets, checks }, today, FROM)).toBe(1)
  })
  it('stops at a week below its target or with target 0', () => {
    const targets = [target(weeks[0], 2), target(weeks[1], 3), target(weeks[2], 2)]
    const checks = [...counted(weeks[0], 2), ...counted(weeks[1], 2), ...counted(weeks[2], 2)]
    expect(habitRun('h', { targets, checks }, today, FROM)).toBe(1)
    expect(habitRun('h', { targets: [target(weeks[0], 0)], checks: [] }, today, FROM)).toBe(0)
  })
  it('does not count unclosed or other habits checks', () => {
    const targets = [target(weeks[0], 2)]
    const checks = [
      { habit_id: 'h', day: '2026-10-19', counted: true }, { habit_id: 'h', day: '2026-10-20', counted: null },
      { habit_id: 'x', day: '2026-10-21', counted: true },
    ]
    expect(habitRun('h', { targets, checks }, today, FROM)).toBe(0)
  })
  it('judges the week that started 8 days ago, not the one 7 days ago', () => {
    // today = Monday 2026-10-26: week 10-19 started 7 days ago and is not judged; 10-12 is.
    const targets = [target('2026-10-19', 1), target('2026-10-12', 1)]
    const checks = [...counted('2026-10-19', 1), ...counted('2026-10-12', 1)]
    expect(habitRun('h', { targets, checks }, '2026-10-26', FROM)).toBe(1)
  })
  it('reads the cap when the run is still unbroken at the edge of the loaded window', () => {
    // Monday 2026-10-26: the phone holds today - 61 .. today (2026-08-26 on), so the judged weeks
    // fully inside it are the 7 from 10-12 back to 08-31; the week of 08-24 is cut by the window.
    const monday = '2026-10-26'
    const from = '2026-08-26'
    const day = (ws: string, i: number) => new Date(Date.parse(ws + 'T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
    const nine = Array.from({ length: 9 }, (_, i) => day('2026-10-12', -7 * i))
    const targets = nine.map(w => target(w, 7))
    const checks = nine.flatMap(w => Array.from({ length: 7 }, (_, i) => ({ habit_id: 'h', day: day(w, i), counted: true as boolean | null })))
      .filter(c => c.day >= from)
    expect(habitRun('h', { targets, checks }, monday, from)).toBe(RUN_CAP)
    // A break inside the window still stops the run.
    expect(habitRun('h', { targets, checks: checks.filter(c => c.day !== '2026-09-30') }, monday, from)).toBe(2)
    // A habit with no target in the week cut by the window (it did not exist yet) stops there.
    expect(habitRun('h', { targets: targets.filter(x => x.week_start >= from), checks }, monday, from)).toBe(7)
  })
})

describe('habitWeekAwards', () => {
  it('pays nothing for an empty week', () => {
    expect(habitWeekAwards({ habits: [], checks: [] })).toEqual([])
  })
  it('keeps the total of the checks at 600 when the week has more than 7 targets', () => {
    const habits = [{ id: 'a', sort: 0, target: 7 }, { id: 'b', sort: 1, target: 6 }]
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
    const checks = [
      ...days.map(day => ({ habit: 'a', day })), ...days.slice(0, 6).map(day => ({ habit: 'b', day })),
    ]
    const sum = habitWeekAwards({ habits, checks })
      .filter(a => a.reason === 'habit_check').reduce((s, a) => s + a.amount, 0)
    expect(sum).toBe(600)
  })
})

describe('weekDots', () => {
  const checks = [
    { habit_id: 'a', day: MON }, { habit_id: 'a', day: WED }, { habit_id: 'b', day: '2026-10-06' },
    { habit_id: 'a', day: '2026-10-04' },
  ]
  const on: HabitPeriod[] = [{ started_on: '2026-09-01', ended_on: null }]
  it('lays the week from Monday to Sunday with this habit checks, today and yesterday markable', () => {
    expect(weekDots('a', checks, WED, on)).toEqual([
      { day: MON, checked: true, markable: false, today: false },
      { day: '2026-10-06', checked: false, markable: true, today: false },
      { day: WED, checked: true, markable: true, today: true },
      { day: '2026-10-08', checked: false, markable: false, today: false },
      { day: FRI, checked: false, markable: false, today: false },
      { day: SAT, checked: false, markable: false, today: false },
      { day: SUN, checked: false, markable: false, today: false },
    ])
  })
  it('on Monday leaves only today markable: yesterday belongs to the week before (plan decision 14)', () => {
    const dots = weekDots('a', checks, MON, on)
    expect(dots.map(d => d.day)).toEqual([MON, '2026-10-06', WED, '2026-10-08', FRI, SAT, SUN])
    expect(dots.filter(d => d.markable).map(d => d.day)).toEqual([MON])
    expect(dots.filter(d => d.today).map(d => d.day)).toEqual([MON])
  })
  it('on Sunday marks Saturday and Sunday', () => {
    expect(weekDots('a', checks, SUN, on).filter(d => d.markable).map(d => d.day)).toEqual([SAT, SUN])
  })
  it('leaves yesterday alone when it is outside every period: the pillar was turned on today', () => {
    const dots = weekDots('a', checks, WED, [{ started_on: WED, ended_on: null }])
    expect(dots.filter(d => d.markable).map(d => d.day)).toEqual([WED])
    expect(dots.filter(d => d.today).map(d => d.day)).toEqual([WED])
    // Not known yet (no history on the phone): only today.
    expect(weekDots('a', checks, WED, null).filter(d => d.markable).map(d => d.day)).toEqual([WED])
    // Turned off yesterday evening and back on today: the same period goes on, yesterday included.
    expect(weekDots('a', checks, WED, [{ started_on: '2026-09-01', ended_on: '2026-10-06' }]).filter(d => d.markable).map(d => d.day))
      .toEqual(['2026-10-06', WED])
  })
})

describe('canMark', () => {
  const on: HabitPeriod[] = [{ started_on: '2026-09-01', ended_on: null }]
  it('takes today, and yesterday only inside a period', () => {
    expect(canMark(WED, WED, null)).toBe(true)
    expect(canMark('2026-10-06', WED, on)).toBe(true)
    expect(canMark('2026-10-06', WED, [{ started_on: WED, ended_on: null }])).toBe(false)
    expect(canMark('2026-10-06', WED, null)).toBe(false)
    expect(canMark(MON, WED, on)).toBe(false)
    expect(canMark('2026-10-08', WED, on)).toBe(false)
  })
})
