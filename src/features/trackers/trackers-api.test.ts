import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }))

import * as api from './trackers-api'
import { T1, trackerOf, entryOf } from './test-trackers'

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

beforeEach(() => { h.from.mockReset() })

describe('trackers api', () => {
  it('reads every tracker, active and archived, by sort and id', async () => {
    const label = trackerOf({ kind: 'label', unit: null, decimals: null, aggregate: null, options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }] })
    const c = chain({ data: [{ ...label, user_id: 'u', sort: '0' }], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchTrackers()).resolves.toEqual([label])
    expect(h.from).toHaveBeenCalledWith('trackers')
    expect(c.calls).toEqual([['select', ['*']], ['order', ['sort', { ascending: true }]], ['order', ['id', { ascending: true }]]])
  })

  it('reads the entries of every tracker from a day on, with the time as HH:MM', async () => {
    const row = { ...entryOf('2026-10-05', { id: 'x', value: 1.8 }), at: '09:30:00', value: '1.8', user_id: 'u', created_at: 'c' }
    const c = chain({ data: [row], error: null })
    h.from.mockReturnValue(c.proxy)
    await expect(api.fetchEntries('2026-07-18')).resolves.toEqual([entryOf('2026-10-05', { id: 'x', at: '09:30', value: 1.8, updated_at: row.updated_at })])
    expect(h.from).toHaveBeenCalledWith('tracker_entries')
    expect(c.calls).toContainEqual(['gte', ['day', '2026-07-18']])
    expect(c.calls.filter(x => x[0] === 'lte')).toEqual([])
  })

  it('reads the entries in pages of 1000 until a page comes back short', async () => {
    const row = (i: number) => ({ ...entryOf('2026-10-05', { id: `p${i}` }), at: '09:30:00', value: String(i) })
    const first = chain({ data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null })
    const second = chain({ data: [row(1000), row(1001), row(1002)], error: null })
    h.from.mockReturnValueOnce(first.proxy).mockReturnValueOnce(second.proxy)
    const entries = await api.fetchEntries('2026-07-18')
    expect(entries).toHaveLength(1003)
    expect(entries[1002]).toMatchObject({ id: 'p1002', at: '09:30', value: 1002 })
    expect(h.from).toHaveBeenCalledTimes(2)
    const order = [['order', ['day', { ascending: true }]], ['order', ['at', { ascending: true }]], ['order', ['id', { ascending: true }]]]
    for (const c of [first, second]) {
      expect(c.calls).toContainEqual(['gte', ['day', '2026-07-18']])
      expect(c.calls.filter(x => x[0] === 'order')).toEqual(order)
    }
    expect(first.calls).toContainEqual(['range', [0, 999]])
    expect(second.calls).toContainEqual(['range', [1000, 1999]])
  })

  it('keeps one copy of a row that a write between two pages moved onto the next page, the later one', async () => {
    const row = (i: number, over = {}) => ({ ...entryOf('2026-10-05', { id: `q${i}` }), at: '09:30:00', ...over })
    const first = chain({ data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null })
    const second = chain({ data: [row(999, { note: 'later' }), row(1000)], error: null })
    h.from.mockReturnValueOnce(first.proxy).mockReturnValueOnce(second.proxy)
    const entries = await api.fetchEntries('2026-07-18')
    expect(entries).toHaveLength(1001)
    expect(entries.filter(e => e.id === 'q999')).toEqual([expect.objectContaining({ note: 'later' })])
  })

  it('upserts a tracker on its id, without the user id or the creation time', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    const x = trackerOf({ archived_at: '2026-10-05T10:00:00.000Z', updated_at: '2026-10-05T10:00:00.000Z' })
    await api.upsertTracker(x)
    const [row, opts] = c.calls.find(y => y[0] === 'upsert')![1] as [Record<string, unknown>, unknown]
    expect(row).toEqual({
      id: T1, name: 'Water', icon: 'droplet', kind: 'number', unit: 'L', decimals: 1, aggregate: 'sum', options: null, sort: 0,
      archived_at: x.archived_at, updated_at: x.updated_at
    })
    expect(opts).toEqual({ onConflict: 'id' })
  })

  it('writes only the sort of a tracker on a reorder', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    await api.updateTrackerSort(T1, 2, '2026-10-05T10:00:00.000Z')
    expect(h.from).toHaveBeenCalledWith('trackers')
    expect(c.calls).toEqual([['update', [{ sort: 2, updated_at: '2026-10-05T10:00:00.000Z' }]], ['eq', ['id', T1]]])
  })

  it('upserts an entry on its id and deletes one by id', async () => {
    const c = chain({ error: null }); h.from.mockReturnValue(c.proxy)
    const e = entryOf('2026-10-05', { id: 'e-up', note: 'after run' })
    await api.upsertEntry(e)
    expect(h.from).toHaveBeenCalledWith('tracker_entries')
    const [row, opts] = c.calls.find(y => y[0] === 'upsert')![1] as [Record<string, unknown>, unknown]
    expect(row).toEqual({ id: 'e-up', tracker_id: T1, day: '2026-10-05', at: '09:00', value: 1, minutes: null, option: null, note: 'after run', updated_at: e.updated_at })
    expect(opts).toEqual({ onConflict: 'id' })

    const d = chain({ error: null }); h.from.mockReturnValue(d.proxy)
    await api.deleteEntry('e-up')
    expect(h.from).toHaveBeenLastCalledWith('tracker_entries')
    expect(d.calls).toEqual([['delete', []], ['eq', ['id', 'e-up']]])
  })

  it('throws classified errors', async () => {
    const c = chain({ error: { code: 'P0001', message: 'tracker_archived' } }); h.from.mockReturnValue(c.proxy)
    await expect(api.upsertEntry(entryOf('2026-10-05'))).rejects.toMatchObject({ refused: true, detail: 'tracker_archived' })
    h.from.mockReturnValue({ select: () => ({ order: () => ({ order: () => Promise.reject(new TypeError('Failed to fetch')) }) }) })
    await expect(api.fetchTrackers()).rejects.toMatchObject({ code: 'network', refused: false })
  })

  it('tells each tracker refusal apart, and nothing else', async () => {
    for (const code of ['too_many_trackers', 'option_in_use', 'tracker_archived', 'future_day', 'invalid_value', 'invalid_options'] as const) {
      expect(api.toTrackerError({ code: 'P0001', message: code })).toBe(code)
    }
    const c = chain({ error: { code: 'P0001', message: 'option_in_use' } }); h.from.mockReturnValue(c.proxy)
    expect(api.toTrackerError(await api.upsertTracker(trackerOf()).catch(e => e))).toBe('option_in_use')
    expect(api.toTrackerError({ code: 'P0001', message: 'tracker_not_found' })).toBeNull()
    expect(api.toTrackerError({ code: '23514', message: 'trackers_name_check' })).toBeNull()
    expect(api.toTrackerError(new TypeError('Failed to fetch'))).toBeNull()
  })
})
