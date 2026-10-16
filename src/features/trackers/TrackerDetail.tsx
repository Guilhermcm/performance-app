import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, CalendarPlus, Pencil, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useLocalNow } from '../sleep/use-local-now'
import { shortDate } from '../sleep/chart-data'
import { shiftDay } from '../nutrition/days'
import { iconFor } from '../habits/icons'
import { useTrackers } from './useTrackers'
import { useDroppedNotice } from './useDroppedNotice'
import { daySummaries, labelCounts, movingAverage, periodStats } from './stats'
import { formatValue, whenText } from './format'
import { PERIODS, periodDays, type Period } from './chart-data'
import { TrackerChartSkeleton, TrackerDetailSkeleton } from './TrackerChartSkeleton'
import TrackerSheet from './TrackerSheet'
import EntrySheet from './EntrySheet'
import type { Tracker, TrackerEntry } from './types'

// Recharts and the two charts load on demand, each behind a skeleton of its own size.
const TrackerLineChart = lazy(() => import('./TrackerLineChart'))
const TrackerBars = lazy(() => import('./TrackerBars'))

// /trackers/:id (spec 8.4): 30 or 90 days of one tracker, as a chart, stats and the entries of
// the period, each one editable. "+" logs now; "Add entry" opens the full sheet for a new entry on
// any day of the window, at any time, with a note. An archived tracker shows the same, says it is
// archived, offers to reactivate it and takes no new entry (the server refuses one).
export default function TrackerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useProfile(s => s.profile)
  const status = useTrackers(s => s.status)
  const tracker = useTrackers(s => s.trackers.find(x => x.id === id))
  useDroppedNotice()

  // Opened from a link or a reload there is nothing to go back to: the list instead.
  const goBack = () => (location.key === 'default' ? navigate('/trackers') : navigate(-1))
  if (status === 'idle' || status === 'loading') return <TrackerDetailSkeleton />
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">
      {tracker
        ? <Detail key={tracker.id} tracker={tracker} timezone={profile?.timezone} onBack={goBack} />
        : status === 'error' ? <LoadError onBack={goBack} /> : <Missing onBack={goBack} />}
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={onBack}>
      <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
    </Button>
  )
}

// The first pull failed with nothing saved: the tracker may well exist, so a retry, not "missing".
function LoadError({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="-ms-2 flex h-11 items-center"><BackButton onBack={onBack} /></div>
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-[15px] font-medium leading-snug">{t('Could not load your trackers.')}</p>
        <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void useTrackers.getState().refresh()}>
          <RefreshCw aria-hidden className="size-4" />{t('Try again')}
        </Button>
      </div>
    </>
  )
}

function Missing({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="-ms-2 flex h-11 items-center"><BackButton onBack={onBack} /></div>
      <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
        <p className="text-[15px] font-medium">{t('This tracker no longer exists')}</p>
        <Link to="/trackers" className="inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {t('See your trackers')}
        </Link>
      </section>
    </>
  )
}

const amountOf = (tracker: Tracker, e: TrackerEntry): number | null => (tracker.kind === 'duration' ? e.minutes : e.value)

// An entry's value in words: the formatted number or duration, or the option's text.
function entryValue(tracker: Tracker, e: TrackerEntry): string {
  if (tracker.kind === 'label') return tracker.options?.find(o => o.id === e.option)?.text ?? ''
  const n = amountOf(tracker, e)
  return n == null ? '' : formatValue(tracker, n, dateLocale())
}

function Detail({ tracker, timezone, onBack }: { tracker: Tracker; timezone: string | null | undefined; onBack: () => void }) {
  const { today } = useLocalNow(timezone)
  const all = useTrackers(s => s.entries)
  const [period, setPeriod] = useState<Period>(30)
  const [sheet, setSheet] = useState(false)
  const [entrySheet, setEntrySheet] = useState<{ entry?: TrackerEntry; mode: 'quick' | 'full'; open: boolean }>({ mode: 'quick', open: false })
  const archived = !!tracker.archived_at
  const Icon = iconFor(tracker.icon)

  const entries = useMemo(() => all.filter(e => e.tracker_id === tracker.id), [all, tracker.id])
  const from = shiftDay(today, -(period - 1))
  const days = useMemo(() => periodDays(today, period), [today, period])
  const inPeriod = useMemo(() => entries.filter(e => e.day >= from && e.day <= today), [entries, from, today])
  const stats = useMemo(() => periodStats(tracker, entries, from, today, today), [tracker, entries, from, today])
  const line = useMemo(() => {
    if (tracker.kind === 'label') return null
    const map = daySummaries(tracker, entries)
    return {
      summaries: days.map(d => map.get(d)?.value ?? null),
      trend: movingAverage(map, days),
      counts: days.map(d => map.get(d)?.count ?? 0),
    }
  }, [tracker, entries, days])
  const rows = useMemo(() => (tracker.kind === 'label' ? labelCounts(tracker, inPeriod) : []), [tracker, inPeriod])

  // The entries of the period by day, newest day and time first.
  const byDay = useMemo(() => {
    const out = new Map<string, TrackerEntry[]>()
    for (const e of [...inPeriod].sort((a, b) => (a.day === b.day ? b.at.localeCompare(a.at) : b.day.localeCompare(a.day)))) {
      const list = out.get(e.day)
      if (list) list.push(e)
      else out.set(e.day, [e])
    }
    return [...out]
  }, [inPeriod])

  const locale = dateLocale()
  const fmt = (n: number | null) => (n == null ? '' : formatValue(tracker, n, locale))
  const last = stats.daysSinceLast == null ? t('Nothing in the last 90 days') : t('Last: {0}', whenText(shiftDay(today, -stats.daysSinceLast), today))

  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="-ms-2 flex h-11 items-center justify-between">
          <BackButton onBack={onBack} />
          {!archived && (
            <div className="-me-2 flex items-center">
              <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Edit tracker')} onClick={() => setSheet(true)}>
                <Pencil aria-hidden className="size-5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Log for {0}', tracker.name)}
                onClick={() => setEntrySheet({ mode: 'quick', open: true })}>
                <Plus aria-hidden className="size-5" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-foreground', archived && 'opacity-70')}>
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{tracker.name}</h1>
        </div>
      </header>

      {archived && (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm leading-snug">
            <Archive aria-hidden className="size-4 shrink-0 text-muted-foreground" />{t('Archived. You can still edit and delete its entries.')}
          </p>
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => setSheet(true)}>{t('Reactivate')}</Button>
        </div>
      )}

      <div role="group" aria-label={t('Period')} className="flex gap-1 self-start rounded-xl bg-secondary p-1">
        {PERIODS.map(p => (
          <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}
            className={cn('h-11 min-w-20 rounded-lg px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
              period === p ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {tn(p, '{0} days', p)}
          </button>
        ))}
      </div>

      {line ? (
        <Suspense fallback={<TrackerChartSkeleton kind="line" days={period} empty={line.summaries.every(v => v == null)} />}>
          <TrackerLineChart tracker={tracker} days={days} summaries={line.summaries} trend={line.trend} counts={line.counts} stats={stats} />
        </Suspense>
      ) : (
        <Suspense fallback={<TrackerChartSkeleton kind="bars" days={period} options={rows.length} />}>
          <TrackerBars rows={rows} days={period} />
        </Suspense>
      )}

      <section className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-2">
          {tracker.kind !== 'label' && stats.average != null && (
            <>
              <Stat label={t('Average')} value={fmt(stats.average)} />
              <Stat label={t('Minimum')} value={fmt(stats.min)} />
              <Stat label={t('Maximum')} value={fmt(stats.max)} />
            </>
          )}
          <Stat label={t('Days with entries')} value={String(stats.daysWithEntries)} />
        </dl>
        <p className="text-sm text-muted-foreground">{last}</p>
      </section>

      {!archived && (
        <Button variant="outline" className="h-12 gap-2 rounded-xl text-[15px]" onClick={() => setEntrySheet({ mode: 'full', open: true })}>
          <CalendarPlus aria-hidden className="size-4" />{t('Add entry')}
        </Button>
      )}

      {byDay.length > 0 && (
        <section aria-labelledby="tracker-entries-title" className="flex flex-col gap-3">
          <h2 id="tracker-entries-title" className="text-[15px] font-semibold">{t('Entries')}</h2>
          {byDay.map(([day, list]) => (
            <div key={day} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground first-letter:uppercase">{shortDate(day, true)}</h3>
              <ul className="rounded-2xl border border-border bg-card px-2 py-1">
                {list.map(e => (
                  <li key={e.id} className="border-b border-border last:border-b-0">
                    <button type="button" onClick={() => setEntrySheet({ entry: e, mode: 'full', open: true })}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-start outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none">
                      <span className="w-12 shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{e.at}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[15px] font-medium tabular-nums">{entryValue(tracker, e)}</span>
                        {e.note && <span className="block truncate text-sm text-muted-foreground">{e.note}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <TrackerSheet tracker={tracker} open={sheet} onOpenChange={setSheet} />
      <EntrySheet tracker={tracker} entry={entrySheet.entry} mode={entrySheet.mode} open={entrySheet.open}
        onOpenChange={open => setEntrySheet(s => ({ ...s, open }))} />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
