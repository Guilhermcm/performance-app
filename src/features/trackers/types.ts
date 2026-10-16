export type TrackerKind = 'number' | 'duration' | 'label'
export type Aggregate = 'sum' | 'avg'
export type TrackerOption = { id: string; text: string }

// `unit` and `decimals` only mean something for `number`, `aggregate` for `number` and `duration`,
// `options` for `label`; the others are null.
export type Tracker = {
  id: string
  name: string
  icon: string
  kind: TrackerKind
  unit: string | null
  decimals: number | null
  aggregate: Aggregate | null
  options: TrackerOption[] | null
  sort: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

// One entry holds one value: `value` (number), `minutes` (duration) or `option` (label, an option
// id). `at` is the local time as HH:MM.
export type TrackerEntry = {
  id: string
  tracker_id: string
  day: string
  at: string
  value: number | null
  minutes: number | null
  option: string | null
  note: string | null
  updated_at: string
}
