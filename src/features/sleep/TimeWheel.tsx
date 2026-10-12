import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { fromMinutes, shiftClock, toMinutes } from './time'

// Plan decision 15: the quick time adjust. Two scroll-snap columns (hours 00 to 23, minutes in
// steps of 5), each a listbox the keyboard can drive, with "−15" and "+15" beside them. No new
// dependency: the wheel is plain CSS scroll snapping.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))
const STEP = 15
// The height of one row (h-11), used until a row can be measured.
const ROW = 44
// How long a scroll has to rest before the row under the band is taken.
const SETTLE_MS = 120

type Props = { value: string; onChange: (value: string) => void; label: string }

export function TimeWheel({ value, onChange, label }: Props) {
  const m = toMinutes(value)
  const hour = Math.floor(m / 60)
  const minute = m % 60
  return (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-2 rounded-2xl bg-secondary/60 p-2">
      <Button type="button" variant="outline" className="h-12 min-w-12 rounded-xl px-2 font-mono text-[15px] tabular-nums"
        aria-label={t('15 minutes earlier')} onClick={() => onChange(shiftClock(value, -STEP))}>−15</Button>
      <div className="flex items-center gap-1">
        <Column label={t('Hours')} options={HOURS} pos={hour} onPick={i => onChange(fromMinutes(i * 60 + minute))} />
        <span aria-hidden className="font-mono text-2xl font-semibold text-muted-foreground">:</span>
        {/* A minute off the 5 grid (a night typed elsewhere) sits between two rows: none is
            selected, and the arrows go to the step above or below it. */}
        <Column label={t('Minutes')} options={MINUTES} pos={minute / 5} onPick={i => onChange(fromMinutes(hour * 60 + i * 5))} />
      </div>
      <Button type="button" variant="outline" className="h-12 min-w-12 rounded-xl px-2 font-mono text-[15px] tabular-nums"
        aria-label={t('15 minutes later')} onClick={() => onChange(shiftClock(value, STEP))}>+15</Button>
    </div>
  )
}

type ColumnProps = { label: string; options: string[]; pos: number; onPick: (index: number) => void }

function Column({ label, options, pos, onPick }: ColumnProps) {
  const id = useId()
  const list = useRef<HTMLUListElement>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Set by a finger, a pointer or a wheel on the column. Only such a scroll picks a row: the
  // column's own scroll to the value (on open, or after ±15) never changes the value by itself.
  const touched = useRef(false)
  const n = options.length
  const selected = Number.isInteger(pos) ? pos : -1
  const rowHeight = () => (list.current?.querySelector('li') as HTMLElement | null)?.offsetHeight || ROW

  // Keep the chosen row under the band when the value changes from outside (a tap, ±15, keys).
  useEffect(() => {
    const el = list.current
    if (!el || typeof el.scrollTo !== 'function') return
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: Math.round(pos) * rowHeight(), behavior: calm ? 'auto' : 'smooth' })
  }, [pos])
  useEffect(() => () => clearTimeout(settle.current), [])

  // A finger scroll picks the row it comes to rest on.
  const onScroll = () => {
    if (!touched.current) return
    clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      touched.current = false
      const el = list.current
      if (!el) return
      const i = Math.min(n - 1, Math.max(0, Math.round(el.scrollTop / rowHeight())))
      if (i !== selected) onPick(i)
    }, SETTLE_MS)
  }

  const onTouch = () => { touched.current = true }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const next = e.key === 'ArrowDown' ? (Math.floor(pos) + 1) % n
      : e.key === 'ArrowUp' ? (Math.ceil(pos) - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : null
    if (next == null) return
    e.preventDefault()
    onPick(next)
  }

  return (
    <div className="relative">
      {/* The band the chosen row sits in. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-11 h-11 rounded-xl bg-background" />
      <ul ref={list} role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} onScroll={onScroll}
        onPointerDown={onTouch} onTouchStart={onTouch} onWheel={onTouch}
        aria-activedescendant={selected >= 0 ? `${id}-${selected}` : undefined}
        className="relative m-0 h-33 w-16 list-none snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl p-0 py-11 outline-none [scrollbar-width:none] focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_bottom,transparent,black_35%,black_65%,transparent)]">
        {options.map((o, i) => (
          <li key={o} id={`${id}-${i}`} role="option" aria-selected={i === selected} onClick={() => onPick(i)}
            className={cn('grid h-11 cursor-pointer snap-center place-items-center font-mono text-2xl tabular-nums transition-colors duration-150 motion-reduce:transition-none',
              i === selected ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
            {o}
          </li>
        ))}
      </ul>
    </div>
  )
}
