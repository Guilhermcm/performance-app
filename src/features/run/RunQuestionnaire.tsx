// The running plan questionnaire (spec §3): goal, goal type, deadline, where the person is today
// and the running days, in a Drawer with back and continue. Races take all five steps; `start`
// and `maintain` skip the goal type and the deadline. Every check runs on the answers as the plan
// counts them (calendarAnswers), so what the questionnaire accepts is what applyRunPlan builds.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { DAYN, todayISO, weekOrder, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { formatClock, parseClock } from './clock'
import { addDays, utc } from './dates'
import { FAMILIES, buildBridge, buildPlan, checkAnswers, isRace, weekMinutes, type CheckResult } from './models'
import { applyRunPlan, calendarAnswers, raceStartOf, type RunState } from './run-actions'
import { dayText, goalName, sessionName, weeksText } from './labels'
import { formatPace, predictMinutes, vdotFrom } from './vdot'
import type { Answers, GoalType, Reference, RunGoal } from './types'

// `onCreated` runs after a plan is applied (the hosts then offer to update the weekly days goal).
type Props = { open: boolean; onOpenChange: (open: boolean) => void; initial?: Answers; onCreated?: () => void }

const GOALS: RunGoal[] = ['start', '5k', '10k', 'half', 'maintain']

// Spec §3: a race date from today + 4 weeks to today + 52 weeks, or a number of weeks in the same
// range; a race reference of 1 to 42.195 km in 3 min to 6 h; 1 to 180 continuous minutes.
const DATE_MIN_DAYS = 28
const DATE_MAX_DAYS = 364
const WEEKS_MIN = 4
const WEEKS_MAX = 52
const KM_MIN = 1
const KM_MAX = 42.195
const TIME_MIN = 3
const TIME_MAX = 360
const RUN_MIN = 1
const RUN_MAX = 180
// A reference slower than 20 min/km gives a VDOT below the useful range; one faster than 2:30/km
// is beyond world records, so almost surely a typo (m:ss typed for h:mm).
const PACE_SLOWEST = 20
const PACE_FASTEST = 2.5
// From 40 continuous minutes, the start plan would be its last week only.
const START_ENOUGH = 40

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s))

// Distances read with a decimal comma or point and are shown in the app language's way.
const formatKm = (km: number) => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 4, useGrouping: false }).format(km)
const parseDecimal = (s: string) => {
  const x = s.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(x) ? Number(x) : null
}
const parseWhole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null)

const weekdayShort = (d: number) => new Date(Date.UTC(2026, 0, 4 + d)).toLocaleDateString(dateLocale(), { weekday: 'short', timeZone: 'UTC' })

// What is being typed; the answers come out of it once every field reads.
type Draft = {
  goal: RunGoal | null
  goalType: GoalType
  target: string
  deadline: 'date' | 'weeks'
  raceDate: string
  weeks: string
  ref: Reference['kind'] | null
  distance: string
  time: string
  refDate: string
  minutes: string
  days: number
  longDay: number
  // The person took the shorter plan to finish a race whose deadline is under the minimum.
  shortOk: boolean
  // Run a maintain cycle until a race plan that starts later begins (spec §5.3); on by default.
  bridge: boolean
}

function draftOf(a?: Answers): Draft {
  const r = a?.reference
  return {
    goal: a?.goal ?? null,
    goalType: a?.goalType === 'time' && r?.kind === 'race' ? 'time' : 'finish',
    target: a?.goalType === 'time' && a.targetMinutes ? formatClock(a.targetMinutes) : '',
    deadline: a?.weeks != null && !a.raceDate ? 'weeks' : 'date',
    raceDate: a?.raceDate ?? '',
    weeks: a?.weeks != null ? String(a.weeks) : '',
    ref: r?.kind ?? null,
    distance: r?.kind === 'race' ? formatKm(r.distanceM / 1000) : '',
    time: r?.kind === 'race' ? formatClock(r.minutes) : '',
    refDate: r?.kind === 'race' ? r.date : '',
    minutes: r?.kind === 'continuous' ? String(r.minutes) : '',
    days: a?.days ?? 3,
    longDay: a?.longDay ?? 0,
    shortOk: false,
    bridge: a?.bridge ?? true
  }
}

// A time goal needs a race reference; the days stay within what the goal allows.
function normalize(d: Draft): Draft {
  let n = d
  if (n.ref !== 'race' && n.goalType === 'time') n = { ...n, goalType: 'finish' }
  if (n.goal && !FAMILIES[n.goal].days.includes(n.days)) n = { ...n, days: 3 }
  return n
}

type Read = {
  target: number | null
  targetError?: string
  deadline: { raceDate: string } | { weeks: number } | null
  deadlineError?: string
  reference: Reference | null
  refErrors: { distance?: string; time?: string; date?: string; pace?: string; minutes?: string }
}

function read(d: Draft, today: string): Read {
  const out: Read = { target: null, deadline: null, reference: null, refErrors: {} }

  const target = parseClock(d.target)
  if (target != null && target >= TIME_MIN && target <= TIME_MAX) out.target = target
  else if (d.target.trim()) out.targetError = t('Enter a time from 3 min to 6 h, as h:mm:ss.')

  if (d.deadline === 'date') {
    if (isIso(d.raceDate)) {
      if (d.raceDate < addDays(today, DATE_MIN_DAYS)) out.deadlineError = t('Pick a date at least 4 weeks from today.')
      else if (d.raceDate > addDays(today, DATE_MAX_DAYS)) out.deadlineError = t('Pick a date up to 52 weeks from today.')
      else out.deadline = { raceDate: d.raceDate }
    }
  } else {
    const w = parseWhole(d.weeks)
    if (w != null && w >= WEEKS_MIN && w <= WEEKS_MAX) out.deadline = { weeks: w }
    else if (d.weeks.trim()) out.deadlineError = t('Enter between 4 and 52 weeks.')
  }

  if (d.ref === 'race') {
    const e = out.refErrors
    const km = parseDecimal(d.distance)
    const min = parseClock(d.time)
    const kmOk = km != null && km >= KM_MIN && km <= KM_MAX
    const minOk = min != null && min >= TIME_MIN && min <= TIME_MAX
    if (!kmOk && d.distance.trim()) e.distance = t('Enter a distance from 1 to {0} km.', formatKm(KM_MAX))
    if (!minOk && d.time.trim()) e.time = t('Enter a time from 3 min to 6 h, as h:mm:ss.')
    if (kmOk && minOk) {
      const pace = min / km
      if (pace > PACE_SLOWEST || pace < PACE_FASTEST) e.pace = t('That is {0} per km. Check the distance and the time.', formatPace(pace * 60))
    }
    if (isIso(d.refDate) && d.refDate > today) e.date = t('The date cannot be in the future.')
    if (kmOk && minOk && isIso(d.refDate) && !e.pace && !e.date) {
      out.reference = { kind: 'race', distanceM: Math.round(km * 10000) / 10, minutes: min, date: d.refDate }
    }
  } else if (d.ref === 'continuous') {
    const n = parseWhole(d.minutes)
    if (n != null && n >= RUN_MIN && n <= RUN_MAX) out.reference = { kind: 'continuous', minutes: n }
    else if (d.minutes.trim()) out.refErrors.minutes = t('Enter from 1 to 180 minutes.')
  } else if (d.ref === 'none') {
    out.reference = { kind: 'none' }
  }
  return out
}

const goalTypeOf = (d: Draft): GoalType => (d.ref === 'race' ? d.goalType : 'finish')

// The answers without the reference: enough for the deadline check.
function partialOf(d: Draft, r: Read): Answers | null {
  if (!d.goal) return null
  const a: Answers = { goal: d.goal, reference: { kind: 'none' }, days: d.days as Answers['days'], longDay: d.longDay }
  if (!isRace(d.goal)) return a
  if (!r.deadline) return null
  return { ...a, goalType: 'finish', ...r.deadline }
}

function answersOf(d: Draft, r: Read): Answers | null {
  const base = partialOf(d, r)
  if (!base || !r.reference) return null
  const a: Answers = { ...base, reference: r.reference }
  if (!isRace(d.goal)) return a
  if (goalTypeOf(d) === 'time') {
    if (r.target == null) return null
    return { ...a, goalType: 'time', targetMinutes: r.target }
  }
  return a
}

type StepId = 'goal' | 'type' | 'deadline' | 'reference' | 'days'
// Before a goal is picked, all five steps are ahead.
const stepsFor = (goal: RunGoal | null): StepId[] =>
  goal === 'start' || goal === 'maintain' ? ['goal', 'reference', 'days'] : ['goal', 'type', 'deadline', 'reference', 'days']

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'
const OPTION = cn('h-12 w-full justify-start rounded-xl px-4 text-[15px] transition-colors duration-150 motion-reduce:transition-none', ON)
const SEGMENT = cn('h-12 min-w-11 flex-1 px-0 font-mono text-base tabular-nums transition-colors duration-150 motion-reduce:transition-none', ON)
const INPUT = 'h-12 rounded-xl bg-card px-4 text-base md:text-base dark:bg-card'
const NOTE = 'rounded-2xl bg-secondary/70 p-3 text-sm leading-snug'
const EASE_OUT = [0.22, 1, 0.36, 1] as const

export default function RunQuestionnaire({ open, onOpenChange, initial, onCreated }: Props) {
  // A fresh form each time the drawer opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <Body key={session} initial={initial} onDone={() => onOpenChange(false)} onCreated={onCreated} />
      </DrawerContent>
    </Drawer>
  )
}

function Body({ initial, onDone, onCreated }: { initial?: Answers; onDone: () => void; onCreated?: () => void }) {
  const reduce = useReducedMotion()
  const ws = useStore((s: { S: RunState }) => weekStartOf(s.S))
  const [today] = useState(todayISO)
  const [d, setD] = useState(() => draftOf(initial))
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [confirming, setConfirming] = useState(false)
  // Replacing a plan always asks first, an unreadable one included (spec §3).
  const hasPlan = useStore((s: { S: RunState }) => !!s.S.runPlan)
  const replacing = !!initial || hasPlan
  const cancelReplace = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (confirming) cancelReplace.current?.focus() }, [confirming])
  const id = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  useEffect(() => {
    if (moved.current) title.current?.focus({ preventScroll: true })
    moved.current = true
  }, [step])

  const set = (patch: Partial<Draft>) => setD(cur => {
    const next = { ...cur, ...patch }
    // A new goal or deadline asks again about a shorter plan.
    if (!('shortOk' in patch) && ('goal' in patch || 'deadline' in patch || 'raceDate' in patch || 'weeks' in patch)) next.shortOk = false
    // "I don't run yet" belongs to start running only.
    if ('goal' in patch && patch.goal !== cur.goal && patch.goal !== 'start' && cur.ref === 'none') next.ref = null
    return normalize(next)
  })

  const steps = stepsFor(d.goal)
  const at = steps[Math.min(step, steps.length - 1)]
  const r = read(d, today)
  const counted = (a: Answers) => calendarAnswers(a, today, ws)
  const check = (a: Answers | null): CheckResult | null => (a ? checkAnswers(counted(a), today) : null)
  // The shorter finish plan, once taken, settles a deadline under the minimum.
  const settled = (c: CheckResult | null) =>
    !!c && (c.ok || (c.reason === 'too_short' && c.finishWeeks != null && d.shortOk && goalTypeOf(d) === 'finish'))

  const partial = partialOf(d, r)
  const answers = answersOf(d, r)
  const deadlineCheck = isRace(d.goal) ? check(partial) : null
  const fullCheck = check(answers)

  const issue: CheckResult | null =
    at === 'deadline' ? (deadlineCheck && !settled(deadlineCheck) ? deadlineCheck : null)
      : at === 'reference' || at === 'days' ? (fullCheck && !settled(fullCheck) ? fullCheck : null)
        : null

  const complete =
    at === 'goal' ? !!d.goal
      : at === 'type' ? goalTypeOf(d) === 'finish' || r.target != null
        : at === 'deadline' ? !!r.deadline
          : at === 'reference' ? !!r.reference
            : !!answers && settled(fullCheck)
  const canGo = complete && !issue
  const last = at === 'days'

  const go = (to: number) => {
    setDir(to > step ? 1 : -1)
    setStep(to)
    setConfirming(false)
  }

  // A race plan that starts later: when, and whether the weeks until then run a maintain cycle.
  const wait = last && answers && isRace(answers.goal) && settled(fullCheck) ? raceStartOf(answers, today, ws) : null
  const waiting = !!wait && wait.waitWeeks > 0

  const create = () => {
    if (!answers || !canGo) return
    if (replacing && !confirming) { setConfirming(true); return }
    const final: Answers = waiting ? { ...answers, bridge: d.bridge } : answers
    useStore.getState().update((S: RunState) => { applyRunPlan(S, final, today) })
    onDone()
    onCreated?.()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canGo) return
    if (last) create(); else go(step + 1)
  }

  // ---- issues and their ways out ----

  const tooShort = (c: Extract<CheckResult, { ok: false }>) => {
    const min = c.minWeeks!
    let label: string
    let use: () => void
    if (d.deadline === 'date' && partial) {
      const date = addDays(d.raceDate, 7 * (min - (counted(partial).weeks ?? min)))
      label = dayText(date, today)
      use = () => set({ raceDate: date })
    } else {
      label = weeksText(min)
      use = () => set({ weeks: String(min) })
    }
    return (
      <>
        <p className="text-[15px] font-semibold leading-snug">{tn(min, 'This plan needs at least {0} weeks.', min)}</p>
        <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={use}>{t('Use the minimum: {0}', label)}</Button>
        {c.finishWeeks != null && (
          <Button type="button" variant="outline" className="h-auto min-h-12 rounded-xl whitespace-normal"
            onClick={() => set({ goalType: 'finish', shortOk: true })}>
            {t('Just finish the race, with a shorter plan')}
          </Button>
        )}
      </>
    )
  }

  const outOfReach = (c: Extract<CheckResult, { ok: false }>) => {
    const ref = r.reference
    const distanceM = d.goal ? FAMILIES[d.goal].distanceM : undefined
    if (!answers || ref?.kind !== 'race' || !distanceM || c.possibleMinutes == null) return null
    // The possible time to the second, nudged a second slower while rounding still leaves it out.
    let sec = Math.round(c.possibleMinutes * 60)
    for (let i = 0; i < 60; i++) {
      const again = check({ ...answers, targetMinutes: sec / 60 })
      if (!again || again.ok || again.reason !== 'time_out_of_reach') break
      sec++
    }
    const possible = formatClock(sec / 60)
    return (
      <>
        <p className="text-[15px] font-semibold leading-snug">
          {t('Your pace today gives about {0}.', formatClock(predictMinutes(vdotFrom(ref.distanceM, ref.minutes), distanceM)))}
        </p>
        <p className="text-sm leading-snug text-muted-foreground">{t('By race day, about {0} is within reach.', possible)}</p>
        <Button type="button" variant="outline" className="h-12 rounded-xl font-mono tabular-nums" onClick={() => set({ target: possible })}>
          {t('Use {0}', possible)}
        </Button>
      </>
    )
  }

  const tooOld = () => (
    <>
      <p className="text-[15px] font-semibold leading-snug">{t('This time is more than 3 months old, so it no longer says much about your pace.')}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className="h-auto min-h-12 rounded-xl whitespace-normal"
          onClick={() => { set({ distance: '', time: '', refDate: '' }); document.getElementById(id + '-km')?.focus() }}>
          {t('Enter another')}
        </Button>
        <Button type="button" variant="outline" className="h-auto min-h-12 rounded-xl whitespace-normal" onClick={() => set({ ref: 'none' })}>
          {t('Go on without pace')}
        </Button>
      </div>
    </>
  )

  const issueBody = !issue || issue.ok ? null
    : issue.reason === 'too_short' ? tooShort(issue)
      : issue.reason === 'time_out_of_reach' ? outOfReach(issue)
        : issue.reason === 'reference_too_old' ? tooOld()
          : null
  const issueBox = issueBody && (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">{issueBody}</div>
  )

  // ---- steps ----

  const field = (key: string, label: string, error: string | undefined, input: ReactNode) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id + key} className="text-sm font-medium text-muted-foreground">{label}</Label>
      {input}
      {error && <p id={id + key + '-error'} className="text-sm leading-snug text-destructive">{error}</p>}
    </div>
  )
  const invalid = (key: string, error?: string) => (error ? { 'aria-invalid': true, 'aria-describedby': id + key + '-error' } : {})

  const choices = (labelId: string, value: string, onValue: (v: string) => void, items: { value: string; label: string }[]) => (
    <ToggleGroup type="single" variant="outline" spacing={2} aria-labelledby={labelId} className="flex w-full flex-col items-stretch"
      value={value} onValueChange={v => v && onValue(v)}>
      {items.map(it => <ToggleGroupItem key={it.value} value={it.value} className={OPTION}>{it.label}</ToggleGroupItem>)}
    </ToggleGroup>
  )

  const shortTaken = at === 'deadline' && deadlineCheck && !deadlineCheck.ok && settled(deadlineCheck)

  const views: Record<StepId, { title: string; lead: string; body: ReactNode }> = {
    goal: {
      title: t('What is your goal?'),
      lead: t('You can redo these questions later.'),
      body: choices(id + '-title', d.goal ?? '', v => set({ goal: v as RunGoal }), GOALS.map(g => ({ value: g, label: goalName(g) })))
    },
    type: {
      title: t('Finish it or beat a time?'),
      lead: t('Finishing is a goal too.'),
      body: (
        <div className="flex flex-col gap-5">
          {choices(id + '-title', goalTypeOf(d), v => set({ goalType: v as GoalType }), [
            { value: 'finish', label: t('Finish the race') },
            ...(d.ref === 'race' ? [{ value: 'time', label: t('Beat a time') }] : [])
          ])}
          {d.ref !== 'race' && (
            <p className={NOTE}>
              {t('Beating a time opens up after a run with distance and time. If you did one in the last 3 months, enter it under “How is your running today?” and come back to this step.')}
            </p>
          )}
          {goalTypeOf(d) === 'time' && field('-target', t('Target time'), r.targetError, (
            <Input id={id + '-target'} value={d.target} placeholder="h:mm:ss" autoComplete="off" enterKeyHint="next"
              className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-target', r.targetError)}
              onChange={e => set({ target: e.target.value })} />
          ))}
        </div>
      )
    },
    deadline: {
      title: t('When is the race?'),
      lead: t('Choose the race date or how many weeks you have.'),
      body: (
        <div className="flex flex-col gap-5">
          <ToggleGroup type="single" variant="outline" aria-labelledby={id + '-title'} className="w-full"
            value={d.deadline} onValueChange={v => v && set({ deadline: v as Draft['deadline'] })}>
            <ToggleGroupItem value="date" className={cn('h-12 flex-1 text-[15px]', ON)}>{t('Race date')}</ToggleGroupItem>
            <ToggleGroupItem value="weeks" className={cn('h-12 flex-1 text-[15px]', ON)}>{t('Number of weeks')}</ToggleGroupItem>
          </ToggleGroup>
          {d.deadline === 'date'
            ? field('-race', t('Race date'), r.deadlineError, (
              <Input id={id + '-race'} type="date" value={d.raceDate} min={addDays(today, DATE_MIN_DAYS)} max={addDays(today, DATE_MAX_DAYS)}
                className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-race', r.deadlineError)}
                onChange={e => set({ raceDate: e.target.value })} />
            ))
            : field('-weeks', t('Number of weeks'), r.deadlineError, (
              <Input id={id + '-weeks'} inputMode="numeric" value={d.weeks} autoComplete="off" enterKeyHint="next" maxLength={2}
                className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-weeks', r.deadlineError)}
                onChange={e => set({ weeks: e.target.value.replace(/\D/g, '') })} />
            ))}
          {shortTaken && <p role="status" className={NOTE}>{t('Shorter plan, to finish the race.')}</p>}
        </div>
      )
    },
    reference: {
      title: t('How is your running today?'),
      lead: t('This sets where the plan starts and, with a recent time, your paces.'),
      body: (
        <div className="flex flex-col gap-5">
          {choices(id + '-title', d.ref ?? '', v => set({ ref: v as Reference['kind'] }), [
            { value: 'race', label: t('I have a recent time') },
            { value: 'continuous', label: t('I run without stopping') },
            ...(d.goal === 'start' ? [{ value: 'none', label: t("I don't run yet") }] : [])
          ])}
          {d.ref === 'race' && (
            <div className="flex flex-col gap-4">
              {field('-km', t('Distance (km)'), r.refErrors.distance, (
                <Input id={id + '-km'} inputMode="decimal" value={d.distance} autoComplete="off" enterKeyHint="next" maxLength={8}
                  className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-km', r.refErrors.distance)}
                  onChange={e => set({ distance: e.target.value.replace(/[^\d.,]/g, '') })} />
              ))}
              {field('-time', t('Time'), r.refErrors.time, (
                <Input id={id + '-time'} value={d.time} placeholder="h:mm:ss" autoComplete="off" enterKeyHint="next" maxLength={9}
                  className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-time', r.refErrors.time)}
                  onChange={e => set({ time: e.target.value })} />
              ))}
              {field('-date', t('Date'), r.refErrors.date, (
                <Input id={id + '-date'} type="date" value={d.refDate} max={today}
                  className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-date', r.refErrors.date)}
                  onChange={e => set({ refDate: e.target.value })} />
              ))}
              {r.refErrors.pace && <p role="alert" className="text-sm leading-snug text-destructive">{r.refErrors.pace}</p>}
            </div>
          )}
          {d.ref === 'continuous' && field('-run', t('How many minutes?'), r.refErrors.minutes, (
            <Input id={id + '-run'} inputMode="numeric" value={d.minutes} autoComplete="off" enterKeyHint="next" maxLength={3}
              className={cn(INPUT, 'font-mono tabular-nums')} {...invalid('-run', r.refErrors.minutes)}
              onChange={e => set({ minutes: e.target.value.replace(/\D/g, '') })} />
          ))}
          {d.ref === 'none' && d.goal !== 'start' && <p role="status" className={NOTE}>{t('No pace: the plan goes by feel.')}</p>}
          {d.goal === 'start' && r.reference?.kind === 'continuous' && r.reference.minutes >= START_ENOUGH && (
            <p role="status" className={NOTE}>
              {t('You already run {0} minutes without stopping, so this plan would last a single week. {1} or {2} may suit you better.',
                r.reference.minutes, goalName('5k'), goalName('maintain'))}
            </p>
          )}
        </div>
      )
    },
    days: {
      title: t('When do you run?'),
      lead: t('The app fits your runs around your strength training.'),
      body: (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span id={id + '-days'} className="text-sm font-medium text-muted-foreground">{t('Runs per week')}</span>
            <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby={id + '-days'}
              value={String(d.days)} onValueChange={v => v && set({ days: Number(v) })}>
              {(d.goal ? FAMILIES[d.goal].days : []).map(n => (
                <ToggleGroupItem key={n} value={String(n)} className={SEGMENT}>{n}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {d.goal !== 'start' && (
            <div className="flex flex-col gap-2">
              <span id={id + '-long'} className="text-sm font-medium text-muted-foreground">{t('Long run day')}</span>
              <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby={id + '-long'}
                value={String(d.longDay)} onValueChange={v => v && set({ longDay: Number(v) })}>
                {weekOrder(ws).map((day: number) => (
                  <ToggleGroupItem key={day} value={String(day)} aria-label={t(DAYN[day])}
                    className={cn(SEGMENT, 'font-sans text-sm')}>{weekdayShort(day)}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
          {waiting && wait && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[15px] font-semibold">{t('Race plan starts on {0}', dayText(wait.raceStart, today))}</p>
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={id + '-bridge'} className="flex flex-col items-start gap-1 text-[15px] font-normal">
                  <span>{t('Until then, run to stay in shape')}</span>
                  <span className="text-sm text-muted-foreground">{t('Keeps you running until the race plan starts.')}</span>
                </Label>
                <Switch id={id + '-bridge'} checked={d.bridge} onCheckedChange={v => set({ bridge: v })} />
              </div>
            </div>
          )}
          {!issue && answers && settled(fullCheck) && (
            <Preview answers={counted(answers)} today={today} bridge={waiting && d.bridge && wait ? { from: answers, weeks: wait.waitWeeks } : null} />
          )}
        </div>
      )
    }
  }
  const view = views[at]
  const index = steps.indexOf(at)

  return (
    <>
      <DrawerHeader className="gap-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <div className="-ml-2 flex items-center gap-3">
          <Button type="button" variant="ghost" size="icon" aria-label={t('Back')}
            className={index === 0 ? 'invisible size-11 rounded-full' : 'size-11 rounded-full'}
            disabled={index === 0} onClick={() => go(index - 1)}>
            <ArrowLeft className="size-5 rtl:rotate-180" />
          </Button>
          <Progress value={((index + 1) / steps.length) * 100} aria-label={t('Step {0} of {1}', index + 1, steps.length)}
            className="h-1.5 flex-1 bg-muted [&>[data-slot=progress-indicator]]:duration-300 [&>[data-slot=progress-indicator]]:ease-out motion-reduce:[&>[data-slot=progress-indicator]]:transition-none" />
          <span aria-hidden className="w-11 pr-2 text-right font-mono text-sm tabular-nums text-muted-foreground">{index + 1}/{steps.length}</span>
        </div>
        <DrawerTitle id={id + '-title'} ref={title} tabIndex={-1} className="text-xl outline-none text-balance">{view.title}</DrawerTitle>
        <DrawerDescription className="text-pretty">{view.lead}</DrawerDescription>
      </DrawerHeader>

      <form id={id + '-form'} noValidate onSubmit={submit} className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
        <motion.div key={at} className="flex flex-col gap-5"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.22, ease: EASE_OUT }}>
          {view.body}
          {issueBox}
        </motion.div>
      </form>

      <DrawerFooter className="flex-col gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {confirming ? (
          <div role="alertdialog" aria-labelledby={id + '-replace-q'} aria-describedby={id + '-replace-hint'} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p id={id + '-replace-q'} className="text-[15px] font-semibold leading-snug">{t('Replace your current running plan?')}</p>
              <p id={id + '-replace-hint'} className="text-sm leading-snug text-muted-foreground">
                {t('The new plan replaces your current one and the days you moved.')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button ref={cancelReplace} type="button" variant="outline" className="h-12 rounded-xl" onClick={() => setConfirming(false)}>{t('Cancel')}</Button>
              <Button type="button" className="h-12 rounded-xl font-semibold" onClick={create}>{t('Replace')}</Button>
            </div>
          </div>
        ) : (
          <Button type="submit" form={id + '-form'} className="h-12 rounded-xl text-[15px] font-semibold" disabled={!canGo}>
            {!last ? t('Continue') : replacing ? t('Redo plan') : t('Create plan')}
          </Button>
        )}
      </DrawerFooter>
    </>
  )
}

// What the answers build: the plan length and the first week's runs. `answers` are as counted.
// With `bridge`, the maintain weeks before the race plan come first (applyRunPlan's order).
type BridgePreview = { from: Answers; weeks: number } | null
function Preview({ answers, today, bridge }: { answers: Answers; today: string; bridge: BridgePreview }) {
  const labelId = useId()
  const ref = answers.reference
  const built = buildPlan(answers, today, ref.kind === 'race' ? vdotFrom(ref.distanceM, ref.minutes) : null)
  const weeks = bridge ? [...buildBridge(bridge.from, bridge.weeks, built.vdot), ...built.weeks] : built.weeks
  const first = weeks[0]
  if (!first) return null
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p id={labelId} className="text-xl font-semibold tabular-nums">{weeksText(weeks.length)}</p>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-muted-foreground">{t('First week')}</p>
        <ul className="flex list-none flex-col gap-1">
          {first.sessions.map(s => (
            <li key={s.id} className="flex items-baseline justify-between gap-3 text-[15px]">
              <span>{sessionName(s.type)}</span>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">{t('{0} min', weekMinutes({ sessions: [s] }))}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
