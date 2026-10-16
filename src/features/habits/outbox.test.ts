// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real habits-api wrapper runs here; only the supabase client answers, with PostgREST-shaped errors.
const db = vi.hoisted(() => ({ answer: vi.fn(), session: { access_token: 't' } as object | null }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: db.session } }) },
    from: (table: string) => ({
      upsert: (row: Record<string, string>) =>
        table === 'habits' ? db.answer('habit', row.name, row) : db.answer('check', `${row.habit_id}:${row.day}`, row),
      update: (row: Record<string, unknown>) => ({ eq: (_c: string, id: string) => db.answer('sort', id, row) }),
      delete: () => ({ eq: (_c: string, habit: string) => ({ eq: (_d: string, day: string) => db.answer('uncheck', `${habit}:${day}`) }) })
    })
  }
}))

import { habitsOutbox, type HabitOp } from './outbox'
import { clearHabitsLocal } from './sign-out'
import { ME, OTHER, H1, H2, habitOf } from './test-habits'

const ok = { data: null, error: null }
const pg = (code: string, message: string) => ({ data: null, error: { code, message, details: null, hint: null } })
const check = (habit_id: string, day: string): HabitOp => ({ op: 'check', habit_id, day })
const uncheck = (habit_id: string, day: string): HabitOp => ({ op: 'uncheck', habit_id, day })
const sent = () => db.answer.mock.calls.map(c => [c[0], c[1]])

beforeEach(() => { localStorage.clear(); habitsOutbox.clear(); db.answer.mockReset().mockResolvedValue(ok); db.session = { access_token: 't' } })

describe('habits outbox', () => {
  it('keeps its queue under perf_habits_outbox_v1, apart from the other pillars', () => {
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    expect(Object.keys(JSON.parse(localStorage.getItem('perf_habits_outbox_v1')!))).toEqual([ME])
    expect(localStorage.getItem('perf_sleep_outbox_v1')).toBeNull()
  })

  it('drops a closed day and keeps the rest', async () => {
    habitsOutbox.enqueue(ME, check(H1, '2026-10-03'))
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    habitsOutbox.enqueue(ME, uncheck(H2, '2026-10-04'))
    db.answer.mockImplementation(async (_op: string, key: string) => (key.endsWith('2026-10-03') ? pg('P0001', 'day_closed') : ok))
    await expect(habitsOutbox.flush(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 1, reasons: ['day_closed'] })
    expect(sent()).toEqual([['check', `${H1}:2026-10-03`], ['check', `${H1}:2026-10-05`], ['uncheck', `${H2}:2026-10-04`]])
  })

  it('drops the habit refusals as plain refusals', async () => {
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    habitsOutbox.enqueue(ME, check(H2, '2026-10-05'))
    habitsOutbox.enqueue(ME, { op: 'habit', row: habitOf({ id: H2, name: 'Walk' }) })
    db.answer.mockImplementation(async (op: string, key: string) =>
      op === 'habit' ? pg('P0001', 'too_many_habits') : key.startsWith(H1) ? pg('P0001', 'habit_archived') : pg('P0001', 'pillar_off'))
    await expect(habitsOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 0, dropped: 3, reasons: ['refused'] })
  })

  it('collapses a check and its undo', async () => {
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    habitsOutbox.enqueue(ME, check(H2, '2026-10-05'))
    habitsOutbox.enqueue(ME, uncheck(H1, '2026-10-05'))
    // Only the newest op of a habit and day stays: the undo (the server may have the check already).
    expect(habitsOutbox.pending(ME)).toEqual([check(H2, '2026-10-05'), uncheck(H1, '2026-10-05')])
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    expect(habitsOutbox.pending(ME)).toEqual([check(H2, '2026-10-05'), check(H1, '2026-10-05')])
    // Another day of the same habit is another item.
    habitsOutbox.enqueue(ME, check(H1, '2026-10-04'))
    expect(habitsOutbox.pending(ME)).toHaveLength(3)
  })

  it('sends a habit created offline before its check, even after an edit', async () => {
    const created = habitOf({ id: H2, name: 'Walk', updated_at: '2026-10-05T10:00:00.000Z' })
    habitsOutbox.enqueue(ME, { op: 'habit', row: created })
    habitsOutbox.enqueue(ME, check(H2, '2026-10-05'))
    habitsOutbox.enqueue(ME, { op: 'habit', row: { ...created, name: 'Walk 5k', updated_at: '2026-10-05T10:05:00.000Z' } })
    expect(habitsOutbox.pending(ME)).toHaveLength(3)
    await expect(habitsOutbox.flush(ME)).resolves.toMatchObject({ sent: 3, left: 0, dropped: 0 })
    expect(sent()).toEqual([['habit', 'Walk'], ['check', `${H2}:2026-10-05`], ['habit', 'Walk 5k']])
  })

  it('sends a reorder as the sort alone, after the habit, and never collapses it', async () => {
    habitsOutbox.enqueue(ME, { op: 'habit', row: habitOf({ id: H2, name: 'Walk' }) })
    habitsOutbox.enqueue(ME, { op: 'sort', id: H2, sort: 1, updated_at: '2026-10-05T10:00:00.000Z' })
    habitsOutbox.enqueue(ME, { op: 'sort', id: H2, sort: 0, updated_at: '2026-10-05T10:01:00.000Z' })
    expect(habitsOutbox.pending(ME)).toHaveLength(3)
    await expect(habitsOutbox.flush(ME)).resolves.toMatchObject({ sent: 3, left: 0, dropped: 0 })
    expect(db.answer.mock.calls.map(c => [c[0], c[1], c[2]])).toEqual([
      ['habit', 'Walk', expect.anything()],
      ['sort', H2, { sort: 1, updated_at: '2026-10-05T10:00:00.000Z' }],
      ['sort', H2, { sort: 0, updated_at: '2026-10-05T10:01:00.000Z' }]
    ])
  })

  it('keeps the queue on sign-out and sends it on the next sign-in of the same account', async () => {
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    db.session = null
    clearHabitsLocal()
    await expect(habitsOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 1, dropped: 0, reasons: [] })
    expect(db.answer).not.toHaveBeenCalled()
    db.session = { access_token: 't' }
    await expect(habitsOutbox.flush(ME)).resolves.toEqual({ sent: 1, left: 0, dropped: 0, reasons: [] })
    expect(sent()).toEqual([['check', `${H1}:2026-10-05`]])
  })

  it("never sends one account's checks for another", async () => {
    habitsOutbox.enqueue(ME, check(H1, '2026-10-05'))
    await expect(habitsOutbox.flush(OTHER)).resolves.toEqual({ sent: 0, left: 0, dropped: 0, reasons: [] })
    expect(db.answer).not.toHaveBeenCalled()
    expect(habitsOutbox.pending(ME)).toHaveLength(1)
    // Deleting an account forgets only its queue.
    habitsOutbox.enqueue(OTHER, check(H2, '2026-10-05'))
    habitsOutbox.forget(ME)
    expect(habitsOutbox.pending(ME)).toEqual([])
    expect(habitsOutbox.pending(OTHER)).toHaveLength(1)
  })

  it('keeps the queue, in order, on a network failure', async () => {
    habitsOutbox.enqueue(ME, { op: 'habit', row: habitOf({ id: H2 }) })
    habitsOutbox.enqueue(ME, check(H2, '2026-10-05'))
    db.answer.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(habitsOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 2, dropped: 0, reasons: [] })
    expect(habitsOutbox.pending(ME).map(o => o.op)).toEqual(['habit', 'check'])
  })
})
