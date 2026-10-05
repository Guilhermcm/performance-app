import { useEffect, useRef, useState } from 'react'

type Options = { from?: number; ms?: number; instant?: boolean; onDone?: () => void }

// Counts to `to` with an ease-out curve, starting from wherever the number is (the preview first,
// then the server's figure). instant (reduced motion) lands on `to` at once. onDone runs each time
// a target is reached.
export function useCountUp(to: number, { from = 0, ms = 700, instant = false, onDone }: Options = {}): number {
  const [value, setValue] = useState(instant ? to : from)
  const shown = useRef(instant ? to : from)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (instant || typeof requestAnimationFrame !== 'function') {
      shown.current = to
      setValue(to)
      done.current?.()
      return
    }
    const start = performance.now()
    const a = shown.current
    let frame = 0
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / ms))
      const v = Math.round(a + (to - a) * (1 - Math.pow(1 - k, 3)))
      shown.current = v
      setValue(v)
      if (k < 1) frame = requestAnimationFrame(tick)
      else done.current?.()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, ms, instant])

  return value
}
