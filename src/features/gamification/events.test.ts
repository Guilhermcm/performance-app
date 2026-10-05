// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ results: [] as { error: null | { code: string; message: string } }[], inserts: [] as unknown[], session: { user: { id: 'u1' } } as unknown }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: h.session } }) },
    from: () => ({ insert: async (row: unknown) => { h.inserts.push(row); return h.results.shift() ?? { error: null } } })
  }
}))

import { emit, flush, clearEventQueue } from './events'

const queue = () => JSON.parse(localStorage.getItem('perf_event_queue_v1') || '[]')

beforeEach(() => {
  localStorage.clear()
  h.results = []
  h.inserts = []
  h.session = { user: { id: 'u1' } }
})

describe('event queue', () => {
  it('queues with the pillar derived from the kind', () => {
    h.session = null
    emit('workout_completed', { n: 1 }, 'w1', '2026-10-05')
    expect(queue()).toEqual([{ pillar: 'strength', kind: 'workout_completed', payload: { n: 1 }, source_ref: 'w1', occurred_on: '2026-10-05' }])
  })

  it('does not queue the same event twice', () => {
    h.session = null
    emit('pr', {}, 'w1:0025', '2026-10-05')
    emit('pr', {}, 'w1:0025', '2026-10-05')
    expect(queue()).toHaveLength(1)
  })

  it('sends everything and empties the queue', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    emit('weight_logged', {}, 'b', '2026-10-05')
    h.session = { user: { id: 'u1' } }
    await expect(flush()).resolves.toEqual({ sent: 2, left: 0 })
    expect(queue()).toEqual([])
  })

  it('treats a duplicate as delivered', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    h.session = { user: { id: 'u1' } }
    h.results = [{ error: { code: '23505', message: 'duplicate key' } }]
    await expect(flush()).resolves.toEqual({ sent: 1, left: 0 })
  })

  it('drops an event the server refuses as invalid', async () => {
    h.session = null
    emit('pr', {}, 'a', '2020-01-01')
    h.session = { user: { id: 'u1' } }
    h.results = [{ error: { code: '22023', message: 'out_of_window' } }]
    await expect(flush()).resolves.toEqual({ sent: 0, left: 0 })
  })

  it('keeps the event on a network failure', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    h.session = { user: { id: 'u1' } }
    h.results = [{ error: { code: '', message: 'Failed to fetch' } }]
    await expect(flush()).resolves.toEqual({ sent: 0, left: 1 })
    expect(queue()).toHaveLength(1)
  })

  it('keeps everything while signed out', async () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    await expect(flush()).resolves.toEqual({ sent: 0, left: 1 })
    expect(h.inserts).toEqual([])
  })

  it('clears the queue', () => {
    h.session = null
    emit('pr', {}, 'a', '2026-10-05')
    clearEventQueue()
    expect(queue()).toEqual([])
  })
})
