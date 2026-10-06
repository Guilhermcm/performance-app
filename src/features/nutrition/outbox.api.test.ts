// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real nutrition-api wrapper runs here; only the supabase client answers with PostgREST-shaped errors.
const db = vi.hoisted(() => ({ answer: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (row: { id: string }) => db.answer(row.id),
      delete: () => ({ eq: (_c: string, id: string) => db.answer(id) })
    })
  }
}))

import { enqueue, flushOutbox, clearOutbox, pending } from './outbox'
import { ME, logOf } from './test-nutrition'

const ok = { data: null, error: null }
const pg = (code: string, message: string) => ({ data: null, error: { code, message, details: null, hint: null } })

beforeEach(() => { localStorage.clear(); clearOutbox(); db.answer.mockReset().mockResolvedValue(ok) })

const queue3 = () => {
  for (const id of ['a', 'b', 'c']) enqueue(ME, { kind: 'log', op: 'upsert', id, row: logOf({ id }) })
}

describe('outbox through the real api wrapper', () => {
  it('drops a check violation and goes on', async () => {
    queue3()
    db.answer.mockImplementation(async (id: string) => (id === 'b' ? pg('23514', 'new row violates check constraint "food_logs_kcal_check"') : ok))
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 1, reasons: ['refused'] })
  })

  it('drops day_closed and reports that reason', async () => {
    queue3()
    db.answer.mockImplementation(async (id: string) => (id === 'a' ? pg('P0001', 'day_closed') : ok))
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 1, reasons: ['day_closed'] })
  })

  it.each([['too_many_foods'], ['item_immutable'], ['import_forbidden'], ['too_many_items']])('drops %s', async m => {
    enqueue(ME, { kind: 'log', op: 'delete', id: 'a' })
    db.answer.mockResolvedValue(pg('P0001', m))
    await expect(flushOutbox(ME)).resolves.toMatchObject({ dropped: 1, left: 0 })
  })

  it.each([['22001'], ['23503'], ['23505'], ['42501']])('drops SQLSTATE %s', async c => {
    enqueue(ME, { kind: 'log', op: 'delete', id: 'a' })
    db.answer.mockResolvedValue(pg(c, 'boom'))
    await expect(flushOutbox(ME)).resolves.toMatchObject({ dropped: 1, left: 0 })
  })

  it('keeps the queue, in order, on a network failure', async () => {
    queue3()
    db.answer.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 0, left: 3, dropped: 0, reasons: [] })
    expect(pending(ME).map(o => o.id)).toEqual(['a', 'b', 'c'])
    // a 5xx without a SQLSTATE and an unknown P0001 are retried too
    db.answer.mockResolvedValueOnce({ data: null, error: { message: 'Bad gateway' } })
    await expect(flushOutbox(ME)).resolves.toMatchObject({ sent: 0, left: 3 })
    db.answer.mockResolvedValueOnce(pg('P0001', 'something_else'))
    await expect(flushOutbox(ME)).resolves.toMatchObject({ sent: 0, left: 3 })
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 3, left: 0, dropped: 0, reasons: [] })
    expect(db.answer.mock.calls.slice(-3).map(c => c[0])).toEqual(['a', 'b', 'c'])
  })
})
