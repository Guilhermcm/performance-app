// The running plan in the app state (spec §6.1, plan Decisions 2, 3 and 9): applying, moving,
// refitting and ending it, and reading which week and which sessions a date falls on. The
// mutations take the store's draft `S` and are meant for `update(S => ...)`; they never touch the
// strength week or the routines.
//
// Dates are ISO days (YYYY-MM-DD) and weekdays follow S.week: 0 = Sunday to 6 = Saturday. A plan
// week is a calendar week that begins on the person's week start when the plan was made
// (RunPlan.weekStart, 0 or 1; S.weekStart for plans saved before it); week 1 is the week holding
// `startDate`. A race plan that starts later may open with maintain weeks (buildBridge).
import { weekOrder, weekStartOf } from '../../lib/format.js'
import { addDays, weekdayOf, weekStartDate, weeksBetween } from './dates'
import { fitWeek } from './fit'
import { buildBridge, buildPlan, isRace, type PlanWeek } from './models'
import type { Answers, RunPlan, Session, Week } from './types'
import { vdotFrom } from './vdot'

type Routine = { id: string; ex?: { id: string; sets?: number }[] }
/** The part of the app state the running plan reads and writes. */
export type RunState = {
  week: Record<number, string[] | string>
  routines: Routine[]
  weekStart?: number
  runPlan?: RunPlan | null
}

/**
 * The strength week with every day as a list. Old states may hold a bare routine id on a day,
 * which the fit would read letter by letter; callers of moveWarnings should pass this too.
 */
export function strengthWeek(S: Pick<RunState, 'week'>): Record<number, string[]> {
  const out: Record<number, string[]> = {}
  for (const [d, ids] of Object.entries(S.week || {})) {
    const list = ([] as string[]).concat(ids || []).filter(id => typeof id === 'string')
    if (list.length) out[Number(d)] = list
  }
  return out
}

/** Whether this build reads the plan: version 1 with weeks and a start date (spec §6.1, Decision 9). */
export const isReadable = (plan: RunPlan | null | undefined): plan is RunPlan =>
  !!plan && plan.version === 1 && Array.isArray(plan.weeks) && plan.weeks.length > 0 &&
  typeof plan.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(plan.startDate)

/** The week start the plan maps dates with: its own, or `fallback` (S.weekStart) for older plans. */
export const planWeekStart = (plan: RunPlan, fallback: number): 0 | 1 =>
  plan.weekStart === 0 || plan.weekStart === 1 ? plan.weekStart : fallback === 0 ? 0 : 1

function fitted(sessions: PlanWeek['sessions'], S: RunState, longDay: number, allowedDays?: number[]): Session[] {
  const { placement } = fitWeek(sessions, { week: strengthWeek(S), routines: S.routines || [], longDay, allowedDays })
  return sessions.map(s => ({ ...s, day: placement[s.id] }))
}

// Week 1 by Decision 2: the current week when the days left from today (today included) hold all
// of a week's sessions, the next week otherwise. Every plan week has `days` sessions.
function firstWeek(days: number, today: string, ws: number): { start: string; left: number[] | null } {
  const thisWeek = weekStartDate(today, ws)
  const left = weekOrder(ws).slice((weekdayOf(today) - ws + 7) % 7)
  return days <= left.length ? { start: thisWeek, left } : { start: addDays(thisWeek, 7), left: null }
}

/**
 * The answers as the plan counts them. A race date becomes the number of calendar weeks from
 * week 1 (Decision 2, on the person's week start) to the week holding the race, both included, so
 * the plan ends in the race week. Pass the result to checkAnswers and buildPlan; other answers come
 * back unchanged.
 */
export function calendarAnswers(answers: Answers, today: string, weekStart: number): Answers {
  if (!isRace(answers.goal) || !answers.raceDate) return answers
  const { start } = firstWeek(answers.days, today, weekStart)
  const { raceDate: _race, ...rest } = answers
  return { ...rest, weeks: weeksBetween(start, weekStartDate(answers.raceDate, weekStart)) + 1 }
}

// The first day of the race plan when the deadline is longer than the plan (the extra base is
// capped at 8 weeks, spec §5.3): it starts later so it still ends at the deadline. A race date puts
// the race in the last week; a number of weeks pushes the start by the weeks left over.
function delayedStart(a: Answers, natural: string, ws: number, weeks: number): string {
  if (!isRace(a.goal)) return natural
  if (a.raceDate) {
    const aligned = addDays(weekStartDate(a.raceDate, ws), -7 * (weeks - 1))
    return aligned > natural ? aligned : natural
  }
  if (a.weeks && a.weeks > weeks) return addDays(natural, 7 * (a.weeks - weeks))
  return natural
}

/**
 * When the race plan of these answers starts, and how many weeks lie between Decision 2's week 1
 * and it (0 when it starts at once). Those weeks stay empty, or run a maintain cycle with
 * `bridge` (spec §5.3). The questionnaire shows this before "Create plan".
 */
export function raceStartOf(answers: Answers, today: string, ws: number): { raceStart: string; waitWeeks: number } {
  const { weeks } = buildPlan(calendarAnswers(answers, today, ws), today, null)
  const first = firstWeek(answers.days, today, ws)
  const raceStart = delayedStart(answers, first.start, ws, weeks.length)
  return { raceStart, waitWeeks: weeksBetween(first.start, raceStart) }
}

// Race weeks after `offset` bridge weeks: indexes and ids (w{week}-s{position}) move along.
const shifted = (weeks: PlanWeek[], offset: number): PlanWeek[] => weeks.map(w => {
  const index = w.index + offset
  return { ...w, index, sessions: w.sessions.map(s => ({ ...s, id: s.id.replace(/^w\d+-/, `w${index}-`) })) }
})

/**
 * Builds the plan from the answers, fits every week around the strength week and stores it in
 * `S.runPlan`. Week 1 is the current week when the days left from today hold all its sessions,
 * and then those sessions only use today or later (Decision 2); otherwise it is the next week.
 * `startDate` is today in the first case and the first day of week 1 otherwise. A race plan that
 * starts later (a deadline longer than the plan) waits until then, or with `answers.bridge` opens
 * with maintain weeks from week 1 (spec §5.3). A race reference gives the plan its VDOT.
 * `S.week` and `S.routines` are left as they are.
 */
export function applyRunPlan(S: RunState, answers: Answers, today: string): RunPlan {
  const ws = weekStartOf(S)
  const ref = answers.reference
  const raw = ref.kind === 'race' ? vdotFrom(ref.distanceM, ref.minutes) : null
  // buildPlan says which VDOT the plan uses: null below its usable floor, then the plan is by
  // feel only, as with a continuous reference or none.
  const { weeks: race, vdot } = buildPlan(calendarAnswers(answers, today, ws), today, raw)

  const first = firstWeek(answers.days, today, ws)
  const raceStart = delayedStart(answers, first.start, ws, race.length)
  const wait = weeksBetween(first.start, raceStart)
  const bridged = wait > 0 && answers.bridge === true
  const built = bridged ? [...buildBridge(answers, wait, vdot), ...shifted(race, wait)] : race
  const start = bridged ? first.start : raceStart
  const left = start === first.start ? first.left : null

  const weeks: Week[] = built.map((w, i) => ({
    ...w,
    sessions: fitted(w.sessions, S, answers.longDay, i === 0 && left ? left : undefined),
  }))

  const plan: RunPlan = {
    version: 1,
    goal: answers.goal,
    goalType: answers.goalType ?? 'finish',
    startDate: left ? today : start,
    answers: JSON.parse(JSON.stringify(answers)),
    vdotSource: vdot != null ? 'race' : null,
    weekStart: ws,
    weeks,
    dismissed: {},
  }
  // A maintain plan repeats week 1 every cycle: the template keeps every day, and the first
  // calendar week alone keeps its today-onward days (Decision 2).
  if (answers.goal === 'maintain' && left && left.length < 7) {
    plan.openingDays = Object.fromEntries(weeks[0].sessions.map(s => [s.id, s.day]))
    weeks[0] = { ...weeks[0], sessions: fitted(built[0].sessions, S, answers.longDay) }
  }
  if (answers.goalType === 'time' && answers.targetMinutes != null) plan.targetTime = answers.targetMinutes
  if (answers.raceDate) plan.raceDate = answers.raceDate
  if (vdot != null && ref.kind === 'race') { plan.vdot = vdot; plan.vdotDate = ref.date }
  S.runPlan = plan
  return plan
}

// How many weeks `iso` lies after week 1 (negative before it), not wrapped.
const offsetOf = (plan: RunPlan, iso: string, ws: number) =>
  weeksBetween(weekStartDate(plan.startDate, ws), weekStartDate(iso, ws))

/**
 * Moves one session of week `weekIndex` (Week.index, from 1) to `day` (0 to 6). Only that week
 * changes. `iso`, a date of the week being changed, tells a maintain plan's first calendar week
 * (its opening days) from the later cycles of week 1.
 */
export function moveSession(S: RunState, weekIndex: number, sessionId: string, day: number, iso?: string): void {
  const plan = S.runPlan
  if (!isReadable(plan) || !Number.isInteger(day) || day < 0 || day > 6) return
  const session = plan.weeks.find(w => w.index === weekIndex)?.sessions.find(s => s.id === sessionId)
  if (!session) return
  const opening = plan.openingDays
  if (opening && sessionId in opening && iso && offsetOf(plan, iso, planWeekStart(plan, weekStartOf(S))) === 0) opening[sessionId] = day
  else session.day = day
}

/**
 * Refits the weeks after the current one with the strength week of now (Decision 3). The current
 * and past weeks keep their days, moved sessions included. A maintain plan past its first cycle
 * comes round again, so every week but the current one is refitted.
 */
export function refitFuture(S: RunState, today: string): void {
  const plan = S.runPlan
  if (!isReadable(plan)) return
  const offset = offsetOf(plan, today, planWeekStart(plan, weekStartOf(S)))
  const n = plan.weeks.length
  const cycled = plan.goal === 'maintain' && offset >= n
  plan.weeks.forEach((w, i) => {
    if (cycled ? i === offset % n : i <= offset) return
    w.sessions = fitted(w.sessions, S, plan.answers?.longDay ?? 0)
  })
}

/** Ends the plan. The strength week, the routines and the check-in history stay. */
export function endRunPlan(S: RunState): void {
  S.runPlan = null
}

/**
 * The plan week `today` falls in, or null: no plan, a version this build does not read (the UI
 * then offers to redo the questionnaire), before the start or after the last week. A maintain plan
 * starts its cycle again when it ends (Decision 8). Dates map with the plan's own week start;
 * `weekStart` (S.weekStart) is the fallback for plans saved without one.
 */
export function currentWeek(plan: RunPlan | null | undefined, today: string, weekStart: 0 | 1): Week | null {
  if (!isReadable(plan) || today < plan.startDate) return null
  const offset = offsetOf(plan, today, planWeekStart(plan, weekStart))
  if (plan.goal !== 'maintain') return plan.weeks[offset] ?? null
  const week = plan.weeks[offset % plan.weeks.length]
  const opening = plan.openingDays
  if (offset !== 0 || !opening) return week
  return { ...week, sessions: week.sessions.map(s => ({ ...s, day: opening[s.id] ?? s.day })) }
}

/** The sessions on the date `isoDay`: those of its plan week fitted to its weekday. */
export function sessionsOn(plan: RunPlan | null | undefined, isoDay: string, weekStart: 0 | 1): Session[] {
  const week = currentWeek(plan, isoDay, weekStart)
  if (!week || !Array.isArray(week.sessions)) return []
  const day = weekdayOf(isoDay)
  return week.sessions.filter(s => s.day === day)
}

/** The first day of the plan's week `i` (0-based). */
export function weekDate(plan: RunPlan, i: number, weekStart: 0 | 1): string {
  return addDays(weekStartDate(plan.startDate, planWeekStart(plan, weekStart)), 7 * i)
}

/** When the race weeks of a plan that opens with maintain weeks begin, or null without them. */
export function raceWeeksStart(plan: RunPlan, weekStart: 0 | 1): string | null {
  if (!isRace(plan.goal) || plan.weeks[0]?.phase !== 'maintain') return null
  const i = plan.weeks.findIndex(w => w.phase !== 'maintain')
  return i < 0 ? null : weekDate(plan, i, weekStart)
}
