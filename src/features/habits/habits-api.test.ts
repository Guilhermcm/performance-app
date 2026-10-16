import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }))

import * as api from './habits-api'
import { H1, H2, habitOf } from './test-habits'

function chain(result: { data?: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([String(prop), args]); return proxy }
    }
  })
  return { proxy, calls }
}

beforeEach(() => { h.rpc.mockReset(); h.from.mockReset() })

describe('habits api', () => {
  it('reads every habit, active and archived, by sort', async () => {
    const c = chain({ data: [{ ...habitOf(), user_id: 'u', per_week: '3', sort: '0' }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchHabits()).resolves.toEqual([habitOf()])
    expect(h.from).toHaveBeenCalledWith('habits')
    expect(c.calls).toContainEqual(['order', ['sort', { ascending: true }]])
  })

  it('upserts a habit on its id, without the user id or the creation time', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    const x = habitOf({ archived_at: '2026-10-05T10:00:00.000Z', updated_at: '2026-10-05T10:00:00.000Z' })
    await api.upsertHabit(x)
    const [row, opts] = c.calls.find(y => y[0] === 'upsert')![1] as [Record<string, unknown>, unknown]
    expect(row).toEqual({ id: H1, name: 'Read', icon: 'book', per_week: 3, sort: 0, archived_at: x.archived_at, updated_at: x.updated_at })
    expect(opts).toEqual({ onConflict: 'id' })
  })

  it('writes only the sort of a habit on a reorder, never its other fields', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.updateHabitSort(H1, 2, '2026-10-05T10:00:00.000Z')
    expect(h.from).toHaveBeenCalledWith('habits')
    expect(c.calls).toEqual([['update', [{ sort: 2, updated_at: '2026-10-05T10:00:00.000Z' }]], ['eq', ['id', H1]]])
  })

  it('reads the checks of a range', async () => {
    const c = chain({ data: [{ habit_id: H1, user_id: 'u', day: '2026-10-05', created_at: 'x', counted: null }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchChecks('2026-10-04', '2026-10-05')).resolves.toEqual([{ habit_id: H1, day: '2026-10-05', counted: null }])
    expect(h.from).toHaveBeenCalledWith('habit_checks')
    expect(c.calls).toContainEqual(['gte', ['day', '2026-10-04']])
    expect(c.calls).toContainEqual(['lte', ['day', '2026-10-05']])
  })

  it('inserts a check ignoring a duplicate, and deletes one by habit and day', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.insertCheck(H1, '2026-10-05')
    expect(c.calls.find(y => y[0] === 'upsert')![1]).toEqual([{ habit_id: H1, day: '2026-10-05' }, { onConflict: 'habit_id,day', ignoreDuplicates: true }])

    const d = chain({ error: null }); h.from.mockReturnValue(d.proxy)
    await api.deleteCheck(H1, '2026-10-05')
    expect(h.from).toHaveBeenLastCalledWith('habit_checks')
    expect(d.calls).toContainEqual(['eq', ['habit_id', H1]])
    expect(d.calls).toContainEqual(['eq', ['day', '2026-10-05']])
    expect(d.calls.some(y => y[0] === 'delete')).toBe(true)
  })

  it('reads the targets of one week', async () => {
    const c = chain({ data: [{ habit_id: H1, user_id: 'u', week_start: '2026-10-05', target: '3' }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchTargets('2026-10-05')).resolves.toEqual([{ habit_id: H1, week_start: '2026-10-05', target: 3 }])
    expect(h.from).toHaveBeenCalledWith('habit_targets')
    expect(c.calls).toContainEqual(['eq', ['week_start', '2026-10-05']])
  })

  it('calls get_habit_history with the range and fills what is missing', async () => {
    const day = { day: '2026-10-01', checks: 2, valid: 2, xp: 90 }
    h.rpc.mockResolvedValue({ data: { days: [day], checks: [{ habit_id: H2, day: '2026-10-01', counted: true }], targets: null }, error: null })
    await expect(api.fetchHistory('2026-09-01', '2026-10-05')).resolves.toEqual({
      days: [day], checks: [{ habit_id: H2, day: '2026-10-01', counted: true }], targets: [], periods: []
    })
    expect(h.rpc).toHaveBeenCalledWith('get_habit_history', { p_from: '2026-09-01', p_to: '2026-10-05' })
  })

  it('reads every period of the pillar, oldest first', async () => {
    const c = chain({ data: [{ started_on: '2026-05-10', ended_on: '2026-06-01' }, { started_on: '2026-09-20', ended_on: null }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchPeriods()).resolves.toEqual([{ started_on: '2026-05-10', ended_on: '2026-06-01' }, { started_on: '2026-09-20', ended_on: null }])
    expect(h.from).toHaveBeenCalledWith('habit_periods')
    expect(c.calls).toContainEqual(['select', ['started_on, ended_on']])
    expect(c.calls).toContainEqual(['order', ['started_on', { ascending: true }]])
  })

  it('throws classified errors', async () => {
    const c = chain({ error: { code: 'P0001', message: 'day_closed' } }); h.from.mockReturnValue(c.proxy)
    await expect(api.insertCheck(H1, '2026-10-01')).rejects.toMatchObject({ code: 'day_closed', refused: true, reason: 'day_closed' })
    h.rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.fetchHistory('2026-10-01', '2026-10-05')).rejects.toMatchObject({ code: 'network', refused: false })
  })

  it('tells each habit error apart', async () => {
    for (const code of ['day_closed', 'habit_archived', 'pillar_off', 'too_many_habits'] as const) {
      expect(api.toHabitError({ code: 'P0001', message: code })).toBe(code)
    }
    const c = chain({ error: { code: 'P0001', message: 'pillar_off' } }); h.from.mockReturnValue(c.proxy)
    expect(api.toHabitError(await api.insertCheck(H1, '2026-10-05').catch(e => e))).toBe('pillar_off')
    expect(api.toHabitError({ code: '23514', message: 'habits_name_check' })).toBe('refused')
    expect(api.toHabitError(new TypeError('Failed to fetch'))).toBe('network')
    expect(api.toHabitError({ code: '42501', message: 'permission denied' })).toBe('network')
  })
})
