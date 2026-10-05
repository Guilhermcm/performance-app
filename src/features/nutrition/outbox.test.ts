// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
const api = vi.hoisted(() => ({ upsertLog: vi.fn(), deleteLog: vi.fn(), upsertFood: vi.fn(), deleteFood: vi.fn() }))
vi.mock('./nutrition-api', async orig => ({ ...(await orig<typeof import('./nutrition-api')>()), ...api }))

import { enqueue, flushOutbox, clearOutbox, pending } from './outbox'
import { ME, OTHER, logOf } from './test-nutrition'

const refused = (m: string) => Object.assign(new Error(m), { code: m })

beforeEach(() => {
  localStorage.clear(); clearOutbox()
  Object.values(api).forEach(f => f.mockReset().mockResolvedValue(undefined))
})

describe('food outbox', () => {
  it('sends in order and drops what the server refuses as closed', async () => {
    const [a, b, c] = ['a', 'b', 'c'].map(id => logOf({ id }))
    for (const l of [a, b, c]) enqueue(ME, { kind: 'log', op: 'upsert', id: l.id, row: l })
    api.upsertLog.mockImplementation(async (l: { id: string }) => { if (l.id === 'b') throw refused('day_closed') })
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 1 })
    expect(api.upsertLog.mock.calls.map(x => x[0].id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps ops on network errors and retries later', async () => {
    const a = logOf({ id: 'a' }), b = logOf({ id: 'b' })
    enqueue(ME, { kind: 'log', op: 'upsert', id: 'a', row: a })
    enqueue(ME, { kind: 'log', op: 'delete', id: 'b' })
    api.upsertLog.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 0, left: 2, dropped: 0 })
    expect(api.deleteLog).not.toHaveBeenCalled()
    await expect(flushOutbox(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 0 })
    expect(b.id).toBe('b')
  })

  it('collapses ops on the same id', async () => {
    const a = logOf({ id: 'a', kcal: 100 })
    enqueue(ME, { kind: 'log', op: 'upsert', id: 'a', row: a })
    enqueue(ME, { kind: 'log', op: 'upsert', id: 'a', row: { ...a, kcal: 300 } })
    expect(pending(ME)).toHaveLength(1)
    enqueue(ME, { kind: 'log', op: 'delete', id: 'a' })
    expect(pending(ME)).toEqual([{ kind: 'log', op: 'delete', id: 'a' }])
    await flushOutbox(ME)
    expect(api.upsertLog).not.toHaveBeenCalled()
    expect(api.deleteLog).toHaveBeenCalledWith('a')
  })

  it('keeps queues apart by account', async () => {
    enqueue(ME, { kind: 'log', op: 'delete', id: 'a' })
    enqueue(OTHER, { kind: 'log', op: 'delete', id: 'z' })
    await flushOutbox(ME)
    expect(api.deleteLog).toHaveBeenCalledTimes(1)
    expect(pending(OTHER)).toHaveLength(1)
    clearOutbox()
    expect(pending(OTHER)).toEqual([])
  })
})
