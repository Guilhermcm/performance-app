// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useToday } from './use-today'

// 02:59 UTC is 23:59 on the 6th in Sao Paulo (UTC-3); a minute later it is the 7th.
const BEFORE = new Date('2026-10-07T02:59:00Z')
const AFTER = new Date('2026-10-07T03:01:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(BEFORE)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useToday', () => {
  it('is today in the profile time zone', () => {
    expect(renderHook(() => useToday('America/Sao_Paulo')).result.current).toBe('2026-10-06')
    expect(renderHook(() => useToday('Asia/Tokyo')).result.current).toBe('2026-10-07')
  })

  it('moves to the next day on the one-minute tick after midnight', () => {
    const { result } = renderHook(() => useToday('America/Sao_Paulo'))
    act(() => { vi.setSystemTime(AFTER); vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-10-07')
  })

  it('moves to the next day when the window gets focus back', () => {
    const { result } = renderHook(() => useToday('America/Sao_Paulo'))
    vi.setSystemTime(AFTER)
    expect(result.current).toBe('2026-10-06')
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(result.current).toBe('2026-10-07')
  })

  it('moves to the next day when the page becomes visible again', () => {
    const { result } = renderHook(() => useToday('America/Sao_Paulo'))
    vi.setSystemTime(AFTER)
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current).toBe('2026-10-07')
  })

  it('follows a change of time zone', () => {
    const { result, rerender } = renderHook(({ tz }) => useToday(tz), { initialProps: { tz: 'America/Sao_Paulo' } })
    rerender({ tz: 'Asia/Tokyo' })
    expect(result.current).toBe('2026-10-07')
  })

  it('stops listening when it unmounts', () => {
    const { unmount } = renderHook(() => useToday('America/Sao_Paulo'))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
