import { describe, it, expect } from 'vitest'
import {
  cardOrder, daysLeft, habitRun, habitWeekAwards, lateness, newTarget, validChecks, weekDots, weekSummary,
} from './week'

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

  it('counts consecutive judged weeks and ignores the week not judged yet', () => {
    const targets = [target('2026-10-26', 1), ...weeks.slice(0, 3).map(w => target(w, 2))]
    const checks = [...counted('2026-10-26', 1), ...weeks.slice(0, 3).flatMap(w => counted(w, 2))]
    expect(habitRun('h', { targets, checks }, today)).toBe(3)
  })
  it('stops at the week without a target row', () => {
    const targets = [target(weeks[0], 2), target(weeks[2], 2)]
    const checks = [...counted(weeks[0], 2), ...counted(weeks[2], 2)]
    expect(habitRun('h', { targets, checks }, today)).toBe(1)
  })
  it('stops at a week below its target or with target 0', () => {
    const targets = [target(weeks[0], 2), target(weeks[1], 3), target(weeks[2], 2)]
    const checks = [...counted(weeks[0], 2), ...counted(weeks[1], 2), ...counted(weeks[2], 2)]
    expect(habitRun('h', { targets, checks }, today)).toBe(1)
    expect(habitRun('h', { targets: [target(weeks[0], 0)], checks: [] }, today)).toBe(0)
  })
  it('does not count unclosed or other habits checks', () => {
    const targets = [target(weeks[0], 2)]
    const checks = [
      { habit_id: 'h', day: '2026-10-19', counted: true }, { habit_id: 'h', day: '2026-10-20', counted: null },
      { habit_id: 'x', day: '2026-10-21', counted: true },
    ]
    expect(habitRun('h', { targets, checks }, today)).toBe(0)
  })
  it('judges the week that started 8 days ago, not the one 7 days ago', () => {
    // today = Monday 2026-10-26: week 10-19 started 7 days ago and is not judged; 10-12 is.
    const targets = [target('2026-10-19', 1), target('2026-10-12', 1)]
    const checks = [...counted('2026-10-19', 1), ...counted('2026-10-12', 1)]
    expect(habitRun('h', { targets, checks }, '2026-10-26')).toBe(1)
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
  it('lays the week from Monday to Sunday with this habit checks, today and yesterday markable', () => {
    expect(weekDots('a', checks, WED)).toEqual([
      { day: MON, checked: true, markable: false },
      { day: '2026-10-06', checked: false, markable: true },
      { day: WED, checked: true, markable: true },
      { day: '2026-10-08', checked: false, markable: false },
      { day: FRI, checked: false, markable: false },
      { day: SAT, checked: false, markable: false },
      { day: SUN, checked: false, markable: false },
    ])
  })
  it('on Monday leaves only today markable: yesterday belongs to the week before (plan decision 14)', () => {
    const dots = weekDots('a', checks, MON)
    expect(dots.map(d => d.day)).toEqual([MON, '2026-10-06', WED, '2026-10-08', FRI, SAT, SUN])
    expect(dots.filter(d => d.markable).map(d => d.day)).toEqual([MON])
  })
  it('on Sunday marks Saturday and Sunday', () => {
    expect(weekDots('a', checks, SUN).filter(d => d.markable).map(d => d.day)).toEqual([SAT, SUN])
  })
})
