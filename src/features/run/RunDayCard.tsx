// The run card of one day in the Plan's week schedule (spec §6.4): for each run of the plan on
// that date, the workout's name and minutes, its blocks in one line with the paces (SessionBlocks),
// the fit warnings against the strength week as it is now (spec §6.2, recomputed live for every
// session of the week, Decision 3) and "Change day", which lists the days of this week from today
// on with the warnings each move would bring. A move changes only that week. On race day it shows
// the race with its distance; in the race week, runs move only to days before the race, and race
// day counts as a hard day for the warnings (final review I1 and M6). Today's card has "Log run",
// which opens the check-in on running, linked to the day's workout (phase 1e-b). A workout done
// (spec §8.1, progress.ts doneSessions) shows "Run done" with a check, from the screen's `logs`
// (useRunLogs, read once by the Plan and passed down).
import { useState } from 'react'
import { CircleCheck, Flag, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { DAYN, isoOf, startOfWeek, todayISO, weekDayOffset, weekOrder, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { openCheckin } from '../checkin/open-checkin'
import { moveWarnings, weekWarnings, type FitWarning } from './fit'
import { fitWarningText, goalName, sessionName } from './labels'
import { weekMinutes } from './models'
import { weekStartDate } from './dates'
import { doneSessions, weekOffsetOf } from './progress'
import { currentWeek, moveSession, planWeekStart, raceBounds, raceOn, sessionsOn, strengthWeek, type RunState } from './run-actions'
import type { RunLog } from './run-log'
import SessionBlocks from './SessionBlocks'
import type { Session, Week } from './types'

type AppStore = { S: RunState; update: (mut: (S: RunState) => void) => void }

/** The date of weekday `day` (0 = Sunday) in the week holding `today`, for a week starting on `ws`. */
export function weekDayIso(today: string, ws: number, day: number): string {
  const d = startOfWeek(today, ws)
  d.setDate(d.getDate() + weekDayOffset(day, ws))
  return isoOf(d)
}

export default function RunDayCard({ day, iso, logs = [] }: { day: number; iso: string; logs?: RunLog[] }) {
  const S = useStore((s: AppStore) => s.S)
  const update = useStore((s: AppStore) => s.update)
  const [moving, setMoving] = useState<Session | null>(null)
  const ws = weekStartOf(S)
  const plan = S.runPlan
  const week = currentWeek(plan, iso, ws)
  const sessions = sessionsOn(plan, iso, ws)
  const race = raceOn(plan, iso)
  if (!plan || (!race && (!week || !sessions.length))) return null
  // The run's plan week, on the week start the plan was made with (it may differ from S.weekStart).
  const pws = planWeekStart(plan, ws)
  const done = doneSessions(plan, weekOffsetOf(plan, iso, ws), logs, ws)

  const strength = strengthWeek(S)
  const routines = S.routines || []
  // In the race week: the days before the race, and race day as a hard day.
  const bounds = plan.raceDate && raceOn(plan, plan.raceDate) ? raceBounds(plan.raceDate, weekStartDate(iso, pws)) : null
  const warnings = week ? weekWarnings(week.sessions, strength, routines, bounds?.raceDay) : {}
  const today = todayISO()
  // Days of the run's plan week still to come, today included, in the plan week's order, and
  // before the race.
  const open = weekOrder(pws).filter(d => weekDayIso(iso, pws, d) >= today && (!bounds || bounds.days.includes(d)))
  const targets = (s: Session) => open.filter(d => d !== s.day)

  const move = (s: Session, to: number) => {
    if (week) update(draft => { moveSession(draft, week.index, s.id, to, iso) })
    setMoving(null)
  }

  return (
    <div className="mt-2 flex flex-col gap-2 font-sans">
      {race && (
        <article aria-labelledby={`race-${iso}`} className="flex items-center gap-3 rounded-xl border-2 border-primary bg-background/40 px-3 py-2.5">
          <Flag aria-hidden className="size-5 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-col">
            <h3 id={`race-${iso}`} className="text-[15px] font-semibold">{t('Race day')}</h3>
            <span className="text-sm text-muted-foreground">{goalName(plan.goal)}</span>
          </div>
        </article>
      )}
      {sessions.map(s => (
        <article key={s.id} aria-labelledby={`run-${iso}-${s.id}`} className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id={`run-${iso}-${s.id}`} className="text-[15px] font-semibold">{sessionName(s.type)}</h3>
            <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">{t('{0} min', weekMinutes({ sessions: [s] }))}</span>
          </div>
          {done.has(s.id) && (
            <span data-slot="run-done" className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-primary" />{t('Run done')}
            </span>
          )}
          <div className="mt-1"><SessionBlocks session={s} vdot={plan.vdot} /></div>
          <Warnings list={warnings[s.id]} type={s.type} />
          {targets(s).length > 0 && (
            <Button variant="outline" size="sm" className="mt-2 h-11 w-full rounded-lg"
              aria-label={`${t('Change day')}: ${sessionName(s.type)}`} onClick={() => setMoving(s)}>{t('Change day')}</Button>
          )}
        </article>
      ))}

      {iso === today && (
        <Button size="sm" className="h-11 w-full rounded-lg" onClick={() => openCheckin({ activity: 'run' })}>{t('Log run')}</Button>
      )}

      <Drawer open={!!moving} onOpenChange={o => { if (!o) setMoving(null) }}>
        <DrawerContent>
          {moving && week && <MovePicker session={moving} days={targets(moving)} iso={iso} ws={pws}
            warningsAt={d => moveWarnings(moving.id, d, placementOf(week), week.sessions, { week: strength, routines, raceDay: bounds?.raceDay })}
            onPick={d => move(moving, d)} onCancel={() => setMoving(null)} />}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

const placementOf = (week: Week) => Object.fromEntries(week.sessions.map(s => [s.id, s.day]))

function Warnings({ list, type }: { list?: FitWarning[]; type: Session['type'] }) {
  if (!list?.length) return null
  return (
    <ul className="mt-2 flex list-none flex-col gap-1">
      {list.map(w => (
        <li key={w} className="flex items-start gap-2 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--orange,currentColor)]" />
          <span>{fitWarningText(w, type)}</span>
        </li>
      ))}
    </ul>
  )
}

type PickerProps = {
  session: Session
  days: number[]
  iso: string
  ws: number
  warningsAt: (day: number) => FitWarning[]
  onPick: (day: number) => void
  onCancel: () => void
}

function MovePicker({ session, days, iso, ws, warningsAt, onPick, onCancel }: PickerProps) {
  const today = todayISO()
  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{t('Change day')}</DrawerTitle>
        <DrawerDescription>{sessionName(session.type)}. {t('Moves this week only.')}</DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-2 px-4">
        {days.map(d => {
          const list = warningsAt(d)
          return (
            <button key={d} type="button" data-day={d} onClick={() => onPick(d)}
              className="flex min-h-12 flex-col items-start gap-1 rounded-xl border border-border bg-card px-4 py-2.5 text-start">
              <span className="text-[15px] font-medium">
                {t(DAYN[d])}{weekDayIso(iso, ws, d) === today && <span className="ms-2 text-sm text-muted-foreground">{t('Today')}</span>}
              </span>
              {list.map(w => (
                <span key={w} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--orange,currentColor)]" />
                  {fitWarningText(w, session.type)}
                </span>
              ))}
            </button>
          )
        })}
      </div>
      <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button size="lg" variant="ghost" className="h-12 rounded-xl text-base" onClick={onCancel}>{t('Cancel')}</Button>
      </DrawerFooter>
    </>
  )
}
