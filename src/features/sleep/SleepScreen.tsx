import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Check, CircleDashed, CloudOff, Dot, Moon, RefreshCw } from 'lucide-react'
import MonthCalendar, { type CalendarLegendItem } from '@/components/calendar/MonthCalendar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { cn } from '@/lib/utils'
import { dateLocale, t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { shiftDay } from '../nutrition/days'
import { monthHasActiveDay, monthOf, monthRange, shiftMonth } from '../nutrition/history'
import { classifyNight } from './classify'
import { NIGHT_LEGEND, NIGHT_STATE, buildSleepMonth, loadSleepMonth, monthBounds, nightAt, targetAt, type NightState } from './history'
import { QUALITY_LABEL, nightStatus } from './labels'
import { fetchPeriods } from './sleep-api'
import type { StatNight } from './stats'
import { fmtClock, fmtDuration } from './time'
import { useLocalNow } from './use-local-now'
import { CLOSED_DAYS, droppedNoticeText, useSleep } from './useSleep'
import { NightSheet } from './NightSheet'
import { SleepLogForm } from './SleepLogForm'
import { SleepLogSheet } from './SleepLogSheet'
import SleepInvite from './SleepInvite'
import SleepSetup from './SleepSetup'
import SleepStats from './SleepStats'
import type { NightClass, SleepHistory, SleepLog, SleepNight, SleepPeriod, SleepTarget } from './types'

// With no goal yet, the setup's default bedtime (spec 3.1).
const DEFAULT_BED = '23:00'
const DEFAULT_NIGHTS = 5

const STATE_CLASS: Record<NightState, string> = {
  on_target: 'bg-pillar-sleep/15 text-pillar-sleep',
  logged: 'bg-card text-foreground',
  none: 'bg-card text-muted-foreground',
  open: 'border border-dashed border-foreground/50 text-foreground',
  inactive: 'text-muted-foreground opacity-50',
  future: 'border border-dotted border-border text-muted-foreground',
}

const CARD = 'rounded-3xl border border-border bg-card p-4 text-card-foreground'

const longDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
const goalOf = (x: SleepTarget | null) => (x ? { goal_min: x.goal_min, bed_target: x.bed_target } : null)

// /sono (spec 7.2): last night on top (or the form while today's night is not logged), the four
// numbers, room for the charts and the month of nights. Opens from the Home card, the radar and
// Perfil > Sono; with the pillar off, the invite to turn it on.
export default function SleepScreen() {
  const navigate = useNavigate()
  const profile = useProfile(s => s.profile)
  const online = useOnline()
  const { today } = useLocalNow(profile?.timezone)
  const status = useSleep(s => s.status)
  const dropped = useSleep(s => s.droppedNotice)
  const [setupOpen, setSetupOpen] = useState(false)

  // Nights the server refused while offline (their day had closed): said once, then forgotten.
  useEffect(() => {
    if (!dropped) return
    toast(droppedNoticeText())
    useSleep.getState().dismissDropped()
  }, [dropped])

  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/home'))
  const header = (
    <header className="flex flex-col">
      <div className="-ml-2 flex h-11 items-center">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={goBack}>
          <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Button>
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Sleep')}</h1>
    </header>
  )
  // The setup sits outside both branches: turning the pillar on flips the profile before the
  // goal is written, and the sheet must stay open (with its retry) if that write fails.
  const setup = <SleepSetup open={setupOpen} onOpenChange={setSetupOpen} />

  if (!profile?.sleep_enabled) {
    return (
      <>
        <Page>{header}<SleepInvite onActivate={() => setSetupOpen(true)} /></Page>
        {setup}
      </>
    )
  }

  return (
    <>
      <Page>
        {header}
        {!online && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CloudOff aria-hidden className="size-3.5 shrink-0" />{t('Offline. What you log stays on this phone and syncs when you reconnect.')}
          </p>
        )}
        {status === 'idle' || status === 'loading'
          ? <ScreenSkeleton />
          : <Nights key={profile.id} today={today} failed={status === 'error'} nightsPerWeek={profile.sleep_nights_per_week ?? DEFAULT_NIGHTS} />}
      </Page>
      {setup}
    </>
  )
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">{children}</div>
}

// Everything under the header once the store has answered. `failed`: the first pull failed with no
// saved copy; logging still works (it waits in the queue), the rest offers a retry.
function Nights({ today, failed, nightsPerWeek }: { today: string; failed: boolean; nightsPerWeek: number }) {
  const logs = useSleep(s => s.logs)
  const closed = useSleep(s => s.closed)
  const targets = useSleep(s => s.targets)
  // T of the running week, frozen on the server; the profile's count until progress has loaded.
  const weekTarget = useProgress(s => s.progress?.sleep?.target) ?? nightsPerWeek
  const [logNight, setLogNight] = useState(today)
  const [logOpen, setLogOpen] = useState(false)
  const [picked, setPicked] = useState<SleepNight | null>(null)
  const [pickedOpen, setPickedOpen] = useState(false)

  const yesterday = shiftDay(today, -1)
  // Today and yesterday come from the logs; a closed row for them would be an old saved copy.
  const older = useMemo(() => closed.filter(n => n.night < yesterday), [closed, yesterday])
  const openLogs = useMemo(() => [yesterday, today].map(n => logs[n]).filter((l): l is SleepLog => !!l), [logs, today, yesterday])

  const stat = useMemo<StatNight[]>(() => [
    ...older.filter(n => n.logged && n.bed_time && n.duration_min != null)
      .map(n => ({ night: n.night, bed_time: n.bed_time!, duration_min: n.duration_min!, goal_min: n.target?.goal_min ?? null })),
    ...openLogs.map(l => ({ night: l.night, bed_time: l.bed_time, duration_min: l.duration_min, goal_min: targetAt(targets, l.night)?.goal_min ?? null })),
  ], [older, openLogs, targets])
  const open = useMemo<{ night: string; cls: NightClass }[]>(
    () => openLogs.map(l => ({ night: l.night, cls: classifyNight(l, goalOf(targetAt(targets, l.night))) })), [openLogs, targets])

  // The last night logged: today's, yesterday's, or the latest closed one.
  const lastNight = openLogs.length ? openLogs[openLogs.length - 1].night
    : [...older].reverse().find(n => n.logged)?.night ?? null
  const todayLogged = !!logs[today]

  const openLog = (night: string) => { setLogNight(night); setLogOpen(true) }
  const openNight = (n: SleepNight) => { setPicked(n); setPickedOpen(true) }

  return (
    <>
      {!todayLogged && (
        <section aria-labelledby="sleep-form-title" className={CARD}>
          <div className="mb-3 flex items-center gap-3">
            <Tile />
            <h2 id="sleep-form-title" className="text-[15px] font-semibold">{lastNight ? t('How was your night?') : t('Log your first night')}</h2>
          </div>
          {/* A new day starts from fresh times. */}
          <SleepLogForm key={today} night={today} />
        </section>
      )}

      {failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] font-medium leading-snug">{t('Could not load your nights.')}</p>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void useSleep.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      ) : (
        <>
          {lastNight && (
            <LastNight night={nightAt(lastNight, older, logs, targets)} today={today} closed={lastNight < yesterday}
              target={targetAt(targets, lastNight)} onEdit={() => openLog(lastNight)} />
          )}
          {lastNight && (
            <SleepStats stat={stat} closed={older} open={open} today={today} target={weekTarget}
              bedTarget={targetAt(targets, today)?.bed_target ?? DEFAULT_BED} />
          )}
          {/* The charts of spec 7.4 (Task 11). */}
          <div data-slot="sleep-charts" className="contents" />
          <NightCalendar today={today} older={older} onLog={openLog} onOpen={openNight} />
        </>
      )}

      <SleepLogSheet night={logNight} open={logOpen} onOpenChange={setLogOpen} />
      {picked && <NightSheet night={picked} open={pickedOpen} onOpenChange={setPickedOpen} />}
    </>
  )
}

function Tile() {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-pillar-sleep/15 text-pillar-sleep">
      <Moon className="size-5" strokeWidth={1.75} />
    </span>
  )
}

// The last night logged: how long, when, the quality in words and where it stands, never by colour
// alone. An open night (today or yesterday) is still to confirm and can be edited.
function LastNight({ night, today, closed, target, onEdit }: {
  night: SleepNight; today: string; closed: boolean; target: SleepTarget | null; onEdit: () => void
}) {
  const yesterday = shiftDay(today, -1)
  const when = night.night === today ? t('Today') : night.night === yesterday ? t('Yesterday') : longDate(night.night)
  // A closed night carries the goal it was judged by; an open one, the goal in force that night.
  const status = nightStatus(night, closed ? (night.target ? { valid_from: night.night, ...night.target } : null) : target)
  const StatusIcon = night.on_target ? Check : Dot
  const chip = 'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium'
  return (
    <section data-testid="sleep-last-night" aria-labelledby="sleep-last-night-title" className={CARD}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="sleep-last-night-title" className="text-xs text-muted-foreground first-letter:uppercase">{when}</h2>
          <p className="font-mono text-3xl font-semibold leading-tight tabular-nums">{fmtDuration(night.duration_min ?? 0)}</p>
          {night.bed_time && night.wake_time && (
            <p className="text-sm text-muted-foreground">{t('went to bed {0} · woke up {1}', fmtClock(night.bed_time), fmtClock(night.wake_time))}</p>
          )}
        </div>
        {!closed && (
          <Button variant="outline" className="h-11 shrink-0 rounded-xl px-3.5" aria-label={t('Edit night')} onClick={onEdit}>{t('Edit')}</Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {night.quality != null && QUALITY_LABEL[night.quality as 1 | 2 | 3 | 4 | 5] && (
          <span className={cn(chip, 'bg-secondary text-foreground')}>{QUALITY_LABEL[night.quality as 1 | 2 | 3 | 4 | 5]()}</span>
        )}
        <span className={cn(chip, status.on ? 'bg-pillar-sleep/15 text-pillar-sleep' : 'bg-secondary text-muted-foreground')}>
          <StatusIcon aria-hidden className="size-3.5" strokeWidth={status.on ? 3 : 4} /><span>{status.text}</span>
        </span>
        {!closed && (
          <span className={cn(chip, 'border border-dashed border-border text-muted-foreground')}>
            <CircleDashed aria-hidden className="size-3.5" /><span>{t('To confirm')}</span>
          </span>
        )}
      </div>
    </section>
  )
}

const mergePeriods = (lists: SleepPeriod[][]): SleepPeriod[] => {
  const by = new Map<string, SleepPeriod>()
  for (const p of lists.flat()) by.set(p.started_on, p)
  return [...by.values()].sort((a, b) => (a.started_on < b.started_on ? -1 : 1))
}

// The month of nights, back month by month to the first period. The store keeps the last 62 days
// of closed nights; an older month is read with get_sleep_nights (useSleep.loadMonth keeps it on
// the phone), and a month with no closed night inside a period asks nothing.
function NightCalendar({ today, older, onLog, onOpen }: {
  today: string; older: SleepNight[]; onLog: (night: string) => void; onOpen: (night: SleepNight) => void
}) {
  const online = useOnline()
  const logs = useSleep(s => s.logs)
  const targets = useSleep(s => s.targets)
  const storePeriods = useSleep(s => s.periods)
  const [month, setMonth] = useState(() => monthOf(today))
  // Every period, for the way back to the first one; until it comes, the ones already seen.
  const [allPeriods, setAllPeriods] = useState<SleepPeriod[] | null>(null)
  const [months, setMonths] = useState<Record<string, SleepHistory>>({})
  const [failed, setFailed] = useState<Record<string, true>>({})
  const [attempt, setAttempt] = useState(0)
  // Months asked in this visit: a month is read once per visit, not on every return to it.
  const asked = useRef(new Set<string>())

  useEffect(() => {
    if (!online) return
    let live = true
    fetchPeriods().then(p => { if (live) setAllPeriods(p) }, () => { /* the periods already seen will do */ })
    return () => { live = false }
  }, [online, attempt])

  const periods = useMemo(
    () => mergePeriods([allPeriods ?? [], storePeriods, ...Object.values(months).map(m => m.periods)]),
    [allPeriods, storePeriods, months]
  )
  const range = monthRange(month, periods, today)
  const inStore = !!range && range.from >= shiftDay(today, -(CLOSED_DAYS - 1))
  const due = !!range && !inStore && !months[month] && !failed[month] && !asked.current.has(month)

  useEffect(() => {
    if (!due) return
    asked.current.add(month)
    // Kept by month: an answer that lands after the person moved on still fills its own month.
    void loadSleepMonth(month, periods, today).then(data => {
      if (data) setMonths(m => ({ ...m, [month]: data }))
      else setFailed(f => ({ ...f, [month]: true }))
    })
  }, [due, month, periods, today, attempt])

  const nights = useMemo(() => {
    const by = new Map<string, SleepNight>()
    for (const n of months[month]?.nights ?? []) by.set(n.night, n)
    for (const n of older) by.set(n.night, n)
    return [...by.values()]
  }, [months, month, older])

  const weeks = useMemo(() => buildSleepMonth(month, nights, logs, periods, targets, today), [month, nights, logs, periods, targets, today])
  const legend = useMemo<CalendarLegendItem[]>(() => NIGHT_LEGEND.map(s => ({ state: s, label: NIGHT_STATE[s].label(), icon: NIGHT_STATE[s].icon() })), [])
  const { min, max } = monthBounds(periods, today)

  const select = (day: string) => {
    if (day >= shiftDay(today, -1)) onLog(day)
    else onOpen(nightAt(day, nights, logs, targets))
  }
  const retry = () => {
    asked.current.delete(month)
    setFailed(f => { const { [month]: _, ...rest } = f; return rest })
    setAttempt(n => n + 1)
  }

  let empty: ReactNode = null
  if (!monthHasActiveDay(month, periods, today)) empty = <Note>{t('Sleep was off this month, so no night counts here.')}</Note>
  else if (range && !inStore && !months[month] && failed[month]) {
    empty = !online
      ? <Note icon={<CloudOff aria-hidden className="size-4 shrink-0" />}>{t('Connect to see this month.')}</Note>
      : (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-card p-5">
          <p className="text-[15px] font-medium leading-snug">{t('Could not load your history.')}</p>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={retry}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      )
  }
  const loading = !empty && !!range && !inStore && !months[month]

  return (
    <section aria-label={t('History')} className="flex flex-col gap-3 pt-2">
      <MonthCalendar month={month} weeks={weeks} onSelectDay={select} minMonth={min} maxMonth={max}
        onPrevMonth={() => setMonth(m => shiftMonth(m, -1))} onNextMonth={() => setMonth(m => shiftMonth(m, 1))}
        stateClassName={STATE_CLASS} legend={empty ? undefined : legend} empty={empty} loading={loading} />
    </section>
  )
}

function Note({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className="flex items-center gap-2 rounded-2xl bg-card p-5 text-sm leading-snug text-muted-foreground">{icon}{children}</p>
}

// The shape of the screen while the first load runs: last night, the four numbers, the month.
function ScreenSkeleton() {
  return (
    <div data-testid="sleep-skeleton" role="status" aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-4">
      <div className={cn(CARD, 'flex flex-col gap-2')}>
        <Skeleton className="h-3 w-16" /><Skeleton className="h-9 w-28" /><Skeleton className="h-4 w-48" />
        <div className="mt-1 flex gap-1.5"><Skeleton className="h-7 w-14 rounded-full" /><Skeleton className="h-7 w-20 rounded-full" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)}
      </div>
      <Skeleton className="mx-auto h-6 w-36" />
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
      </div>
    </div>
  )
}
