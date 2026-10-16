import type { Habit } from './types'

export const ME = '00000000-0000-0000-0000-00000000000a'
export const OTHER = '00000000-0000-0000-0000-00000000000b'
export const H1 = '00000000-0000-0000-0000-0000000000a1'
export const H2 = '00000000-0000-0000-0000-0000000000b2'

export const habitOf = (over: Partial<Habit> = {}): Habit => ({
  id: H1, name: 'Read', icon: 'book', per_week: 3, sort: 0, archived_at: null,
  created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z', ...over
})
