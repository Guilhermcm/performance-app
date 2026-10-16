// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real trackers-api wrapper runs here; only the supabase client answers, with PostgREST-shaped errors.
const db = vi.hoisted(() => ({ answer: vi.fn(), session: { access_token: 't' } as object | null }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: db.session } }) },
    from: (table: string) => ({
      upsert: (row: Record<string, string>) =>
        table === 'trackers' ? db.answer('tracker', row.name, row) : db.answer('entry', row.id, row),
      update: (row: Record<string, unknown>) => ({ eq: (_c: string, id: string) => db.answer('sort', id, row) }),
      delete: () => ({ eq: (_c: string, id: string) => db.answer('delete', id) })
    })
  }
}))

import { trackersOutbox, type TrackerOp } from './outbox'
import { clearTrackersLocal } from './sign-out'
import { ME, OTHER, T2, trackerOf, entryOf } from './test-trackers'

const ok = { data: null, error: null }
const pg = (code: string, message: string) => ({ data: null, error: { code, message, details: null, hint: null } })
const entry = (id: string, over = {}): TrackerOp => ({ op: 'entry', row: entryOf('2026-10-05', { id, ...over }) })
const del = (id: string): TrackerOp => ({ op: 'delete', id })
const sent = () => db.answer.mock.calls.map(c => [c[0], c[1]])

beforeEach(() => { localStorage.clear(); trackersOutbox.clear(); db.answer.mockReset().mockResolvedValue(ok); db.session = { access_token: 't' } })

describe('trackers outbox', () => {
  it('keeps its queue under perf_trackers_outbox_v1, apart from the habits', () => {
    trackersOutbox.enqueue(ME, entry('e1'))
    expect(Object.keys(JSON.parse(localStorage.getItem('perf_trackers_outbox_v1')!))).toEqual([ME])
    expect(localStorage.getItem('perf_habits_outbox_v1')).toBeNull()
  })

  it('sends a tracker created offline before its entries, even after a rename', async () => {
    const created = trackerOf({ id: T2, name: 'Weight', updated_at: '2026-10-05T10:00:00.000Z' })
    trackersOutbox.enqueue(ME, { op: 'tracker', row: created })
    trackersOutbox.enqueue(ME, entry('e1', { tracker_id: T2 }))
    trackersOutbox.enqueue(ME, entry('e2', { tracker_id: T2 }))
    trackersOutbox.enqueue(ME, { op: 'tracker', row: { ...created, name: 'Body weight', updated_at: '2026-10-05T10:05:00.000Z' } })
    expect(trackersOutbox.pending(ME)).toHaveLength(4)
    await expect(trackersOutbox.flush(ME)).resolves.toMatchObject({ sent: 4, left: 0, dropped: 0 })
    expect(sent()).toEqual([['tracker', 'Weight'], ['entry', 'e1'], ['entry', 'e2'], ['tracker', 'Body weight']])
  })

  it('collapses an entry and its delete into the newest op', () => {
    trackersOutbox.enqueue(ME, entry('e1'))
    trackersOutbox.enqueue(ME, entry('e2'))
    trackersOutbox.enqueue(ME, entry('e1', { value: 2 }))
    expect(trackersOutbox.pending(ME)).toEqual([entry('e2'), entry('e1', { value: 2 })])
    trackersOutbox.enqueue(ME, del('e1'))
    expect(trackersOutbox.pending(ME)).toEqual([entry('e2'), del('e1')])
  })

  it('never collapses tracker or sort writes', async () => {
    trackersOutbox.enqueue(ME, { op: 'tracker', row: trackerOf({ id: T2, name: 'Weight' }) })
    trackersOutbox.enqueue(ME, { op: 'sort', id: T2, sort: 1, updated_at: '2026-10-05T10:00:00.000Z' })
    trackersOutbox.enqueue(ME, { op: 'sort', id: T2, sort: 0, updated_at: '2026-10-05T10:01:00.000Z' })
    trackersOutbox.enqueue(ME, { op: 'tracker', row: trackerOf({ id: T2, name: 'Weight 2' }) })
    expect(trackersOutbox.pending(ME)).toHaveLength(4)
    await trackersOutbox.flush(ME)
    expect(db.answer.mock.calls.map(c => [c[0], c[1], c[0] === 'sort' ? c[2] : null])).toEqual([
      ['tracker', 'Weight', null],
      ['sort', T2, { sort: 1, updated_at: '2026-10-05T10:00:00.000Z' }],
      ['sort', T2, { sort: 0, updated_at: '2026-10-05T10:01:00.000Z' }],
      ['tracker', 'Weight 2', null]
    ])
  })

  it('drops the tracker refusals and keeps going', async () => {
    trackersOutbox.enqueue(ME, entry('e1'))
    trackersOutbox.enqueue(ME, entry('e2'))
    trackersOutbox.enqueue(ME, entry('e3'))
    db.answer.mockImplementation(async (_op: string, id: string) =>
      id === 'e1' ? pg('P0001', 'tracker_archived') : id === 'e2' ? pg('P0001', 'future_day') : ok)
    await expect(trackersOutbox.flush(ME)).resolves.toEqual({ sent: 1, left: 0, dropped: 2, reasons: ['refused'] })
    expect(sent()).toEqual([['entry', 'e1'], ['entry', 'e2'], ['entry', 'e3']])
  })

  it('keeps the queue, in order, on a network failure', async () => {
    trackersOutbox.enqueue(ME, { op: 'tracker', row: trackerOf({ id: T2 }) })
    trackersOutbox.enqueue(ME, entry('e1', { tracker_id: T2 }))
    db.answer.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(trackersOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 2, dropped: 0, reasons: [] })
    expect(trackersOutbox.pending(ME).map(o => o.op)).toEqual(['tracker', 'entry'])
  })

  it('keeps the queue on sign-out and sends it on the next sign-in of the same account', async () => {
    trackersOutbox.enqueue(ME, entry('e1'))
    db.session = null
    clearTrackersLocal()
    await expect(trackersOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 1, dropped: 0, reasons: [] })
    db.session = { access_token: 't' }
    await expect(trackersOutbox.flush(ME)).resolves.toEqual({ sent: 1, left: 0, dropped: 0, reasons: [] })
  })

  it("never sends one account's writes for another, and forgets only one account's queue", async () => {
    trackersOutbox.enqueue(ME, entry('e1'))
    await expect(trackersOutbox.flush(OTHER)).resolves.toEqual({ sent: 0, left: 0, dropped: 0, reasons: [] })
    expect(db.answer).not.toHaveBeenCalled()
    trackersOutbox.enqueue(OTHER, entry('e2'))
    trackersOutbox.forget(ME)
    expect(trackersOutbox.pending(ME)).toEqual([])
    expect(trackersOutbox.pending(OTHER)).toHaveLength(1)
  })
})
