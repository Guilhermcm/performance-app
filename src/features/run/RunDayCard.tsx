// The run card of one day in the Plan's week schedule (spec §6.4): for each run of the plan on
// that date, the workout's name and minutes, its blocks in one line with the paces (SessionBlocks),
// the fit warnings against the strength week as it is now (spec §6.2, recomputed live for every
// session of the week, Decision 3) and "Change day", which lists the days of this week from today
// on with the warnings each move would bring. A move changes only that week. On race day it shows
// the race with its distance; in the race week, runs move only to days before the race, and race
// day counts as a hard day for the warnings (final review I1 and M6). Today's card has "Log run",
// which opens the check-in on running, linked to the day's workout (phase 1e-b), for a signed-in
// account only: the check-in panel is mounted for one (App.jsx), so for a guest the button would
// open nothing and leave the panel waiting to pop up after sign-in (1e-b final review I1). A workout done
// (spec §8.1, progress.ts doneSessions) shows "Run done" with a check, from the screen's `logs`
// (useRunLogs, read once by the Plan and passed down).
import { useState } from 'react'
import { ChevronRight, CircleCheck, Flag, Footprints, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { t } from '../../lib/i18n.js'
import { DAYN, isoOf, startOfWeek, todayISO, weekDayOffset, weekOrder, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { openCheckin } from '../checkin/open-checkin'
import { useCheckins } from '../checkin/useCheckins'
import { moveWarnings, weekWarnings, type FitWarning } from './fit'
import { blocksInline, fitWarningText, goalName, sessionName } from './labels'
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
  const [openId, setOpenId] = useState<string | null>(null)
  const [moving, setMoving] = useState<Session | null>(null)
  // Check-ins need a signed-in account (the store is bound once its profile is in, App.jsx).
  const canCheckIn = !!useCheckins(s => s.userId)
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
    setOpenId(null)
  }
  const opened = sessions.find(s => s.id === openId) ?? null
  const close = () => { setOpenId(null); setMoving(null) }

  // Each run is one row, like a routine's under its day (icon, name, a line under it); the blocks,
  // the paces, the warnings, "Change day" and "Log run" open in a drawer from the row.
  return (
    <div className="flex flex-col font-sans">
      {race && (
        <div className="row" style={{ gap: 8, padding: '4px 0 4px 8px', minHeight: 44 }}>
          <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Flag aria-hidden className="size-4" /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tt" style={{ fontSize: 14 }}>{t('Race day')}</div>
            <div className="ss">{goalName(plan.goal)}</div>
          </div>
        </div>
      )}
      {sessions.map(s => {
        const list = warnings[s.id] ?? []
        return (
          <button key={s.id} type="button" data-slot="run-row" onClick={() => setOpenId(s.id)}
            className="row w-full text-start" style={{ gap: 8, padding: '4px 0 4px 8px', minHeight: 44 }}>
            <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Footprints aria-hidden className="size-4" /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="tt block" style={{ fontSize: 14 }}>{sessionName(s.type)}</span>
              <span className="ss block truncate">
                <span className="tabular-nums">{t('{0} min', weekMinutes({ sessions: [s] }))}</span>
                <span aria-hidden>{' · '}{blocksInline(s.blocks)}</span>
              </span>
            </span>
            {done.has(s.id) && (
              <span data-slot="run-done" className="inline-flex shrink-0 items-center">
                <CircleCheck aria-hidden className="size-4 text-primary" /><span className="sr-only">{t('Run done')}</span>
              </span>
            )}
            {list.length > 0 && (
              <span className="inline-flex shrink-0 items-center">
                <TriangleAlert aria-hidden className="size-4 text-[var(--orange,currentColor)]" />
                <span className="sr-only">{list.map(w => fitWarningText(w, s.type)).join('. ')}</span>
              </span>
            )}
            <ChevronRight aria-hidden className="chev size-[15px]" strokeWidth={2.4} />
          </button>
        )
      })}

      <Drawer open={!!opened} onOpenChange={o => { if (!o) close() }}>
        <DrawerContent>
          {opened && week && (moving
            ? <MovePicker session={moving} days={targets(moving)} iso={iso} ws={pws}
                warningsAt={d => moveWarnings(moving.id, d, placementOf(week), week.sessions, { week: strength, routines, raceDay: bounds?.raceDay })}
                onPick={d => move(moving, d)} onCancel={() => setMoving(null)} />
            : <Details session={opened} vdot={plan.vdot} done={done.has(opened.id)} warnings={warnings[opened.id]}
                canMove={targets(opened).length > 0} canLog={iso === today && canCheckIn}
                onMove={() => setMoving(opened)} onLog={() => { close(); openCheckin({ activity: 'run' }) }} onClose={close} />)}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

type DetailsProps = {
  session: Session
  vdot?: number | null
  done: boolean
  warnings?: FitWarning[]
  canMove: boolean
  canLog: boolean
  onMove: () => void
  onLog: () => void
  onClose: () => void
}

function Details({ session: s, vdot, done, warnings, canMove, canLog, onMove, onLog, onClose }: DetailsProps) {
  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{sessionName(s.type)}</DrawerTitle>
        <DrawerDescription className="font-mono tabular-nums">{t('{0} min', weekMinutes({ sessions: [s] }))}</DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-3 px-4 font-sans">
        {done && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-primary" />{t('Run done')}
          </span>
        )}
        <SessionBlocks session={s} vdot={vdot} />
        <Warnings list={warnings} type={s.type} />
      </div>
      <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
        {canLog && <Button size="lg" className="h-12 rounded-xl text-base" onClick={onLog}>{t('Log run')}</Button>}
        {canMove && (
          <Button size="lg" variant="outline" className="h-12 rounded-xl text-base"
            aria-label={`${t('Change day')}: ${sessionName(s.type)}`} onClick={onMove}>{t('Change day')}</Button>
        )}
        <Button size="lg" variant="ghost" className="h-12 rounded-xl text-base" onClick={onClose}>{t('Close')}</Button>
      </DrawerFooter>
    </>
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
