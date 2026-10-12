import { describe, expect, it } from 'vitest'
import { markPlanEdited } from './program-state'

const program = () => ({ id: 'ppl', variant: 0, appliedAt: 1, routineIds: ['p1'], prevWeek: {}, dismissed: false })
const state = () => ({
  routines: [{ id: 'p1', name: 'PPL · Push', ex: [{ id: '0025', sets: 3 }] }],
  week: { 1: ['p1'] } as Record<number, string[]>,
  workouts: [] as unknown[],
  program: program() as ReturnType<typeof program> | undefined,
})
const after = (mut: (s: ReturnType<typeof state>) => void, prev = state()) => {
  const next = JSON.parse(JSON.stringify(prev))
  mut(next)
  markPlanEdited(prev, next)
  return next
}

describe('markPlanEdited (plan decision 4)', () => {
  it('dismisses the program after a routine edit', () => {
    expect(after(s => { s.routines[0].ex[0].sets = 4 }).program.dismissed).toBe(true)
    expect(after(s => { s.routines[0].name = 'Mine' }).program.dismissed).toBe(true)
  })

  it('dismisses it after a routine is added, removed or moved', () => {
    expect(after(s => { s.routines.push({ id: 'x', name: 'X', ex: [] }) }).program.dismissed).toBe(true)
    expect(after(s => { s.routines = [] }).program.dismissed).toBe(true)
  })

  it('dismisses it after a change to the week', () => {
    expect(after(s => { s.week[3] = ['p1'] }).program.dismissed).toBe(true)
    expect(after(s => { delete s.week[1] }).program.dismissed).toBe(true)
  })

  it('leaves it alone when the plan did not change', () => {
    expect(after(s => { s.workouts.push({ id: 'w' }) }).program.dismissed).toBe(false)
  })

  it('leaves it alone on the change that applies or touches the program itself', () => {
    const before = { ...state(), program: undefined }
    const applied = after(s => { s.routines.push({ id: 'p2', name: 'PPL · Pull', ex: [] }); s.week = { 1: ['p2'] }; s.program = { ...program(), appliedAt: 2 } }, before)
    expect(applied.program.dismissed).toBe(false)
    const again = after(s => { s.routines.push({ id: 'p3', name: 'PPL · Legs', ex: [] }); s.program = { ...program(), appliedAt: 3 } })
    expect(again.program.dismissed).toBe(false)
  })

  it('does nothing without a program or once dismissed', () => {
    const none = after(s => { s.routines[0].name = 'Mine' }, { ...state(), program: undefined })
    expect(none.program).toBeUndefined()
    const dismissed = { ...state(), program: { ...program(), dismissed: true } }
    expect(after(s => { s.week[2] = ['p1'] }, dismissed).program.dismissed).toBe(true)
  })
})
