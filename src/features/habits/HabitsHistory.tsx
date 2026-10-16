import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CloudOff, RefreshCw } from 'lucide-react'
import MonthCalendar, { type CalendarLegendItem } from '@/components/calendar/MonthCalendar'
import { Button } from '@/components/ui/button'
import { useOnline } from '@/lib/use-online'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useLocalNow } from '../sleep/use-local-now'
import { shiftDay } from '../nutrition/days'
import { monthHasActiveDay, monthOf, monthRange, shiftMonth } from '../nutrition/history'
import { HABIT_DAY_STATE, HABIT_LEGEND, buildHabitsMonth, loadHabitsMonth, monthBounds, type HabitDayState } from './history'
import { fetchPeriods } from './habits-api'
import { RECENT_DAYS, useHabits } from './useHabits'
import HabitDaySheet from './HabitDaySheet'
import type { HabitHistory, HabitPeriod } from './types'

const STATE_CLASS: Record<HabitDayState, string> = {
  all: 'bg-pillar-habits/15 text-pillar-habits',
  partial: 'bg-card text-foreground',
  none: 'bg-card text-muted-foreground',
  open: 'border border-dashed border-foreground/50 text-foreground',
  inactive: 'text-muted-foreground opacity-50',
  future: 'border border-dotted border-border text-muted-foreground',
}

const mergePeriods = (lists: HabitPeriod[][]): HabitPeriod[] => {
  const by = new Map<string, HabitPeriod>()
  for (const p of lists.flat()) by.set(p.started_on, p)
  return [...by.values()].sort((a, b) => (a.started_on < b.started_on ? -1 : 1))
}

// The month of checks on /habitos (spec 7.3, plan decision 14), back month by month to the first
// period. The store keeps the last 62 days (recent); an older month is read with
// get_habit_history (useHabits.loadMonth keeps it on the phone), and a month with no closed day
// inside a period asks nothing. A day opens in HabitDaySheet: read only once closed, with the
// checks of the active habits on today and yesterday.
export default function HabitsHistory() {
  const profile = useProfile(s => s.profile)
  const { today } = useLocalNow(profile?.timezone)
  const online = useOnline()
  const habits = useHabits(s => s.habits)
  const checks = useHabits(s => s.checks)
  const recent = useHabits(s => s.recent)
  // The month shown follows the turn of a month while the screen stays open, unless the person
  // has moved to another one.
  const current = monthOf(today)
  const [month, setMonth] = useState(current)
  const [base, setBase] = useState(current)
  if (base !== current) {
    setBase(current)
    if (month === base) setMonth(current)
  }
  // Every period, for the way back to the first one; until it comes, the ones already seen.
  const [allPeriods, setAllPeriods] = useState<HabitPeriod[] | null>(null)
  const [months, setMonths] = useState<Record<string, HabitHistory>>({})
  const [failed, setFailed] = useState<Record<string, true>>({})
  const [attempt, setAttempt] = useState(0)
  // Months asked in this visit: a month is read once per visit, not on every return to it.
  const asked = useRef(new Set<string>())
  // The sheet keeps the day it was opened with while it closes.
  const [picked, setPicked] = useState<{ day: string; open: boolean } | null>(null)

  useEffect(() => {
    if (!online) return
    let live = true
    fetchPeriods().then(p => { if (live) setAllPeriods(p) }, () => { /* the periods already seen will do */ })
    return () => { live = false }
  }, [online, attempt])

  const periods = useMemo(
    () => mergePeriods([allPeriods ?? [], recent?.periods ?? [], ...Object.values(months).map(m => m.periods)]),
    [allPeriods, recent, months]
  )
  const range = monthRange(month, periods, today)
  const inStore = !!range && !!recent && range.from >= shiftDay(today, -(RECENT_DAYS - 1))
  const due = !!range && !inStore && !months[month] && !failed[month] && !asked.current.has(month)

  useEffect(() => {
    if (!due) return
    asked.current.add(month)
    // Kept by month: an answer that lands after the person moved on still fills its own month.
    void loadHabitsMonth(month, periods, today).then(data => {
      if (data) setMonths(m => ({ ...m, [month]: data }))
      else setFailed(f => ({ ...f, [month]: true }))
    })
  }, [due, month, periods, today, attempt])

  const data = inStore ? recent : months[month] ?? null
  const history = useMemo<HabitHistory>(
    () => ({ days: data?.days ?? [], checks: data?.checks ?? [], targets: data?.targets ?? [], periods }),
    [data, periods]
  )
  const weeks = useMemo(() => buildHabitsMonth(month, history, checks, habits, today), [month, history, checks, habits, today])
  const legend = useMemo<CalendarLegendItem[]>(() => HABIT_LEGEND.map(s => ({ state: s, label: HABIT_DAY_STATE[s].label(), icon: HABIT_DAY_STATE[s].icon() })), [])
  const { min, max } = monthBounds(periods, today)

  const retry = () => {
    asked.current.delete(month)
    setFailed(f => { const { [month]: _, ...rest } = f; return rest })
    setAttempt(n => n + 1)
  }

  let empty: ReactNode = null
  if (!monthHasActiveDay(month, periods, today)) empty = <Note>{t('Habits were off this month, so no day counts here.')}</Note>
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
      <MonthCalendar month={month} weeks={weeks} onSelectDay={day => setPicked({ day, open: true })} minMonth={min} maxMonth={max}
        onPrevMonth={() => setMonth(m => shiftMonth(m, -1))} onNextMonth={() => setMonth(m => shiftMonth(m, 1))}
        stateClassName={STATE_CLASS} legend={empty ? undefined : legend} empty={empty} loading={loading} />
      {picked && (
        <HabitDaySheet day={picked.day} history={data} open={picked.open}
          onOpenChange={open => setPicked(p => (p ? { ...p, open } : p))} />
      )}
    </section>
  )
}

function Note({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className="flex items-center gap-2 rounded-2xl bg-card p-5 text-sm leading-snug text-muted-foreground">{icon}{children}</p>
}
