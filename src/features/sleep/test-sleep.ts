import type { SleepLog, SleepNight, SleepTarget } from './types'

export const ME = '00000000-0000-0000-0000-00000000000a'
export const OTHER = '00000000-0000-0000-0000-00000000000b'

export const logOf = (over: Partial<SleepLog> = {}): SleepLog => ({
  night: '2026-10-05', bed_time: '23:30', wake_time: '07:10', duration_min: 460, quality: null, note: null,
  updated_at: '2026-10-05T10:00:00.000Z', ...over
})

export const targetOf = (over: Partial<SleepTarget> = {}): SleepTarget =>
  ({ valid_from: '2026-10-01', goal_min: 480, bed_target: '23:00', ...over })

export const nightOf = (over: Partial<SleepNight> = {}): SleepNight => ({
  night: '2026-10-01', logged: true, on_target: true, rested: false, bed_diff_min: 10, duration_min: 470, quality: null,
  target: { goal_min: 480, bed_target: '23:00' }, xp: 100, bed_time: '23:10', wake_time: '07:00', note: null, ...over
})
