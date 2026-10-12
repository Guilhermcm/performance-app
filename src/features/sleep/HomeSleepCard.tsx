import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { shiftDay } from '../nutrition/days'
import { useLocalNow } from './use-local-now'
import { useSleep } from './useSleep'
import { confirmsOn, nightSummary } from './labels'
import { fmtDuration } from './time'
import { SleepLogForm } from './SleepLogForm'
import { SleepLogSheet } from './SleepLogSheet'
import type { SleepLog } from './types'

// Spec 4.3: the card asks about the night from 04:00 to 13:59 in the profile's zone.
const ASK_FROM = 4 * 60
const ASK_UNTIL = 14 * 60

const CARD = 'rounded-3xl border border-border bg-card p-4 text-card-foreground'

// Home's morning card for the sleep pillar. Before the night is logged, and only in the morning,
// "How was your night?" with the times filled in and one tap to save. Once it is logged, the night
// in a line for the rest of the day (plan decision 16), with when it confirms and a way to edit.
// With the pillar off, nothing.
export default function HomeSleepCard() {
  const profile = useProfile(s => s.profile)
  const enabled = !!profile?.sleep_enabled
  const now = useLocalNow(profile?.timezone)
  useRefreshOnNewDay(now.today, enabled)
  const status = useSleep(s => s.status)
  const log = useSleep(s => s.logs[now.today])

  if (!enabled) return null
  if (log) return <Summary log={log} today={now.today} />
  if (now.minutes < ASK_FROM || now.minutes >= ASK_UNTIL) return null
  if (status === 'idle' || status === 'loading') {
    return (
      <section data-testid="home-sleep-card" role="status" aria-busy="true" aria-label={t('Sleep')} className={CARD}>
        <div className="mb-3 flex items-center gap-3"><Skeleton className="size-10 rounded-xl" /><Skeleton className="h-5 w-40" /></div>
        <div className="grid grid-cols-2 gap-2"><Skeleton className="h-16 rounded-2xl" /><Skeleton className="h-16 rounded-2xl" /></div>
        <Skeleton className="mt-4 h-12 rounded-xl" />
      </section>
    )
  }
  return (
    <section data-testid="home-sleep-card" aria-labelledby="home-sleep-title" className={CARD}>
      <div className="mb-3 flex items-center gap-3">
        <Tile />
        <h2 id="home-sleep-title" className="text-[15px] font-semibold">{t('How was your night?')}</h2>
      </div>
      {/* A new day starts from fresh times. */}
      <SleepLogForm key={now.today} night={now.today} />
    </section>
  )
}

// The store pulls on focus, on visibility and when the network returns. A tab left open across
// local midnight gets none of those, so the change of day asks for the new today and yesterday.
function useRefreshOnNewDay(today: string, enabled: boolean) {
  const seen = useRef(today)
  useEffect(() => {
    if (seen.current === today) return
    seen.current = today
    if (enabled) void useSleep.getState().refresh()
  }, [today, enabled])
}

function Tile() {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-pillar-sleep/15 text-pillar-sleep">
      <Moon className="size-5" strokeWidth={1.75} />
    </span>
  )
}

// "7h 40 · on target", the day the night confirms, and Edit. A tap anywhere else opens /sono.
function Summary({ log, today }: { log: SleepLog; today: string }) {
  const nav = useNavigate()
  const target = useSleep(s => s.targetOn(today))
  const [editing, setEditing] = useState(false)
  // The night closes at the start of the day after tomorrow (spec 4.4: confirms_on = today + 2).
  const confirms = shiftDay(today, 2)
  return (
    <section data-testid="home-sleep-card" aria-label={t('Sleep')} className={CARD}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => nav('/sono')}
          className="-m-1 flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl p-1 text-left outline-none transition-[background-color,transform] duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100">
          <Tile />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">{t('Sleep')}</span>
            <span className="block text-[15px] font-semibold leading-snug tabular-nums">
              {`${fmtDuration(log.duration_min)} · ${nightSummary(log, target)}`}
            </span>
            <span className="block text-sm text-muted-foreground">{confirmsOn(confirms)}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
        <Button variant="outline" className="h-11 shrink-0 rounded-xl px-3.5" aria-label={t('Edit night')} onClick={() => setEditing(true)}>
          {t('Edit')}
        </Button>
      </div>
      <SleepLogSheet night={today} open={editing} onOpenChange={setEditing} />
    </section>
  )
}
