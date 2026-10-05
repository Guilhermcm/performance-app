// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCountUp } from './useCountUp'

afterEach(() => vi.unstubAllGlobals())

describe('useCountUp', () => {
  it('lands on the target at once when instant', () => {
    const onDone = vi.fn()
    const { result } = renderHook(() => useCountUp(750, { instant: true, onDone }))
    expect(result.current).toBe(750)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('counts to the target and then to a new one from where it is', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(performance.now() + 10_000); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const onDone = vi.fn()
    const { result, rerender } = renderHook(({ to }) => useCountUp(to, { onDone }), { initialProps: { to: 200 } })
    expect(result.current).toBe(200)
    act(() => rerender({ to: 280 }))
    expect(result.current).toBe(280)
    expect(onDone).toHaveBeenCalledTimes(2)
  })
})
