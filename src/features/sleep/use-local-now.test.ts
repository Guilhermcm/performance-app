// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useLocalNow } from './use-local-now'

const SP = 'America/Sao_Paulo'

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useLocalNow', () => {
  it('is the date and the minute of the day in the profile time zone', () => {
    vi.setSystemTime(new Date('2026-10-07T06:59:00Z')) // 03:59 in Sao Paulo (UTC-3)
    expect(renderHook(() => useLocalNow(SP)).result.current).toEqual({ today: '2026-10-07', minutes: 239 })
    expect(renderHook(() => useLocalNow('Asia/Tokyo')).result.current).toEqual({ today: '2026-10-07', minutes: 959 })
  })

  it('moves on the one-minute tick, without a focus event', () => {
    vi.setSystemTime(new Date('2026-10-07T06:59:00Z'))
    const { result } = renderHook(() => useLocalNow(SP))
    expect(result.current.minutes).toBe(239)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toEqual({ today: '2026-10-07', minutes: 240 })
  })

  it('turns the day at local midnight', () => {
    vi.setSystemTime(new Date('2026-10-07T02:59:00Z')) // 23:59 on the 6th
    const { result } = renderHook(() => useLocalNow(SP))
    expect(result.current).toEqual({ today: '2026-10-06', minutes: 1439 })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toEqual({ today: '2026-10-07', minutes: 0 })
  })

  it('catches up when the window gets focus back or the page shows again', () => {
    vi.setSystemTime(new Date('2026-10-07T06:59:00Z'))
    const { result } = renderHook(() => useLocalNow(SP))
    vi.setSystemTime(new Date('2026-10-07T13:30:00Z'))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(result.current.minutes).toBe(630)
    vi.setSystemTime(new Date('2026-10-07T17:00:00Z'))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current.minutes).toBe(840)
  })

  it('falls back to Sao Paulo without a zone and stops listening when it unmounts', () => {
    vi.setSystemTime(new Date('2026-10-07T06:59:00Z'))
    const { result, unmount } = renderHook(() => useLocalNow(null))
    expect(result.current.minutes).toBe(239)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
