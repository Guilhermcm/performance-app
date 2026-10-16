import type { Tracker, TrackerEntry } from './types'

export const T1 = '00000000-0000-0000-0000-0000000000c1'

export const trackerOf = (over: Partial<Tracker> = {}): Tracker => ({
  id: T1, name: 'Water', icon: 'droplet', kind: 'number', unit: 'L', decimals: 1, aggregate: 'sum', options: null, sort: 0,
  archived_at: null, created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z', ...over,
})

let seq = 0
export const entryOf = (day: string, over: Partial<TrackerEntry> = {}): TrackerEntry => ({
  id: `e${++seq}`, tracker_id: T1, day, at: '09:00', value: 1, minutes: null, option: null, note: null,
  updated_at: '2026-09-01T12:00:00.000Z', ...over,
})
