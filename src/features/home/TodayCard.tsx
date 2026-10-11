import { useState, type CSSProperties, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Camera, ChevronLeft, ChevronRight, CloudUpload, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '../../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay } from '../../lib/history.js'
import { todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../../lib/format.js'
import { t, tn, dateLocale } from '../../lib/i18n.js'
import { dayOverrideSheet, calendarSheet, startFlow } from '../../sheets.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import LegacyIcon from '../../components/Icon.jsx'
import { useCheckins, type MyCheckin } from '../checkin/useCheckins'
import { openCheckinCamera, type OpenCheckinOptions } from '../checkin/open-checkin'
import { useCheckinPhoto } from '../checkin/photo-src'
import { detailOfWorkout } from '../checkin/ingest'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { useToday } from '../nutrition/use-today'

type HomeStore = { S: Record<string, any> }
// The routine's own glyph (chosen in the plan editor) comes from the legacy icon set.
const Icon = LegacyIcon as unknown as (p: { name: string; className?: string; style?: CSSProperties }) => ReactElement

const DOT: Record<string, string> = { done: 'bg-primary', ovr: 'bg-[var(--orange)]', plan: 'bg-muted-foreground/50', none: 'bg-transparent' }
const TAG = {
  orange: 'bg-[color-mix(in_oklab,var(--orange)_16%,transparent)] text-[var(--orange)]',
  green: 'bg-[color-mix(in_oklab,var(--green)_16%,transparent)] text-[var(--green)]',
  primary: 'bg-primary text-primary-foreground'
}

// What to do now: the week (today ringed, each day's state as a dot, a tap to reschedule) and the
// today row. A signed-in account checks in (phase 1c, spec 5.3): the row shows today's routine or a
// rest day with the way to post a check-in, or the check-in already made, with its photo and title.
// The live workout is reached from the Plan; one in progress is still resumed here. Without an
// account (guest), the legacy row: resume, edit, done, start the plan or plan a rest day, and the
// way to the Start screen when a plan already owns today, which the legacy tests pin.
export function TodayCard() {
  const nav = useNavigate()
  const S = useStore((s: HomeStore) => s.S)
  const [weekOffset, setWeekOffset] = useState(0)
  // The check-in store is bound once a signed-in account has its profile (App.jsx).
  const checkins = useCheckins(s => (s.userId ? s.mine : null))
  const tz = useProfile(s => s.profile?.timezone)
  // The check-in cutover, once the progress has loaded: before it, a workout made the day count.
  const since = useProgress(s => s.progress?.training_since ?? null)
  const zoned = useToday(tz)

  // "Today" is the profile's day for check-ins, the device's for the legacy row.
  const today = checkins ? zoned : todayISO()
  // A weekday can hold several routines: the session name joins them, the glyph is the first's.
  const todayRoutines = effectiveRoutines(S, today)
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map((r: any) => r.name).join(' + ')
  const todayOvr = S.dayPlan[today] !== undefined
  // An open editor on a saved workout holds S.active too, but it is an edit, not a session.
  const editingSaved = !!S.active?.editingWorkoutId
  const next = !S.active && !todayRoutines.length ? nextTrainingDay(S, today) : null
  // The last session logged today, if any: the row reports it instead of asking for it again.
  const doneToday = S.workouts.filter((w: any) => w.d === today).at(-1) || null

  const now = new Date()
  const wkStart = new Date(now)
  wkStart.setDate(now.getDate() - weekDayOffset(now.getDay(), weekStartOf(S)) + weekOffset * 7)
  const wkEnd = new Date(wkStart)
  wkEnd.setDate(wkStart.getDate() + 6)
  const month = (d: Date) => d.toLocaleDateString(dateLocale(), { month: 'short' })
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${month(wkStart)} – ${wkEnd.getDate()} ${month(wkEnd)}`
  // Done is what the server counts. With check-ins, that is a day with one, or a workout before the
  // cutover (a legacy day); a live workout after it, without a check-in, does not count.
  const doneDays = new Set<string>(checkins
    ? [...checkins.map(c => c.day), ...(since ? S.workouts.map((w: any) => w.d).filter((d: string) => d < since) : [])]
    : S.workouts.map((w: any) => w.d))
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wkStart)
    d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const planned = effectiveRoutineIds(S, iso).length > 0
    const moved = S.dayPlan[iso] !== undefined
    return { d, iso, state: doneDays.has(iso) ? 'done' : moved && planned ? 'ovr' : planned ? 'plan' : 'none' }
  })
  // Today's check-ins, newest first (the store keeps that order).
  const checkedToday = checkins ? checkins.filter(c => c.day === today) : []

  const onToday = () => {
    if (S.active) nav('/workout')
    else if (checkins) { if (checkedToday.length) nav('/plan/treinos', { state: { day: today } }) }
    else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, today))
    else dayOverrideSheet(today)
  }
  const title = S.active ? (editingSaved ? S.active.name : t('{0} — in progress', S.active.name))
    : doneToday ? (doneToday.name ? t('{0} — done', doneToday.name) : t('Workout done'))
    : routine ? todayName : t('Rest day')
  const suffix = todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''
  const tag = S.active ? { text: editingSaved ? t('Edit') : t('Resume'), tone: 'orange' as const }
    : doneToday ? { text: t('Done'), tone: 'green' as const }
    : routine ? { text: t('Start'), tone: 'primary' as const } : null
  const glyph = S.active ? (editingSaved ? 'pencil' : 'timer') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'
  const tile = S.active ? 'bg-[var(--orange)] text-white' : doneToday ? 'bg-secondary text-[var(--green)]'
    : routine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
  const total = S.workouts.length

  return (
    <section data-slot="card" aria-label={t('Today')} className="rounded-3xl border border-border bg-card p-4 text-card-foreground">
      {/* Equal side columns keep the week label centred over the strip. */}
      <div className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center">
        <div className="flex items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Previous week')} onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="size-5" />
          </Button>
        </div>
        <span data-testid="week-label" className="text-center text-sm font-medium text-muted-foreground">{wkLabel}</span>
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Next week')} onClick={() => setWeekOffset(w => w + 1)}>
            <ChevronRight className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Calendar')} onClick={() => calendarSheet()}>
            <CalendarDays className="size-5" />
          </Button>
        </div>
      </div>

      <ol className="m-0 mt-1 grid list-none grid-cols-7 gap-1 p-0">
        {days.map(day => (
          <li key={day.iso}>
            <button type="button" onClick={() => dayOverrideSheet(day.iso)} data-state={day.state}
              aria-label={`${t(DAYN[day.d.getDay()])} ${day.d.getDate()}` + (day.state === 'done' ? ', ' + t('Done') : '')}
              aria-current={day.iso === today ? 'date' : undefined}
              className={cn('flex h-16 w-full flex-col items-center justify-center gap-1 rounded-2xl outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                day.iso === today ? 'bg-secondary ring-1 ring-primary/60' : 'hover:bg-secondary/60')}>
              <span className="text-[11px] font-medium uppercase text-muted-foreground">{t(DAYS[day.d.getDay()])}</span>
              <span className="font-mono text-[15px] font-semibold tabular-nums">{day.d.getDate()}</span>
              <span aria-hidden className={cn('size-1.5 rounded-full', DOT[day.state])} />
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-right text-xs text-muted-foreground">{total === 1 ? t('{0} workout total', total) : tn(total, '{0} workouts total', total)}</p>

      {checkins && !S.active ? (
        <CheckinRow today={today} checked={checkedToday} routineName={routine ? todayName : null} glyph={routine ? glyphOf(routine.emoji) : 'moon'}
          onOpen={onToday} onCheckIn={() => openCheckinCamera(checkinOptions(routine?.id ?? null, doneToday))} />
      ) : (
        <button type="button" data-testid="today-row" onClick={onToday}
          className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-2.5 text-left outline-none transition-[background-color,transform] duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100">
          <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-lg', tile)}><Icon name={glyph} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">{t('Today')}</span>
            <span data-testid="today-title" className="block truncate text-[15px] font-semibold">{title}{suffix}</span>
            {next && !doneToday && (
              <span className="block truncate text-xs text-muted-foreground">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</span>
            )}
          </span>
          {tag
            ? <span data-testid="today-tag" className={cn('shrink-0 rounded-full px-3 py-1 text-sm font-semibold', TAG[tag.tone])}>{tag.text}</span>
            : <Plus aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
        </button>
      )}

      {/* The today row and the tab bar's Start both go straight into a planned session; this is
          the door to a freestyle session or another routine, and it starts nothing on its own. */}
      {!S.active && !checkins && (
        <div className="mt-1 flex justify-center">
          <Button variant="ghost" className="h-11 gap-2 rounded-xl text-muted-foreground" onClick={() => nav('/workout')}>
            <RotateCcw aria-hidden className="size-4" />{t('Choose a different workout')}
          </Button>
        </div>
      )}
    </section>
  )
}

// What the check-in opens with: today's routine and, when a live workout finished today without a
// check-in, that workout, so its sets come along and no second session is written (spec 3.6).
function checkinOptions(routineId: string | null, done: any): OpenCheckinOptions {
  const opts: OpenCheckinOptions = routineId ? { routineId } : {}
  if (done && !done.checkinId && done.id) {
    opts.fromWorkout = done.id
    const detail = detailOfWorkout(done)
    if (detail) opts.detail = detail
    if (!routineId && done.routineId) opts.routineId = done.routineId
  }
  return opts
}

// The today row of a signed-in account: today's check-in (photo, title, done), or today's routine
// or a rest day with the button to post one. A workout logged today without a check-in is pointed
// out, since the day only counts with the check-in.
function CheckinRow({ today, checked, routineName, glyph, onOpen, onCheckIn }: {
  today: string; checked: MyCheckin[]; routineName: string | null; glyph: string; onOpen: () => void; onCheckIn: () => void
}) {
  const S = useStore((s: HomeStore) => s.S)
  const latest = checked[0] ?? null
  const loggedLive = !latest && S.workouts.some((w: any) => w.d === today && !w.checkinId)
  if (latest) {
    return (
      <button type="button" data-testid="today-row" onClick={onOpen}
        className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-2.5 text-left outline-none transition-[background-color,transform] duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100">
        <Thumb row={latest} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{t('Today')}</span>
          <span data-testid="today-title" className="block truncate text-[15px] font-semibold">{latest.title}</span>
          {latest.pending && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><CloudUpload aria-hidden className="size-3.5" />{t('Sending…')}</span>
          )}
        </span>
        <span data-testid="today-tag" className={cn('shrink-0 rounded-full px-3 py-1 text-sm font-semibold', TAG.green)}>{t('Done')}</span>
      </button>
    )
  }
  return (
    <div data-testid="today-row" className="mt-2 flex min-h-16 w-full items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-2.5">
      <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-lg', routineName ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
        <Icon name={glyph} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{t('Today')}</span>
        <span data-testid="today-title" className="block truncate text-[15px] font-semibold">{routineName ?? t('Rest day')}</span>
        {loggedLive && <span className="block text-xs leading-snug text-muted-foreground">{t('Workout logged. Check in so the day counts.')}</span>}
      </span>
      <Button className="h-11 shrink-0 gap-2 rounded-xl px-3.5 text-sm font-semibold" onClick={onCheckIn}>
        <Camera aria-hidden className="size-4" />{t('Post a check-in')}
      </Button>
    </div>
  )
}

// The photo of a check-in, small and square; decorative, the title beside it says what it is.
function Thumb({ row }: { row: MyCheckin }) {
  const { url, fail } = useCheckinPhoto(row.photo, row.photo_path)
  return (
    <span data-testid="today-thumb" aria-hidden className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-secondary">
      {url
        ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={fail} className="size-full object-cover" />
        : <Camera className="absolute inset-0 m-auto size-5 text-muted-foreground" />}
    </span>
  )
}
