import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Award, Check, Circle, CircleDashed, CloudOff, Clock, Dot, Flame, Minus, RefreshCw } from 'lucide-react'
import MonthCalendar, { type CalendarCell, type CalendarLegendItem, type CalendarWeek } from '@/components/calendar/MonthCalendar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { useToday } from './use-today'
import { fetchDays, fetchPeriods } from './nutrition-api'
import {
  buildMonth, firstMonth, isSettled, monthHasActiveDay, monthOf, monthRange, readHistory, shiftMonth, writeHistory,
  type DayState, type HistoryCache, type MonthCell, type MonthWeek
} from './history'
import DaySheet from './DaySheet'

// What a cell shows: a day's state, or "future" for a day still to come, which must not read as a day
// outside the periods.
type CellState = DayState | 'future'

// Icon and words per state: never by colour alone. "On target" is a check in the pillar colour,
// "logged off target" a dot, "not logged" an empty ring, "still open" a dashed ring in an outlined
// tile, a day outside the periods is faded with a dash, and a day to come is a clock in a dotted
// tile, not faded.
const STATE: Record<CellState, { label: () => string; icon: ReactNode }> = {
  on_target: { label: () => t('On target'), icon: <Check className="size-4" strokeWidth={3} /> },
  logged: { label: () => t('Logged, off target'), icon: <Dot className="size-5" strokeWidth={4} /> },
  none: { label: () => t('Not logged'), icon: <Circle className="size-3" /> },
  open: { label: () => t('Still open'), icon: <CircleDashed className="size-3.5" /> },
  inactive: { label: () => t('Not tracked'), icon: <Minus className="size-3" /> },
  future: { label: () => t('Not yet'), icon: <Clock className="size-3" /> },
}
const LEGEND_ORDER: CellState[] = ['on_target', 'logged', 'none', 'open', 'inactive', 'future']

const STATE_CLASS: Record<CellState, string> = {
  on_target: 'bg-pillar-nutrition/15 text-pillar-nutrition',
  logged: 'bg-card text-foreground',
  none: 'bg-card text-muted-foreground',
  open: 'border border-dashed border-foreground/50 text-foreground',
  inactive: 'text-muted-foreground opacity-50',
  future: 'border border-dotted border-border text-muted-foreground',
}

const weeksText = (n: number) => (n === 1 ? t('1 week') : tn(n, '{0} weeks', n))
const longDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

type Load = 'idle' | 'loading' | 'error'

// /nutricao/historico: the streaks on top, then the month as a Monday-first calendar with each
// day's state and each week's "4/5 on target", back month by month to the first period. Months are
// read with get_nutrition_days and kept on the phone per account; a month whose days had all closed
// when read is never asked again, and a month with no day inside a period asks nothing at all.
export default function HistoryScreen() {
  const navigate = useNavigate()
  const userId = useProfile(s => s.profile?.id ?? null)
  const tz = useProfile(s => s.profile?.timezone)
  const today = useToday(tz)
  const online = useOnline()
  const [cache, setCache] = useState<HistoryCache | null>(() => (userId ? readHistory(userId) : null))
  const [month, setMonth] = useState(() => monthOf(today))
  const [periodsLoad, setPeriodsLoad] = useState<Load>('idle')
  const [monthLoad, setMonthLoad] = useState<Load>('idle')
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<MonthCell | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Months asked in this visit: an unsettled month is read once per visit, not on every return to it.
  const asked = useRef(new Set<string>())

  // Another account on the same screen starts from its own copy.
  if (userId && cache?.userId !== userId) setCache(readHistory(userId))

  const update = useCallback((fn: (c: HistoryCache) => HistoryCache) => {
    setCache(c => {
      if (!c) return c
      const next = fn(c)
      writeHistory(next)
      return next
    })
  }, [])

  // The periods change only when the pillar is switched, but a fresh copy costs one small read.
  useEffect(() => {
    if (!userId || !online) return
    let live = true
    setPeriodsLoad('loading')
    fetchPeriods().then(
      periods => { if (!live) return; update(c => ({ ...c, periods })); setPeriodsLoad('idle') },
      () => { if (live) setPeriodsLoad('error') }
    )
    return () => { live = false }
  }, [userId, online, attempt, update])

  const periods = cache?.periods ?? null
  const range = periods ? monthRange(month, periods, today) : null
  const saved = cache?.months[month] ?? null
  const due = !!range && !(saved && isSettled(month, saved.fetchedOn)) && !asked.current.has(month)

  const from = range?.from ?? null
  const to = range?.to ?? null
  useEffect(() => {
    if (!due || !from || !to || !online) return
    let live = true
    setMonthLoad('loading')
    fetchDays(from, to).then(
      data => {
        if (!live) return
        asked.current.add(month)
        update(c => ({ ...c, months: { ...c.months, [month]: { fetchedOn: today, data } } }))
        setMonthLoad('idle')
      },
      () => { if (live) setMonthLoad('error') }
    )
    return () => { live = false }
  }, [due, month, from, to, online, today, attempt, update])

  // A failed read belongs to the month it was for.
  const go = (by: number) => { setMonthLoad('idle'); setMonth(m => shiftMonth(m, by)) }
  const retry = () => { setMonthLoad('idle'); setPeriodsLoad('idle'); setAttempt(n => n + 1) }

  const rows = useMemo<MonthWeek[]>(
    () => (periods ? buildMonth(month, saved?.data.days ?? [], saved?.data.weeks ?? [], periods, today) : []),
    [month, saved, periods, today]
  )

  const weeks = useMemo<CalendarWeek[]>(() => rows.map(r => ({
    start: r.start,
    cells: r.cells.map(c => (c.inMonth ? toCell(c, today) : null)),
    summary: r.summary ? <WeekSummary onTarget={r.summary.on_target} target={r.summary.target} hit={r.summary.target_hit} /> : undefined
  })), [rows, today])

  const legend = useMemo<CalendarLegendItem[]>(() => LEGEND_ORDER.map(s => ({ state: s, label: STATE[s].label(), icon: STATE[s].icon })), [])

  const select = (day: string) => {
    const c = rows.flatMap(r => r.cells).find(x => x.day === day)
    if (!c) return
    setPicked(c)
    setSheetOpen(true)
  }

  const first = periods ? firstMonth(periods) : null
  let body: ReactNode
  if (!periods) {
    body = !online
      ? <Note icon={<CloudOff aria-hidden className="size-4 shrink-0" />}>{t('Connect to see your history.')}</Note>
      : periodsLoad === 'error' ? <Failed onRetry={retry} /> : <CalendarSkeleton />
  } else if (!first) {
    body = <Note>{t('Your history starts the day you turn on Nutrition.')}</Note>
  } else {
    let empty: ReactNode = null
    if (!monthHasActiveDay(month, periods, today)) empty = <Note>{t('Nutrition was off this month, so no day counts here.')}</Note>
    else if (range && !saved) {
      if (!online) empty = <Note icon={<CloudOff aria-hidden className="size-4 shrink-0" />}>{t('Connect to see this month.')}</Note>
      else if (monthLoad === 'error') empty = <Failed onRetry={retry} />
    }
    const loading = !empty && !!range && !saved
    body = (
      <MonthCalendar month={month} weeks={weeks} onSelectDay={select} minMonth={first} maxMonth={monthOf(today)}
        onPrevMonth={() => go(-1)} onNextMonth={() => go(1)}
        stateClassName={STATE_CLASS} legend={empty ? undefined : legend} empty={empty} loading={loading} />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate('/nutricao')}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Nutrition history')}</h1>
      </header>

      <Streaks />

      {!online && periods && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5 shrink-0" />{t('Offline. Showing the months saved on this phone.')}
        </p>
      )}

      {body}

      <DaySheet cell={picked} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}

function toCell(c: MonthCell, today: string): CalendarCell {
  const state: CellState = c.future ? 'future' : c.state
  const label = STATE[state].label()
  return {
    day: c.day,
    state,
    label,
    icon: STATE[state].icon,
    accessibleText: `${longDay(c.day)}: ${label}`,
    selectable: c.state !== 'inactive' || c.data != null,
    current: c.day === today,
  }
}

function WeekSummary({ onTarget, target, hit }: { onTarget: number; target: number; hit: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
      <span className="font-mono tabular-nums">{t('{0}/{1} on target', onTarget, target)}</span>
      {hit && (
        <span className="inline-flex items-center gap-1 rounded-full bg-pillar-nutrition/15 px-2 py-0.5 font-medium text-pillar-nutrition">
          <Award aria-hidden className="size-3.5" />{t('Weekly goal met')}
        </span>
      )}
    </span>
  )
}

// Current and best run of weeks with the nutrition goal met, from the progress the Home reads.
function Streaks() {
  const status = useProgress(s => s.status)
  const streak = useProgress(s => s.progress?.nutrition?.streak ?? null)
  if (!streak) {
    if (status === 'idle' || status === 'loading') {
      return (
        <div aria-busy="true" className="grid grid-cols-2 gap-2">
          <Skeleton className="h-[68px] rounded-2xl" /><Skeleton className="h-[68px] rounded-2xl" />
        </div>
      )
    }
    return null
  }
  const tiles: [string, number][] = [[t('Current streak'), streak.current], [t('Best streak'), streak.best]]
  return (
    <dl role="group" aria-label={t('Streaks')} className="grid grid-cols-2 gap-2">
      {tiles.map(([label, n]) => (
        <div key={label} className="flex flex-col rounded-2xl bg-card px-4 py-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flame aria-hidden className="size-3.5 text-pillar-nutrition" />{label}
          </dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{weeksText(n)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Note({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className="flex items-center gap-2 rounded-2xl bg-card p-5 text-sm leading-snug text-muted-foreground">{icon}{children}</p>
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-card p-5">
      <p className="text-[15px] font-medium leading-snug">{t('Could not load your history.')}</p>
      <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
        <RefreshCw aria-hidden className="size-4" />{t('Try again')}
      </Button>
    </div>
  )
}

// Before the periods are known: the month header and grid in skeleton.
function CalendarSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-3">
      <Skeleton className="mx-auto h-6 w-36" />
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
      </div>
    </div>
  )
}
