import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { LevelInfo } from '../xp'

const FILL_MS = 600
const pct = (l: LevelInfo) => Math.max(0, Math.min(100, (l.into / l.need) * 100))

type Props = { to: LevelInfo; from?: LevelInfo | null; instant?: boolean; label: string; className?: string; fillClassName?: string }

// The bar to the next level. With `from` it fills from there; across a level-up it runs to the end,
// empties and fills to the new level's share. instant (reduced motion, static screens) skips that.
export function LevelBar({ to, from = null, instant = false, label, className, fillClassName }: Props) {
  const still = instant || !from
  const [width, setWidth] = useState(still || !from ? pct(to) : pct(from))
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    if (still || !from) { setMoving(false); setWidth(pct(to)); return }
    const timers: number[] = []
    const frames: number[] = []
    frames.push(requestAnimationFrame(() => {
      setMoving(true)
      if (to.level > from.level) {
        setWidth(100)
        timers.push(window.setTimeout(() => {
          setMoving(false)
          setWidth(0)
          // Two frames, so the empty bar is painted before it refills; a fixed delay can miss the
          // paint on a slow frame and the bar would slide back from 100 instead.
          frames.push(requestAnimationFrame(() => {
            frames.push(requestAnimationFrame(() => { setMoving(true); setWidth(pct(to)) }))
          }))
        }, FILL_MS))
      } else {
        setWidth(pct(to))
      }
    }))
    return () => { frames.forEach(id => cancelAnimationFrame(id)); timers.forEach(id => clearTimeout(id)) }
  }, [still, from?.level, from?.into, from?.need, to.level, to.into, to.need])

  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={to.need} aria-valuenow={to.into}
      data-slot="level-bar" className={cn('relative h-2.5 w-full overflow-hidden rounded-full bg-primary/15', className)}>
      <div data-slot="level-fill" style={{ width: `${width}%` }}
        className={cn('h-full rounded-full bg-primary', moving && 'transition-[width] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]', fillClassName)} />
    </div>
  )
}
