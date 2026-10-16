// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
const api = vi.hoisted(() => ({
  fetchTrackers: vi.fn(), fetchEntries: vi.fn(), upsertTracker: vi.fn(), updateTrackerSort: vi.fn(), upsertEntry: vi.fn(), deleteEntry: vi.fn()
}))
vi.mock('./trackers-api', async orig => ({ ...(await orig<typeof import('./trackers-api')>()), ...api }))

import { useTrackers, startTrackersSync, droppedNoticeText } from './useTrackers'
import { trackersOutbox } from './outbox'
import { toTrackerError } from './trackers-api'
import { useProfile } from '../profile/useProfile'
import { ME, OTHER, T1, T2, trackerOf, entryOf } from './test-trackers'
import type { Tracker, TrackerEntry } from './types'

// 12:00 in Sao Paulo (the zone used without a profile) on Friday 2026-10-16; the window starts 89 days before.
const NOW = new Date('2026-10-16T15:00:00Z')
const TODAY = '2026-10-16', FROM = '2026-07-19'
const CACHE = 'perf_trackers_v1'
const cache = () => JSON.parse(localStorage.getItem(CACHE) || 'null')
const settle = () => new Promise(r => setTimeout(r, 0))
const refused = (m: string) => Object.assign(new Error(m), { code: 'P0001' })
const offline = () => new TypeError('Failed to fetch')
const WEIGHT = trackerOf({ id: T2, name: 'Weight', icon: 'scale', unit: 'kg', decimals: 1, aggregate: 'avg', sort: 1 })
// An entry the way the store writes it, without the id and the time of the write.
const draft = (over: Partial<TrackerEntry> = {}) => {
  const { id: _id, updated_at: _u, ...rest } = entryOf(TODAY, over)
  return rest
}

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear(); trackersOutbox.clear()
  useProfile.setState({ profile: null })
  useTrackers.getState().reset()
  Object.values(api).forEach(f => f.mockReset().mockResolvedValue(undefined))
  api.fetchTrackers.mockResolvedValue([]); api.fetchEntries.mockResolvedValue([])
})

async function bound() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  await useTrackers.getState().bind(ME)
}

async function withTrackers(entries: TrackerEntry[] = []) {
  api.fetchTrackers.mockResolvedValue([trackerOf(), WEIGHT])
  api.fetchEntries.mockResolvedValue(entries)
  await bound()
}

describe('useTrackers', () => {
  it('shows the saved copy of the account at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
    const e = entryOf(TODAY, { id: 'e1' })
    localStorage.setItem(CACHE, JSON.stringify({ userId: ME, trackers: [trackerOf()], entries: [e], from: FROM }))
    let release!: (v: unknown[]) => void
    api.fetchTrackers.mockReturnValue(new Promise(r => { release = r }))
    const p = useTrackers.getState().bind(ME)
    expect(useTrackers.getState()).toMatchObject({ userId: ME, status: 'ready', trackers: [trackerOf()], entries: [e], from: FROM })
    release([]); await p
    expect(useTrackers.getState()).toMatchObject({ status: 'ready', trackers: [], entries: [] })
  })

  it('ignores a saved copy that belongs to someone else', () => {
    localStorage.setItem(CACHE, JSON.stringify({ userId: OTHER, trackers: [trackerOf()], entries: [], from: FROM }))
    api.fetchTrackers.mockReturnValue(new Promise(() => {}))
    void useTrackers.getState().bind(ME)
    expect(useTrackers.getState()).toMatchObject({ trackers: [], status: 'loading' })
  })

  it('pulls every tracker and the entries of the last 90 days, and saves them for this account', async () => {
    const e = entryOf('2026-10-15', { id: 'e1' })
    await withTrackers([e])
    expect(api.fetchEntries).toHaveBeenCalledWith(FROM)
    const s = useTrackers.getState()
    expect(s).toMatchObject({ status: 'ready', from: FROM, entries: [e] })
    expect(s.trackers.map(t => t.id)).toEqual([T1, T2])
    expect(cache()).toMatchObject({ userId: ME, from: FROM, entries: [e] })
  })

  it('counts the 90 days from today in the profile time zone', async () => {
    // 00:30 of Saturday 17 in Tokyo, still Friday 16 in Sao Paulo.
    useProfile.setState({ profile: { timezone: 'Asia/Tokyo' } as never })
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T15:30:00Z'))
    await useTrackers.getState().bind(ME)
    expect(api.fetchEntries).toHaveBeenCalledWith('2026-07-20')
    expect(useTrackers.getState().from).toBe('2026-07-20')
  })

  it('is an error without a saved copy, and keeps the saved copy when a pull fails', async () => {
    api.fetchEntries.mockRejectedValue(offline())
    await bound()
    expect(useTrackers.getState().status).toBe('error')
    useTrackers.getState().reset()
    localStorage.setItem(CACHE, JSON.stringify({ userId: ME, trackers: [trackerOf()], entries: [], from: FROM }))
    await useTrackers.getState().bind(ME)
    expect(useTrackers.getState()).toMatchObject({ status: 'ready', trackers: [trackerOf()] })
  })

  it('creates a tracker with a new id at the end of the list, shown and queued at once', async () => {
    await withTrackers()
    api.upsertTracker.mockRejectedValue(offline())
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    const t = useTrackers.getState().saveTracker({ name: ' Mood ', icon: 'smile', kind: 'label', options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }] })
    expect(t).toEqual({
      id: '00000000-0000-4000-8000-000000000001', name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null,
      options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }], sort: 2, archived_at: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString()
    })
    expect(useTrackers.getState().active().map(x => x.id)).toEqual([T1, T2, t.id])
    expect(cache().trackers).toHaveLength(3)
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'tracker', row: t }])
  })

  it('edits a tracker in place, keeping its kind, sort and creation', async () => {
    await withTrackers()
    const e = useTrackers.getState().saveTracker({ id: T1, name: 'Water intake', icon: 'droplet', kind: 'duration', unit: 'ml', decimals: 0 })
    expect(e).toEqual({ ...trackerOf(), name: 'Water intake', unit: 'ml', decimals: 0, updated_at: NOW.toISOString() })
    expect(useTrackers.getState().trackers[0]).toEqual(e)
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'tracker', row: e }])
  })

  it('saves an entry as it comes, with the time of the write, and finds it by tracker', async () => {
    await withTrackers([entryOf('2026-10-14', { id: 'old', value: 2 })])
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-0000000000e1')
    const e = useTrackers.getState().saveEntry(draft({ value: 1.8, at: '12:00' }))
    expect(e).toEqual({ ...entryOf(TODAY, { value: 1.8, at: '12:00' }), id: '00000000-0000-4000-8000-0000000000e1', updated_at: NOW.toISOString() })
    expect(useTrackers.getState().entriesOf(T1).map(x => x.id)).toEqual(['old', e.id])
    expect(useTrackers.getState().entriesOf(T2)).toEqual([])
    expect(useTrackers.getState().lastEntryOf(T1)).toEqual(e)
    expect(useTrackers.getState().lastEntryOf(T2)).toBeNull()
    expect(cache().entries).toHaveLength(2)
    await settle()
    expect(api.upsertEntry).toHaveBeenCalledWith(e)
    // Editing keeps the id.
    const edited = useTrackers.getState().saveEntry({ ...draft({ value: 2.1 }), id: e.id })
    expect(edited.id).toBe(e.id)
    expect(useTrackers.getState().entriesOf(T1).map(x => x.value)).toEqual([2, 2.1])
  })

  it('keeps the entries in day and time order, the latest last', async () => {
    await withTrackers()
    const late = useTrackers.getState().saveEntry(draft({ at: '21:00' }))
    const early = useTrackers.getState().saveEntry(draft({ at: '07:00' }))
    const yesterday = useTrackers.getState().saveEntry(draft({ day: '2026-10-15', at: '23:00' }))
    expect(useTrackers.getState().entriesOf(T1).map(x => x.id)).toEqual([yesterday.id, early.id, late.id])
    expect(useTrackers.getState().lastEntryOf(T1)).toEqual(late)
  })

  it('deletes an entry at once and queues the delete in place of its write', async () => {
    await withTrackers()
    api.upsertEntry.mockRejectedValue(offline())
    api.deleteEntry.mockRejectedValue(offline())
    const e = useTrackers.getState().saveEntry(draft())
    await settle()
    useTrackers.getState().deleteEntry(e.id)
    expect(useTrackers.getState().entries).toEqual([])
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'delete', id: e.id }])
  })

  it('keeps an entry edited after its tracker was archived offline ahead of the archive', async () => {
    await withTrackers()
    api.upsertEntry.mockRejectedValue(offline())
    const e = useTrackers.getState().saveEntry(draft())
    useTrackers.getState().archiveTracker(T1)
    const edited = useTrackers.getState().saveEntry({ ...draft({ value: 2 }), id: e.id })
    await settle()
    const archived = useTrackers.getState().trackers.find(x => x.id === T1)!
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'entry', row: edited }, { op: 'tracker', row: archived }])
    // The server takes the entry while the tracker is still active, then the archive.
    let isArchived = false
    api.upsertEntry.mockImplementation(async () => { if (isArchived) throw refused('tracker_archived') })
    api.upsertTracker.mockImplementation(async (x: Tracker) => { isArchived = !!x.archived_at })
    await useTrackers.getState().refresh()
    expect(api.upsertEntry).toHaveBeenLastCalledWith(edited)
    expect(trackersOutbox.pending(ME)).toEqual([])
    expect(useTrackers.getState().droppedNotice).toBeNull()
  })

  // A server that checks an entry against the tracker it has at that moment, as the guard does:
  // the option must exist and the value must fit the decimals; a new entry needs an active tracker.
  function fakeServer(start: Tracker) {
    const server = { tracker: start, entries: new Map<string, TrackerEntry>(), order: [] as string[] }
    api.upsertTracker.mockImplementation(async (x: Tracker) => { server.tracker = x; server.order.push(`tracker:${x.archived_at ? 'archived' : 'active'}`) })
    api.upsertEntry.mockImplementation(async (e: TrackerEntry) => {
      const t = server.tracker
      if (t.archived_at && !server.entries.has(e.id)) throw refused('tracker_archived')
      if (t.kind === 'label' && !t.options?.some(o => o.id === e.option)) throw refused('invalid_value')
      if (t.kind === 'number' && e.value != null && Number(e.value.toFixed(t.decimals ?? 2)) !== e.value) throw refused('invalid_value')
      server.entries.set(e.id, e); server.order.push('entry')
    })
    return server
  }

  it('sends an entry relabeled offline after the tracker edit that added its option', async () => {
    const mood = trackerOf({ id: T2, name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 1,
      options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }] })
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    api.upsertEntry.mockRejectedValue(offline()); api.upsertTracker.mockRejectedValue(offline())
    const e = useTrackers.getState().saveEntry(draft({ tracker_id: T2, value: null, option: 'a' }))
    const edit = useTrackers.getState().saveTracker({ ...mood, options: [...mood.options!, { id: 'c', text: 'great' }] })
    const relabeled = useTrackers.getState().saveEntry({ ...draft({ tracker_id: T2, value: null, option: 'c' }), id: e.id })
    await settle()
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'tracker', row: edit }, { op: 'entry', row: relabeled }])
    const server = fakeServer(mood)
    await useTrackers.getState().refresh()
    expect(server.entries.get(e.id)?.option).toBe('c')
    expect(trackersOutbox.pending(ME)).toEqual([])
    expect(useTrackers.getState().droppedNotice).toBeNull()
  })

  it('sends an entry edited offline after the tracker edit that raised its decimals', async () => {
    const steps = trackerOf({ decimals: 0 })
    api.fetchTrackers.mockResolvedValue([steps, WEIGHT])
    await bound()
    api.upsertEntry.mockRejectedValue(offline()); api.upsertTracker.mockRejectedValue(offline())
    const e = useTrackers.getState().saveEntry(draft({ value: 2 }))
    useTrackers.getState().saveTracker({ ...steps, decimals: 1 })
    useTrackers.getState().saveEntry({ ...draft({ value: 2.5 }), id: e.id })
    await settle()
    const server = fakeServer(steps)
    await useTrackers.getState().refresh()
    expect(server.entries.get(e.id)?.value).toBe(2.5)
    expect(server.order).toEqual(['tracker:active', 'entry'])
    expect(useTrackers.getState().droppedNotice).toBeNull()
  })

  it('sends an entry edited offline after an option edit and before a later archive', async () => {
    const mood = trackerOf({ id: T2, name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 1,
      options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }] })
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    api.upsertEntry.mockRejectedValue(offline()); api.upsertTracker.mockRejectedValue(offline())
    const e = useTrackers.getState().saveEntry(draft({ tracker_id: T2, value: null, option: 'a' }))
    useTrackers.getState().saveTracker({ ...mood, options: [...mood.options!, { id: 'c', text: 'great' }] })
    useTrackers.getState().archiveTracker(T2)
    useTrackers.getState().saveEntry({ ...draft({ tracker_id: T2, value: null, option: 'c' }), id: e.id })
    await settle()
    const server = fakeServer(mood)
    await useTrackers.getState().refresh()
    expect(server.order).toEqual(['tracker:active', 'entry', 'tracker:archived'])
    expect(server.entries.get(e.id)?.option).toBe('c')
    expect(useTrackers.getState().droppedNotice).toBeNull()
  })

  it('sends a tracker made offline before its entries, and its rename after them', async () => {
    await withTrackers()
    api.upsertTracker.mockRejectedValue(offline())
    const t = useTrackers.getState().saveTracker({ name: 'Steps', icon: 'footprints', kind: 'number', unit: 'steps', decimals: 0, aggregate: 'sum' })
    const a = useTrackers.getState().saveEntry(draft({ tracker_id: t.id, value: 4000 }))
    const b = useTrackers.getState().saveEntry(draft({ tracker_id: t.id, value: 6000 }))
    const renamed = useTrackers.getState().saveTracker({ ...t, name: 'Daily steps' })
    await settle()
    expect(trackersOutbox.pending(ME)).toEqual([
      { op: 'tracker', row: t }, { op: 'entry', row: a }, { op: 'entry', row: b }, { op: 'tracker', row: renamed }
    ])
    api.upsertTracker.mockResolvedValue(undefined)
    const order: string[] = []
    api.upsertTracker.mockImplementation(async (x: { name: string }) => { order.push(x.name) })
    api.upsertEntry.mockImplementation(async (x: { value: number }) => { order.push(String(x.value)) })
    await useTrackers.getState().refresh()
    expect(order).toEqual(['Steps', '4000', '6000', 'Daily steps'])
  })

  it('drops an entry the server refuses for an archived tracker, and says so once', async () => {
    await withTrackers()
    api.upsertEntry.mockRejectedValue(refused('tracker_archived'))
    const e = useTrackers.getState().saveEntry(draft())
    expect(useTrackers.getState().entries).toEqual([e])
    await settle(); await settle()
    expect(trackersOutbox.pending(ME)).toEqual([])
    expect(useTrackers.getState().entries).toEqual([])
    expect(cache().entries).toEqual([])
    expect(useTrackers.getState().droppedNotice).toBe('tracker_archived')
    expect(droppedNoticeText('tracker_archived')).toBe('Some entries for archived trackers were not saved.')
    useTrackers.getState().dismissDropped()
    await useTrackers.getState().refresh()
    expect(useTrackers.getState().droppedNotice).toBeNull()
  })

  it('drops an entry for a day that is still to come there, with its own words', async () => {
    await withTrackers()
    api.upsertEntry.mockRejectedValue(refused('future_day'))
    useTrackers.getState().saveEntry(draft({ day: '2026-10-17' }))
    await settle(); await settle()
    expect(useTrackers.getState().entries).toEqual([])
    expect(useTrackers.getState().droppedNotice).toBe('future_day')
    expect(droppedNoticeText('future_day')).toBe('Some entries dated after today were not saved.')
    // A different refusal before the notice was dismissed takes the general words.
    api.upsertEntry.mockRejectedValue(refused('tracker_archived'))
    useTrackers.getState().saveEntry(draft())
    await settle(); await settle()
    expect(useTrackers.getState().droppedNotice).toBe('refused')
    expect(droppedNoticeText('refused')).toBe('Some tracker changes could not be saved.')
  })

  it('brings back the server copy of an edit it refused', async () => {
    const e = entryOf('2026-10-15', { id: 'e1', value: 2 })
    await withTrackers([e])
    api.upsertEntry.mockRejectedValue(refused('invalid_value'))
    useTrackers.getState().saveEntry({ ...draft({ day: '2026-10-15', value: 2.345 }), id: 'e1' })
    await settle(); await settle(); await settle()
    expect(useTrackers.getState().entries).toEqual([e])
    expect(useTrackers.getState().droppedNotice).toBe('refused')
  })

  it('keeps an option that still has older entries and saves the rest of the edit again', async () => {
    const mood = trackerOf({ id: T2, name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 1,
      options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }, { id: 'c', text: 'meh' }] })
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    // B has entries from before the 90 days the phone holds, so the server refuses its removal.
    api.upsertTracker.mockRejectedValueOnce(refused('option_in_use')).mockRejectedValueOnce(offline())
    const edit = useTrackers.getState().saveTracker({ ...mood, name: 'Mood today', options: [{ id: 'c', text: 'so so' }, { id: 'a', text: 'great' }] })
    expect(useTrackers.getState().trackers[1].options).toEqual(edit.options)
    await settle(); await settle()
    const kept = {
      ...mood, name: 'Mood today', options: [{ id: 'c', text: 'so so' }, { id: 'a', text: 'great' }, { id: 'b', text: 'bad' }],
      updated_at: NOW.toISOString()
    }
    expect(useTrackers.getState().trackers[1]).toEqual(kept)
    expect(cache().trackers[1]).toEqual(kept)
    expect(api.upsertTracker).toHaveBeenCalledTimes(2)
    expect(api.upsertTracker).toHaveBeenLastCalledWith(kept)
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'tracker', row: kept, kept: true }])
    expect(useTrackers.getState().droppedNotice).toBe('option_in_use')
    expect(droppedNoticeText('option_in_use')).toBe('An option you removed has older entries, so it was kept.')
    useTrackers.getState().dismissDropped()
    api.upsertTracker.mockResolvedValue(undefined)
    api.fetchTrackers.mockResolvedValue([trackerOf(), kept])
    await useTrackers.getState().refresh()
    expect(trackersOutbox.pending(ME)).toEqual([])
    expect(useTrackers.getState().droppedNotice).toBeNull()
    expect(useTrackers.getState().trackers[1]).toEqual(kept)
  })

  it('saves an edit again only once when the server keeps refusing an option', async () => {
    const mood = trackerOf({ id: T2, name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 1,
      options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }] })
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    api.upsertTracker.mockRejectedValue(refused('option_in_use'))
    useTrackers.getState().saveTracker({ ...mood, name: 'Mood today', options: [{ id: 'a', text: 'good' }, { id: 'n', text: 'new' }] })
    await settle(); await settle(); await settle()
    await useTrackers.getState().refresh()
    await settle()
    expect(api.upsertTracker).toHaveBeenCalledTimes(2)
    expect(trackersOutbox.pending(ME)).toEqual([])
    // What the server has stays on screen.
    expect(useTrackers.getState().trackers[1]).toEqual(mood)
    expect(useTrackers.getState().droppedNotice).not.toBeNull()
  })

  it('never saves an edit again with more than 8 options: the server copy stays, with its own words', async () => {
    const letters = 'abcdefgh'.split('')
    const mood = trackerOf({ id: T2, name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null, aggregate: null, sort: 1,
      options: letters.map(id => ({ id, text: id })) })
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    // h has entries older than the window; the edit swaps it for a new option, still 8 in the sheet.
    api.upsertTracker.mockRejectedValue(refused('option_in_use'))
    useTrackers.getState().saveTracker({ ...mood, name: 'Mood today', options: [...mood.options!.slice(0, 7), { id: 'n', text: 'new' }] })
    await settle(); await settle(); await settle()
    expect(api.upsertTracker).toHaveBeenCalledTimes(1)
    expect(trackersOutbox.pending(ME)).toEqual([])
    expect(useTrackers.getState().trackers[1]).toEqual(mood)
    expect(useTrackers.getState().droppedNotice).toBe('too_many_options')
    expect(droppedNoticeText('too_many_options')).toBe('An option you removed has older entries, and keeping it would go over 8 options. Your changes were not saved.')
  })

  // A label tracker on the server whose option b has entries older than the window: removing b is refused.
  const moodOf = (over: Partial<Tracker> = {}) => trackerOf({ id: T2, name: 'Mood', icon: 'smile', kind: 'label', unit: null, decimals: null,
    aggregate: null, sort: 1, options: [{ id: 'a', text: 'good' }, { id: 'b', text: 'bad' }], ...over })
  const refuseWithoutB = () => api.upsertTracker.mockImplementation(async (row: Tracker) => {
    if (!row.options?.some(o => o.id === 'b')) throw refused('option_in_use')
  })

  it('keeps an archive queued after a refused edit when the edit is saved again', async () => {
    const mood = moodOf()
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    refuseWithoutB()
    // Offline in practice: the edit and the archive both wait in the queue when the refusal comes.
    useTrackers.getState().saveTracker({ ...mood, options: [{ id: 'a', text: 'great' }] })
    useTrackers.getState().archiveTracker(T2)
    await settle(); await settle(); await settle()
    const t = useTrackers.getState().trackers.find(x => x.id === T2)!
    expect(t).toMatchObject({ archived_at: NOW.toISOString(), options: [{ id: 'a', text: 'great' }, { id: 'b', text: 'bad' }] })
    expect(useTrackers.getState().active().map(x => x.id)).toEqual([T1])
    expect(api.upsertTracker).toHaveBeenLastCalledWith(t)
    expect(trackersOutbox.pending(ME)).toEqual([])
  })

  it('keeps a reactivation queued after a refused edit when the edit is saved again', async () => {
    const mood = moodOf({ archived_at: '2026-10-01T10:00:00.000Z' })
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    refuseWithoutB()
    useTrackers.getState().saveTracker({ ...mood, options: [{ id: 'a', text: 'great' }] })
    useTrackers.getState().reactivateTracker(T2)
    await settle(); await settle(); await settle()
    const t = useTrackers.getState().trackers.find(x => x.id === T2)!
    expect(t).toMatchObject({ archived_at: null, options: [{ id: 'a', text: 'great' }, { id: 'b', text: 'bad' }] })
    expect(useTrackers.getState().active().map(x => x.id)).toEqual([T1, T2])
    expect(api.upsertTracker).toHaveBeenLastCalledWith(t)
  })

  it.each([
    ['reset', () => { useTrackers.getState().reset(); return useTrackers.getState().bind(OTHER) }],
    ['bind of another account', () => useTrackers.getState().bind(OTHER)]
  ])('never saves a pending edit again for the next account after %s', async (_, next) => {
    const mood = moodOf()
    api.fetchTrackers.mockResolvedValue([trackerOf(), mood])
    await bound()
    api.upsertTracker.mockRejectedValueOnce(refused('option_in_use'))
    // The pull after the refusal never answers: the edit waits to be saved again.
    api.fetchTrackers.mockReturnValueOnce(new Promise(() => {}))
    useTrackers.getState().saveTracker({ ...mood, name: 'Mood today', options: [{ id: 'a', text: 'great' }] })
    await settle(); await settle()
    expect(api.upsertTracker).toHaveBeenCalledTimes(1)
    // The next account happens to hold a tracker with the same id.
    await next()
    await settle(); await settle()
    expect(api.upsertTracker).toHaveBeenCalledTimes(1)
    expect(useTrackers.getState().userId).toBe(OTHER)
    expect(useTrackers.getState().trackers.find(x => x.id === T2)).toEqual(mood)
    expect(trackersOutbox.pending(OTHER)).toEqual([])
  })

  it('keeps an entry made while a pull was on its way, and pulls again', async () => {
    await withTrackers()
    let release!: (v: TrackerEntry[]) => void
    api.fetchEntries.mockReturnValueOnce(new Promise(r => { release = r }))
    const first = useTrackers.getState().refresh()
    await settle()
    // The write lands after the reads went out; it goes and leaves the queue before they answer.
    const e = useTrackers.getState().saveEntry(draft())
    await settle()
    expect(api.upsertEntry).toHaveBeenCalledWith(e)
    expect(trackersOutbox.pending(ME)).toEqual([])
    api.fetchEntries.mockResolvedValue([e])
    release([])
    await first
    expect(useTrackers.getState().entries).toEqual([e])
    // The second pull, started as the first one ended, reads the server with the entry.
    await useTrackers.getState().refresh()
    expect(api.fetchEntries).toHaveBeenCalledTimes(3)
    expect(useTrackers.getState().entries).toEqual([e])
  })

  it('lays what is still queued over what the server sent', async () => {
    const kept = entryOf('2026-10-15', { id: 'kept' })
    const gone = entryOf('2026-10-15', { id: 'gone' })
    await withTrackers([kept, gone])
    api.upsertEntry.mockRejectedValue(offline())
    api.deleteEntry.mockRejectedValue(offline())
    api.upsertTracker.mockRejectedValue(offline())
    useTrackers.getState().deleteEntry('gone')
    const e = useTrackers.getState().saveEntry(draft())
    const t = useTrackers.getState().saveTracker({ name: 'Steps', icon: 'footprints', kind: 'number', unit: null, decimals: 0, aggregate: 'sum' })
    await settle()
    await useTrackers.getState().refresh()
    const s = useTrackers.getState()
    expect(s.entries).toEqual([kept, e])
    expect(s.trackers.map(x => x.id)).toEqual([T1, T2, t.id])
  })

  it('does not lay a write over the answer when the server refused it during the reads', async () => {
    await withTrackers()
    api.upsertEntry.mockRejectedValueOnce(offline())
    useTrackers.getState().saveEntry(draft())
    await settle()
    expect(trackersOutbox.pending(ME)).toHaveLength(1)
    api.upsertEntry.mockRejectedValueOnce(offline())
    let release!: (v: TrackerEntry[]) => void
    api.fetchEntries.mockReturnValueOnce(new Promise(r => { release = r }))
    const pull = useTrackers.getState().refresh()
    await settle()
    api.upsertEntry.mockRejectedValueOnce(refused('tracker_archived'))
    await useTrackers.getState().flushPending()
    expect(trackersOutbox.pending(ME)).toEqual([])
    release([])
    await pull
    expect(useTrackers.getState().entries).toEqual([])
  })

  it('lists active and archived trackers apart, and archives and reactivates them', async () => {
    await withTrackers()
    useTrackers.getState().archiveTracker(T2)
    const s = useTrackers.getState()
    expect(s.active().map(t => t.id)).toEqual([T1])
    expect(s.archived().map(t => t.id)).toEqual([T2])
    expect(s.archived()[0]).toMatchObject({ archived_at: NOW.toISOString(), updated_at: NOW.toISOString() })
    expect(trackersOutbox.pending(ME)).toEqual([{ op: 'tracker', row: s.archived()[0] }])
    useTrackers.getState().reactivateTracker(T2)
    expect(useTrackers.getState().active().map(t => t.id)).toEqual([T1, T2])
    expect(useTrackers.getState().archived()).toEqual([])
  })

  it('blocks the 31st active tracker locally', async () => {
    api.fetchTrackers.mockResolvedValue([
      ...Array.from({ length: 30 }, (_, i) => trackerOf({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, sort: i })),
      trackerOf({ id: T2, sort: 30, archived_at: '2026-09-30T10:00:00.000Z' })
    ])
    await bound()
    const e = (() => { try { useTrackers.getState().saveTracker({ name: 'One more', icon: 'check', kind: 'duration', aggregate: 'sum' }) } catch (x) { return x } })()
    expect(toTrackerError(e)).toBe('too_many_trackers')
    expect(() => useTrackers.getState().reactivateTracker(T2)).toThrow()
    expect(useTrackers.getState().active()).toHaveLength(30)
    expect(trackersOutbox.pending(ME)).toEqual([])
    // Editing one of the 30 is fine.
    expect(() => useTrackers.getState().saveTracker({ id: '00000000-0000-4000-8000-000000000100', name: 'Water', icon: 'droplet', kind: 'number' })).not.toThrow()
  })

  it('moves a tracker by renumbering the active ones and sends only the sorts that changed', async () => {
    const T3 = '00000000-0000-0000-0000-0000000000c3'
    api.fetchTrackers.mockResolvedValue([trackerOf({ sort: 0 }), trackerOf({ id: T2, sort: 0 }), trackerOf({ id: T3, sort: 0 })])
    await bound()
    useTrackers.getState().move(T3, -1)
    expect(useTrackers.getState().active().map(t => [t.id, t.sort])).toEqual([[T1, 0], [T3, 1], [T2, 2]])
    expect(trackersOutbox.pending(ME)).toEqual([
      { op: 'sort', id: T3, sort: 1, updated_at: NOW.toISOString() }, { op: 'sort', id: T2, sort: 2, updated_at: NOW.toISOString() }
    ])
    for (const op of trackersOutbox.pending(ME)) expect(Object.keys(op).sort()).toEqual(['id', 'op', 'sort', 'updated_at'])
    // Nothing below the last one.
    useTrackers.getState().move(T2, 1)
    expect(trackersOutbox.pending(ME)).toHaveLength(2)
  })

  it('lays a queued reorder over the server copy by its sort alone', async () => {
    api.fetchTrackers.mockResolvedValue([trackerOf({ sort: 0 }), { ...WEIGHT, sort: 1 }])
    await bound()
    api.updateTrackerSort.mockRejectedValue(offline())
    useTrackers.getState().move(T2, -1)
    await settle()
    // Meanwhile another device renamed Weight; the pull lays only the new order on it.
    const later = '2026-10-16T15:30:00.000Z'
    api.fetchTrackers.mockResolvedValue([trackerOf({ sort: 0 }), { ...WEIGHT, name: 'Body weight', sort: 1, updated_at: later }])
    await useTrackers.getState().refresh()
    expect(useTrackers.getState().trackers.map(t => [t.name, t.sort])).toEqual([['Body weight', 0], ['Water', 1]])
  })

  it('drops everything on reset, and an answer for the previous account lands nowhere', async () => {
    await withTrackers([entryOf(TODAY, { id: 'e1' })])
    useTrackers.setState({ droppedNotice: 'refused' })
    let release!: (v: TrackerEntry[]) => void
    api.fetchEntries.mockReturnValue(new Promise(r => { release = r }))
    const late = useTrackers.getState().refresh()
    useTrackers.getState().reset()
    expect(useTrackers.getState()).toMatchObject({ userId: null, status: 'idle', trackers: [], entries: [], from: '', droppedNotice: null })
    expect(localStorage.getItem(CACHE)).toBeNull()
    release([entryOf(TODAY, { id: 'e2' })]); await late
    expect(useTrackers.getState().entries).toEqual([])
    expect(localStorage.getItem(CACHE)).toBeNull()
  })

  it('binds another account with its own data only, never sending the queue of the one before', async () => {
    await withTrackers([entryOf(TODAY, { id: 'e1' })])
    trackersOutbox.enqueue(ME, { op: 'entry', row: entryOf(TODAY, { id: 'mine' }) })
    api.fetchTrackers.mockResolvedValue([])
    api.fetchEntries.mockResolvedValue([])
    let release!: (v: unknown[]) => void
    api.fetchTrackers.mockReturnValueOnce(new Promise(r => { release = r }))
    const p = useTrackers.getState().bind(OTHER)
    expect(useTrackers.getState()).toMatchObject({ userId: OTHER, status: 'loading', trackers: [], entries: [] })
    release([]); await p
    expect(api.upsertEntry).not.toHaveBeenCalled()
    expect(trackersOutbox.pending(ME)).toHaveLength(1)
    expect(cache()).toMatchObject({ userId: OTHER, entries: [] })
  })
})

describe('startTrackersSync', () => {
  it('pulls on focus back and on reconnect, sends the queue every minute, and stops', async () => {
    await bound()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.setSystemTime(NOW)
    const refresh = vi.spyOn(useTrackers.getState(), 'refresh').mockResolvedValue()
    const flushPending = vi.spyOn(useTrackers.getState(), 'flushPending').mockResolvedValue()
    const stop = startTrackersSync()
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(60_000)
    expect(flushPending).toHaveBeenCalledTimes(1)
    stop()
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(flushPending).toHaveBeenCalledTimes(1)
    refresh.mockRestore(); flushPending.mockRestore()
  })

  it('pulls again with the new window when the day turns in the profile time zone', async () => {
    // 23:59 of Friday 16 in Tokyo.
    useProfile.setState({ profile: { timezone: 'Asia/Tokyo' } as never })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-16T14:59:00Z'))
    await useTrackers.getState().bind(ME)
    expect(api.fetchEntries).toHaveBeenLastCalledWith(FROM)
    const stop = startTrackersSync()
    vi.advanceTimersByTime(60_000)
    await useTrackers.getState().refresh()
    expect(api.fetchEntries).toHaveBeenLastCalledWith('2026-07-20')
    expect(useTrackers.getState().from).toBe('2026-07-20')
    vi.advanceTimersByTime(60_000)
    expect(api.fetchEntries).toHaveBeenCalledTimes(2)
    stop()
  })
})
