import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, CloudOff, CloudUpload, Dumbbell, Lock, RefreshCw, Trash2, Users } from 'lucide-react'
import MonthCalendar, { type CalendarCell, type CalendarWeek } from '@/components/calendar/MonthCalendar'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useOnline } from '@/lib/use-online'
import { cn } from '@/lib/utils'
import { dateLocale, exerciseNameFor, exerciseNameClass, t, tn } from '../../lib/i18n.js'
import { EXIDX, exOr } from '../../lib/exercises.js'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { trainingDayToast } from '../gamification/celebrations'
import { useToday } from '../nutrition/use-today'
import { shiftDay } from '../nutrition/days'
import { monthOf, shiftMonth } from '../nutrition/history'
import { fetchMyCheckins } from './checkin-api'
import { useCheckins, WINDOW_DAYS, type MyCheckin } from './useCheckins'
import { useCheckinPhoto } from './photo-src'
import { workoutOfCheckin } from './ingest'
import { activityLabel } from './activities'
import { useWeekTraining } from './week'
import type { CheckinDetail, CheckinRow } from './types'

type AppStore = { S: Record<string, any> }
type Load = 'idle' | 'loading' | 'error'

const noon = (iso: string) => new Date(iso + 'T12:00:00')
const longDay = (iso: string) => noon(iso).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
const lastDayOf = (month: string) => shiftDay(`${shiftMonth(month, 1)}-01`, -1)
const countText = (n: number) => (n === 1 ? t('1 check-in') : tn(n, '{0} check-ins', n))
const num = (n: number) => n.toLocaleString(dateLocale(), { maximumFractionDigits: 2 })
// Newest first, the order the store keeps.
const newestFirst = (a: CheckinRow, b: CheckinRow) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : (a.created_at ?? '') > (b.created_at ?? '') ? -1 : 0)

// The month as Monday-first rows of days; a day of another month is null.
function monthWeeks(month: string): (string | null)[][] {
  const first = `${month}-01`
  const last = lastDayOf(month)
  const lead = (noon(first).getDay() + 6) % 7
  const rows: (string | null)[][] = []
  let row: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = first; d <= last; d = shiftDay(d, 1)) {
    row.push(d)
    if (row.length === 7) { rows.push(row); row = [] }
  }
  if (row.length) rows.push([...row, ...Array.from({ length: 7 - row.length }, () => null)])
  return rows
}

// /plan/treinos, "Meus treinos" (spec 5.3): this week's training days, the last day the server
// confirmed, and the month as a calendar with the photo of each day with a check-in. A day opens
// its check-ins with the private note and the detailed session. The last WINDOW_DAYS days come from
// this phone (posts still going up included, deletes still on their way left out); older days are
// read from the server, month by month.
export default function MyTrainings() {
  const navigate = useNavigate()
  const sentTo = (useLocation().state as { day?: string } | null)?.day ?? null
  const tz = useProfile(s => s.profile?.timezone)
  const today = useToday(tz)
  const online = useOnline()
  const mine = useCheckins(s => s.mine)
  const userId = useCheckins(s => s.userId)
  const progress = useProgress(s => s.progress)
  const week = useWeekTraining()
  const [month, setMonth] = useState(() => monthOf(sentTo ?? today))
  const [picked, setPicked] = useState<string | null>(sentTo)
  const [fetched, setFetched] = useState<Record<string, CheckinRow[]>>({})
  const [load, setLoad] = useState<Load>('idle')
  const [attempt, setAttempt] = useState(0)

  // Days from here on are on this phone; a month that starts before it needs the server.
  const windowStart = shiftDay(today, -WINDOW_DAYS)
  const from = `${month}-01`
  const to = lastDayOf(month)
  const needsServer = from < windowStart
  const saved = fetched[month]

  useEffect(() => {
    if (!needsServer || saved || !online || !userId) return
    let live = true
    setLoad('loading')
    fetchMyCheckins(from, to < windowStart ? to : shiftDay(windowStart, -1)).then(
      rows => { if (!live) return; setFetched(f => ({ ...f, [month]: rows })); setLoad('idle') },
      () => { if (live) setLoad('error') }
    )
    return () => { live = false }
  }, [needsServer, saved, online, userId, month, from, to, windowStart, attempt])

  // The month's check-ins by day, newest first: the server's older days, this phone's recent ones.
  const byDay = useMemo(() => {
    const rows: CheckinRow[] = [
      ...(saved ?? []).filter(r => r.day < windowStart),
      ...mine.filter(r => r.day >= from && r.day <= to)
    ]
    const out = new Map<string, CheckinRow[]>()
    for (const r of [...rows].sort(newestFirst)) out.set(r.day, [...(out.get(r.day) ?? []), r])
    return out
  }, [saved, mine, windowStart, from, to])

  const weeks = useMemo<CalendarWeek[]>(() => monthWeeks(month).map(row => ({
    start: row.find(Boolean) ?? month,
    cells: row.map(day => (day ? cellOf(day, byDay.get(day) ?? [], today) : null))
  })), [month, byDay, today])

  const go = (by: number) => { setLoad('idle'); setMonth(m => shiftMonth(m, by)) }
  const retry = () => { setLoad('idle'); setAttempt(n => n + 1) }

  let empty: ReactNode = null
  if (needsServer && !saved) {
    if (!online) empty = <Note icon={<CloudOff aria-hidden className="size-4 shrink-0" />}>{t('Connect to see this month.')}</Note>
    else if (load === 'error') empty = <Failed onRetry={retry} />
  }
  const loading = !empty && needsServer && !saved
  const none = !empty && !loading && byDay.size === 0

  const confirmed = progress ? trainingDayToast(progress, null) : null
  const dayRows = picked ? byDay.get(picked) ?? [] : []
  // The last check-in of the open day deleted: the sheet closes and forgets the day.
  const settled = !loading && !empty
  useEffect(() => { if (picked && settled && !byDay.has(picked)) setPicked(null) }, [picked, settled, byDay])

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate('/plan')}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('My workouts')}</h1>
      </header>

      {week && (
        <section data-slot="card" className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <Dumbbell aria-hidden className="size-4 text-[var(--pillar-strength)]" />{t('{0} of {1} days this week', week.days, week.target)}
          </p>
          {confirmed && <p className="text-sm text-muted-foreground">{confirmed.text}</p>}
          <p className="text-xs text-muted-foreground">{t('A day counts two days later, when it closes.')}</p>
        </section>
      )}

      {none && <Note>{t('No check-ins this month.')}</Note>}

      <MonthCalendar month={month} weeks={weeks} onSelectDay={setPicked} maxMonth={monthOf(today)}
        onPrevMonth={() => go(-1)} onNextMonth={() => go(1)} stateClassName={STATE_CLASS} empty={empty} loading={loading} />

      <Drawer open={!!picked && dayRows.length > 0} onOpenChange={open => { if (!open) setPicked(null) }}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader>
            <DrawerTitle className="first-letter:uppercase">{picked ? longDay(picked) : ''}</DrawerTitle>
            <DrawerDescription>{countText(dayRows.length)}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {dayRows.map(r => <CheckinEntry key={r.id} row={r} />)}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

const STATE_CLASS: Record<string, string> = {
  checked: 'text-foreground',
  none: 'bg-card text-muted-foreground',
  future: 'border border-dotted border-border text-muted-foreground'
}

// A day of the month: its newest photo when it has check-ins, else "no check-in" or "not yet".
function cellOf(day: string, rows: CheckinRow[], today: string): CalendarCell {
  const future = day > today
  const state = rows.length ? 'checked' : future ? 'future' : 'none'
  const label = rows.length ? countText(rows.length) : future ? t('Not yet') : t('No check-in')
  return {
    day, state, label,
    icon: null,
    media: rows.length ? <DayPhoto row={rows[0]} /> : undefined,
    accessibleText: `${longDay(day)}: ${label}`,
    selectable: rows.length > 0,
    current: day === today
  }
}

function DayPhoto({ row }: { row: MyCheckin }) {
  const { url, fail } = useCheckinPhoto(row.photo, row.photo_path)
  return url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={fail} /> : <span className="block size-full bg-primary/15" />
}

// One check-in of the day, as only its owner sees it: photo, title, what and how long, who sees it,
// the caption, the private note and the detailed session, and the way to delete it.
function CheckinEntry({ row }: { row: MyCheckin }) {
  const S = useStore((s: AppStore) => s.S)
  const remove = useCheckins(s => s.remove)
  const { url, failed, fail } = useCheckinPhoto(row.photo, row.photo_path)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const titleId = `checkin-${row.id}-title`
  const meta = [
    activityLabel(row.activity),
    row.activity === 'strength' ? row.routine_name : null,
    row.duration_min ? t('{0} min', row.duration_min) : null
  ].filter(Boolean).join(' · ')
  const sets = sessionSets(S, row)

  const confirm = async () => {
    setBusy(true)
    try {
      await remove(row.id, row)
      toast(t('Check-in deleted.'))
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  return (
    <article aria-labelledby={titleId} className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="relative aspect-[4/5] w-full bg-secondary">
        {url && !failed && (
          <img src={url} alt={row.title} loading="lazy" decoding="async" draggable={false} onError={fail} className="absolute inset-0 size-full object-cover" />
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h3 id={titleId} className="text-[17px] font-semibold leading-snug break-words">{row.title}</h3>
          <p className="text-sm text-muted-foreground">{meta}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {row.visibility === 'private' ? <Lock aria-hidden className="size-3.5" /> : <Users aria-hidden className="size-3.5" />}
              {row.visibility === 'private' ? t('Only me') : t('Friends')}
            </span>
            {row.pending && <span className="flex items-center gap-1.5"><CloudUpload aria-hidden className="size-3.5" />{t('Sending…')}</span>}
          </p>
        </div>
        {row.caption && <p className="text-[15px] leading-snug whitespace-pre-line break-words">{row.caption}</p>}
        {row.note && (
          <div className="rounded-xl bg-secondary/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Lock aria-hidden className="size-3.5" />{t('Private note')}</p>
            <p className="mt-1 text-[15px] leading-snug whitespace-pre-line break-words">{row.note}</p>
          </div>
        )}
        {sets.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{t('Workout detailed')}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {sets.map(e => (
                <li key={e.id} className="flex flex-col">
                  <span className={cn('text-[15px] font-medium', exerciseNameClass((EXIDX as Record<string, unknown>)[e.id]))}>{exerciseNameFor(exOr(e.id))}</span>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">{e.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {asking ? (
          <div role="group" aria-labelledby={titleId + '-ask'} className="flex flex-col gap-2 rounded-xl border border-destructive/40 p-3">
            <p id={titleId + '-ask'} className="text-[15px] font-semibold">{t('Delete this check-in?')}</p>
            <p className="text-sm leading-snug text-muted-foreground">{t('The photo goes too. If the day is still open, it stops counting.')}</p>
            <div className="flex gap-2">
              <Button variant="destructive" className="h-11 flex-1 rounded-xl" disabled={busy} onClick={confirm}>{t('Delete')}</Button>
              <Button variant="ghost" className="h-11 flex-1 rounded-xl" disabled={busy} onClick={() => setAsking(false)}>{t('Cancel')}</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="h-11 gap-2 self-start rounded-xl px-3 text-muted-foreground hover:text-destructive" onClick={() => setAsking(true)}>
            <Trash2 aria-hidden className="size-4" />{t('Delete check-in')}
          </Button>
        )}
      </div>
    </article>
  )
}

// The detailed session of a check-in, per exercise: "60 kg × 8 · 62.5 kg × 6". The history session
// comes first (written by the check-in, or the live workout linked to it, both through
// workoutOfCheckin); a detail whose session is not on this phone is read from the check-in.
function sessionSets(S: Record<string, any>, row: CheckinRow): { id: string; text: string }[] {
  const unit = S.unit || 'kg'
  const session = workoutOfCheckin(S, row.id)
  const entries: CheckinDetail['entries'] = session
    ? session.entries.map(e => ({ id: e.id, sets: e.sets.filter(s => s.done && Number(s.r) > 0).map(s => ({ w: Number(s.w) || 0, r: Number(s.r), done: true as const })) }))
    : row.detail?.entries ?? []
  return entries
    .filter(e => e.sets.length)
    .map(e => ({ id: e.id, text: e.sets.map(s => (s.w > 0 ? `${num(s.w)} ${unit} × ${s.r}` : `× ${s.r}`)).join(' · ') }))
}

function Note({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <p className="flex items-center gap-2 rounded-2xl bg-secondary/60 px-4 py-3 text-sm leading-snug text-muted-foreground">{icon}{children}</p>
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl bg-secondary/60 px-4 py-3">
      <p className="text-sm text-muted-foreground">{t('Could not load your check-ins.')}</p>
      <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
        <RefreshCw aria-hidden className="size-4" />{t('Try again')}
      </Button>
    </div>
  )
}
