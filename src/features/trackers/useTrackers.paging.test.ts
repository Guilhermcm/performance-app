// @vitest-environment happy-dom
// The store over the real trackers-api, with only the Supabase client mocked: a 90-day window
// bigger than the API's 1000-row cap reaches the screen and the saved copy whole.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: h.from, auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } }
}))

import { useTrackers } from './useTrackers'
import { trackersOutbox } from './outbox'
import { ME, trackerOf, entryOf } from './test-trackers'

function chain(data: unknown[]) {
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data, error: null })
      return () => proxy
    }
  })
  return proxy
}

beforeEach(() => {
  localStorage.clear(); trackersOutbox.clear()
  useTrackers.getState().reset()
  h.from.mockReset()
})

describe('useTrackers over the paged read', () => {
  it('keeps every entry of a window past 1000 rows, newest included', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T15:00:00Z'))
    const row = (i: number, day: string) => ({ ...entryOf(day, { id: `p${String(i).padStart(4, '0')}` }), at: '09:00:00' })
    const pages = [Array.from({ length: 1000 }, (_, i) => row(i, '2026-10-01')), [row(1000, '2026-10-16'), row(1001, '2026-10-16')]]
    h.from.mockImplementation((table: string) => (table === 'trackers' ? chain([trackerOf()]) : chain(pages.shift() ?? [])))
    await useTrackers.getState().bind(ME)
    const s = useTrackers.getState()
    expect(s.entries).toHaveLength(1002)
    expect(s.lastEntryOf(trackerOf().id)?.id).toBe('p1001')
    expect(JSON.parse(localStorage.getItem('perf_trackers_v1') || 'null').entries).toHaveLength(1002)
    vi.useRealTimers()
  })
})
