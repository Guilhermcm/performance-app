import { useEffect, useMemo, useRef, useState } from 'react'
import { todayIn } from '../nutrition/days'

const TICK_MS = 60_000
const FALLBACK_TZ = 'America/Sao_Paulo'

// Minutes since local midnight (0 to 1439) in `timezone` at `now`. A missing or invalid zone falls
// back to Sao Paulo, like todayIn.
export function minutesIn(timezone: string | null | undefined, now: Date = new Date()): number {
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const part = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
    return (part('hour') % 24) * 60 + part('minute')
  }
  try { return read(timezone || FALLBACK_TZ) } catch { return read(FALLBACK_TZ) }
}

export type LocalNow = { today: string; minutes: number }

// Today's date and the minute of the day in the profile's time zone, kept right while the screen
// stays open: the morning card has to show up at 04:00 and go at 14:00 without a reload. Like
// useToday, the value is computed on every render; the listeners (every minute, focus back, page
// visible again) only make sure a render happens when it has moved.
export function useLocalNow(timezone: string | null | undefined): LocalNow {
  const now = new Date()
  const today = todayIn(timezone, now)
  const minutes = minutesIn(timezone, now)
  // The same object while the minute holds, so a caller can put it in a dependency list.
  const value = useMemo<LocalNow>(() => ({ today, minutes }), [today, minutes])
  const [, rerender] = useState(0)
  const shown = useRef(value)
  shown.current = value

  useEffect(() => {
    const check = () => {
      const at = new Date()
      if (todayIn(timezone, at) !== shown.current.today || minutesIn(timezone, at) !== shown.current.minutes) rerender(n => n + 1)
    }
    const onVisible = () => { if (document.visibilityState !== 'hidden') check() }
    const id = setInterval(check, TICK_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    // The clock may have moved between the render and the listeners going up.
    check()
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timezone])

  return value
}
