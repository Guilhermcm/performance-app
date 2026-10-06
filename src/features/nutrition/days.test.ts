import { describe, it, expect } from 'vitest'
import { shiftDay, todayIn } from './days'

describe('todayIn', () => {
  // 2026-10-05T16:30Z is 01:30 on the 6th in Tokyo (UTC+9) and 13:30 on the 5th in Sao Paulo (UTC-3).
  const now = new Date('2026-10-05T16:30:00Z')
  it('follows the given time zone, not the device', () => {
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-06')
    expect(todayIn('America/Sao_Paulo', now)).toBe('2026-10-05')
  })
  it('flips at local midnight', () => {
    expect(todayIn('America/Sao_Paulo', new Date('2026-10-06T02:59:59Z'))).toBe('2026-10-05')
    expect(todayIn('America/Sao_Paulo', new Date('2026-10-06T03:00:00Z'))).toBe('2026-10-06')
  })
  it('falls back to Sao Paulo when the zone is missing or invalid', () => {
    expect(todayIn(undefined, now)).toBe('2026-10-05')
    expect(todayIn('', now)).toBe('2026-10-05')
    expect(todayIn('Not/AZone', now)).toBe('2026-10-05')
  })
  it('shifts days for tomorrow and yesterday', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})
