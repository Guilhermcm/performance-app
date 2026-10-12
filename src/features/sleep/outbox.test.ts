// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real sleep-api wrapper runs here; only the supabase client answers, with PostgREST-shaped errors.
const db = vi.hoisted(() => ({ answer: vi.fn(), session: { access_token: 't' } as object | null }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: db.session } }) },
    from: () => ({
      upsert: (row: { night: string }) => db.answer('upsert', row.night, row),
      delete: () => ({ eq: (_c: string, night: string) => db.answer('delete', night) })
    })
  }
}))

import { sleepOutbox } from './outbox'
import { clearSleepLocal } from './sign-out'
import { ME, OTHER, logOf } from './test-sleep'

const ok = { data: null, error: null }
const pg = (code: string, message: string) => ({ data: null, error: { code, message, details: null, hint: null } })
const upsert = (night: string, over = {}) => ({ op: 'upsert' as const, night, row: logOf({ night, ...over }) })

beforeEach(() => { localStorage.clear(); sleepOutbox.clear(); db.answer.mockReset().mockResolvedValue(ok); db.session = { access_token: 't' } })

describe('sleep outbox', () => {
  it('keeps its queue under perf_sleep_outbox_v1, apart from the diary', () => {
    sleepOutbox.enqueue(ME, upsert('2026-10-05'))
    expect(Object.keys(JSON.parse(localStorage.getItem('perf_sleep_outbox_v1')!))).toEqual([ME])
    expect(localStorage.getItem('perf_food_outbox_v1')).toBeNull()
  })

  it('drops a closed night and keeps the rest', async () => {
    sleepOutbox.enqueue(ME, upsert('2026-10-02'))
    sleepOutbox.enqueue(ME, upsert('2026-10-04'))
    sleepOutbox.enqueue(ME, { op: 'delete', night: '2026-10-05' })
    db.answer.mockImplementation(async (_op: string, night: string) => (night === '2026-10-02' ? pg('P0001', 'night_closed') : ok))
    await expect(sleepOutbox.flush(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 1, reasons: ['night_closed'] })
    expect(db.answer.mock.calls.map(c => [c[0], c[1]])).toEqual([['upsert', '2026-10-02'], ['upsert', '2026-10-04'], ['delete', '2026-10-05']])
  })

  it('is idempotent on the same night', async () => {
    sleepOutbox.enqueue(ME, upsert('2026-10-05', { bed_time: '23:00' }))
    sleepOutbox.enqueue(ME, upsert('2026-10-05', { bed_time: '23:45' }))
    expect(sleepOutbox.pending(ME)).toHaveLength(1)
    await sleepOutbox.flush(ME)
    expect(db.answer).toHaveBeenCalledTimes(1)
    expect(db.answer.mock.calls[0][2]).toMatchObject({ night: '2026-10-05', bed_time: '23:45' })
    // A delete after an upsert of the same night replaces it: only the delete goes.
    sleepOutbox.enqueue(ME, upsert('2026-10-04'))
    sleepOutbox.enqueue(ME, { op: 'delete', night: '2026-10-04' })
    expect(sleepOutbox.pending(ME)).toEqual([{ op: 'delete', night: '2026-10-04' }])
  })

  it('keeps the queue on sign-out and sends it on the next sign-in of the same account', async () => {
    sleepOutbox.enqueue(ME, upsert('2026-10-05'))
    db.session = null
    clearSleepLocal()
    await expect(sleepOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 1, dropped: 0, reasons: [] })
    expect(db.answer).not.toHaveBeenCalled()
    db.session = { access_token: 't' }
    await expect(sleepOutbox.flush(ME)).resolves.toEqual({ sent: 1, left: 0, dropped: 0, reasons: [] })
    expect(db.answer).toHaveBeenCalledWith('upsert', '2026-10-05', expect.anything())
  })

  it("never sends one account's nights for another", async () => {
    sleepOutbox.enqueue(ME, upsert('2026-10-05'))
    await expect(sleepOutbox.flush(OTHER)).resolves.toEqual({ sent: 0, left: 0, dropped: 0, reasons: [] })
    expect(db.answer).not.toHaveBeenCalled()
    expect(sleepOutbox.pending(ME)).toHaveLength(1)
  })

  it('keeps the queue, in order, on a network failure', async () => {
    sleepOutbox.enqueue(ME, upsert('2026-10-04'))
    sleepOutbox.enqueue(ME, upsert('2026-10-05'))
    db.answer.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(sleepOutbox.flush(ME)).resolves.toEqual({ sent: 0, left: 2, dropped: 0, reasons: [] })
    expect(sleepOutbox.pending(ME).map(o => o.night)).toEqual(['2026-10-04', '2026-10-05'])
  })
})
