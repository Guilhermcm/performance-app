import { useEffect, useRef, useState } from 'react'
import { todayIn } from './days'

const TICK_MS = 60_000

// Today's date (YYYY-MM-DD) in the profile's time zone, kept right while the screen stays open:
// a diary left in the background overnight must not keep logging into yesterday. The value is
// recomputed on every render, so a render triggered by anything else is also always current; the
// listeners (focus back, page visible again, every minute) only make sure a render happens when
// the day has turned. Always todayIn(timezone), never the device's own date.
export function useToday(timezone: string | null | undefined): string {
  const today = todayIn(timezone)
  const [, rerender] = useState(0)
  const shown = useRef(today)
  shown.current = today

  useEffect(() => {
    const check = () => { if (todayIn(timezone) !== shown.current) rerender(n => n + 1) }
    const onVisible = () => { if (document.visibilityState !== 'hidden') check() }
    const id = setInterval(check, TICK_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    // The date may have turned between the render and the listeners going up.
    check()
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timezone])

  return today
}
