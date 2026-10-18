// Running plan models (spec §5, plan Decisions 4 to 8): families, questionnaire checks and the plan
// builder. Pure functions. Sessions come out without `day`; fitting them into the week is fit.ts.
import type { Answers, Block, Item, Phase, RunGoal, Session, SessionType, Week } from './types'
import { predictMinutes, requiredVdot, vdotFrom } from './vdot'

export type { Answers }

export type PlanSession = Omit<Session, 'day'>
export type PlanWeek = Omit<Week, 'sessions'> & { sessions: PlanSession[] }

type Family = {
  days: number[]
  minWeeks: number
  // Shortest finish plan: the minimum without its base weeks (spec §5.3).
  finishWeeks: number
  taper: number
  distanceM?: number
  // Decision 4: first easy run with a race reference and the easy and long run caps.
  raceEasy: number
  easyCap: number
  longCap: number
}

const family = (days: number[], minWeeks: number, taper: number, raceEasy: number, easyCap: number, longCap: number, distanceM?: number): Family => {
  const { base } = split(minWeeks, taper)
  return { days, minWeeks, finishWeeks: minWeeks - base, taper, distanceM, raceEasy, easyCap, longCap }
}

// Decision 5: taper at the end; of the rest, 35% build, 35% specific, base takes the rounding.
function split(weeks: number, taper: number) {
  const rest = weeks - taper
  const build = Math.floor(rest * 0.35)
  const specific = Math.floor(rest * 0.35)
  return { base: rest - build - specific, build, specific, taper }
}

export const FAMILIES: Record<RunGoal, Family> = {
  start: family([2, 3], 8, 0, 30, 50, 60),
  '5k': family([2, 3, 4], 8, 1, 30, 50, 60, 5000),
  '10k': family([3, 4], 10, 2, 35, 55, 80, 10000),
  half: family([3, 4], 12, 2, 40, 60, 120, 21097.5),
  maintain: family([2, 3, 4], 8, 0, 30, 50, 60)
}

const MAX_EXTRA_BASE = 8
const DAY_MS = 86400000

const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const minutesOf = (items: Item[]) =>
  items.reduce((sum, it) => sum + ('repeat' in it ? it.repeat * it.blocks.reduce((s, b) => s + b.min, 0) : it.min), 0)

export function weekMinutes(w: { sessions: { blocks: Item[] }[] }): number {
  return w.sessions.reduce((sum, s) => sum + minutesOf(s.blocks), 0)
}

// ---- start (Decision 7) ----

const rw = (repeat: number, run: number, walk: number): Item => ({ repeat, blocks: [{ zone: 'easy', min: run }, { zone: 'walk', min: walk }] })
const easy = (min: number): Block => ({ zone: 'easy', min })

const START: { type: SessionType; blocks: Item[]; recovery?: boolean }[] = [
  { type: 'runwalk', blocks: [rw(8, 1, 2)] },
  { type: 'runwalk', blocks: [rw(6, 2, 2)] },
  { type: 'runwalk', blocks: [rw(5, 3, 2)] },
  // Week 4 is the recovery week: 4 × (3 / 2) instead of 4 × (5 / 2).
  { type: 'runwalk', blocks: [rw(4, 3, 2)], recovery: true },
  { type: 'runwalk', blocks: [rw(3, 8, 2)] },
  { type: 'runwalk', blocks: [rw(2, 12, 2)] },
  { type: 'runwalk', blocks: [easy(20), rw(2, 5, 1)] },
  { type: 'easy', blocks: [easy(30)] }
]

const longestRun = (items: Item[]) =>
  Math.max(...items.flatMap(it => ('repeat' in it ? it.blocks : [it])).filter(b => b.zone === 'easy').map(b => b.min))

// From 20 continuous minutes, start at the first week whose longest continuous run is at least 60%
// of them (spec §5.1); past the table, the last week.
function startSkip(a: Answers): number {
  if (a.reference.kind !== 'continuous' || a.reference.minutes < 20) return 0
  const need = a.reference.minutes * 0.6
  const i = START.findIndex(w => longestRun(w.blocks) >= need)
  return i < 0 ? START.length - 1 : i
}

// 80% of a workout's minutes: long repeats lose repetitions, the rest loses minutes per block.
const scaleBlock = (b: Block): Block => ({ zone: b.zone, min: Math.max(1, Math.round(b.min * 0.8)) })
const eighty = (items: Item[]): Item[] =>
  items.map(it => ('repeat' in it
    ? it.repeat >= 5 ? { repeat: Math.round(it.repeat * 0.8), blocks: it.blocks } : { repeat: it.repeat, blocks: it.blocks.map(scaleBlock) }
    : scaleBlock(it)))

function buildStart(a: Answers): PlanWeek[] {
  const phases = phaseList(split(START.length, 0))
  const skip = startSkip(a)
  return START.slice(skip).map((tpl, i) => {
    const index = i + 1
    const blocks = [tpl.blocks, tpl.blocks, eighty(tpl.blocks)].slice(0, a.days)
    return {
      index,
      phase: phases[skip + i],
      recovery: !!tpl.recovery,
      sessions: blocks.map((b, k) => ({ id: `w${index}-s${k + 1}`, type: tpl.type, blocks: b }))
    }
  })
}

// ---- races and maintain (Decisions 4 to 6 and 8) ----

const phaseList = (p: ReturnType<typeof split>): Phase[] => [
  ...Array<Phase>(p.base).fill('base'),
  ...Array<Phase>(p.build).fill('build'),
  ...Array<Phase>(p.specific).fill('specific'),
  ...Array<Phase>(p.taper).fill('taper')
]

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

function firstEasy(a: Answers, f: Family): number {
  if (a.reference.kind === 'continuous') return clamp(Math.round(a.reference.minutes * 0.8), 20, 40)
  if (a.reference.kind === 'race') return f.raceEasy
  // `none` is meant for `start` only (Decision 4); other goals get the lowest start.
  return 20
}

const lerp = (from: number, to: number, p: number) => Math.round(from + (to - from) * p)

// Ritmo and Intervalado: 10 easy before, the quality blocks, 5 to 10 easy after.
function quality(type: 'tempo' | 'intervals', reps: number, min: number, between: number, cool: number): Item[] {
  const zone = type === 'tempo' ? 'moderate' : 'hard'
  const main: Item = reps > 1 ? { repeat: reps, blocks: [{ zone, min }, easy(between)] } : { zone, min }
  return [easy(10), main, easy(cool)]
}

const LIGHT_TEMPO = () => quality('tempo', 2, 8, 2, 5)

// The family workout of the specific phase at position p (0 to 1).
function specificWorkout(goal: RunGoal, p: number, cool: number): { type: 'tempo' | 'intervals'; blocks: Item[] } {
  if (goal === '5k') return { type: 'intervals', blocks: quality('intervals', 5, lerp(3, 4, p), 3, cool) }
  const [reps, min, finalMin] = goal === '10k' ? [2, 12, 20] : [2, 15, 30]
  return { type: 'tempo', blocks: p >= 1 ? quality('tempo', 1, finalMin, 0, cool) : quality('tempo', reps, min, 2, cool) }
}

const FLOOR = 10
const isFlex = (s: PlanSession) => s.type === 'easy' || s.type === 'long'

// Brings the week down to `target` minutes by shortening the easy and long runs (never below
// FLOOR); never raises it.
function trimTo(sessions: PlanSession[], target: number): void {
  const flex = sessions.filter(isFlex)
  const flexMin = flex.reduce((s, x) => s + minutesOf(x.blocks), 0)
  const total = weekMinutes({ sessions })
  if (total <= target || flexMin === 0) return
  const scale = Math.max(0, target - (total - flexMin)) / flexMin
  for (const s of flex) s.blocks = [easy(Math.max(FLOOR, Math.round(minutesOf(s.blocks) * scale)))]
  let over = weekMinutes({ sessions }) - target
  while (over > 0) {
    const s = flex.reduce((m, x) => (minutesOf(x.blocks) > minutesOf(m.blocks) ? x : m))
    const cut = Math.min(over, minutesOf(s.blocks) - FLOOR)
    if (cut <= 0) break
    s.blocks = [easy(minutesOf(s.blocks) - cut)]
    over -= cut
  }
}

// maintain has no race: two easy weeks, then tempo from week 3 (Decision 8).
function phasesOf(a: Answers, total: number): Phase[] {
  const f = FAMILIES[a.goal]
  if (a.goal === 'maintain') return phaseList({ base: 2, build: 6, specific: 0, taper: 0 })
  const p = split(f.minWeeks, f.taper)
  return phaseList({ ...p, base: total - p.build - p.specific - p.taper })
}

function buildRace(a: Answers, total: number): PlanWeek[] {
  const f = FAMILIES[a.goal]
  const phases = phasesOf(a, total)
  const maintain = a.goal === 'maintain'
  let e = firstEasy(a, f)
  let l = Math.min(f.longCap, Math.round(e * 1.3))
  const weeks: PlanWeek[] = []
  // Minutes of the last week that is neither recovery nor taper: the 110% reference and the peak.
  let top: number | null = null

  phases.forEach((phase, i) => {
    const index = i + 1
    const recovery = phase !== 'taper' && index % 4 === 0
    if (i > 0 && !recovery && phase !== 'taper' && !maintain) {
      e = Math.min(f.easyCap, Math.round(e * 1.08))
      l = Math.min(f.longCap, Math.round(l * 1.08))
    }
    const start = phases.indexOf(phase)
    const len = phases.lastIndexOf(phase) - start + 1
    const p = len > 1 ? (i - start) / (len - 1) : 0
    const cool = lerp(5, 10, p)

    let q: { type: 'tempo' | 'intervals'; blocks: Item[] } | null = null
    if (maintain) {
      if (index >= 3 && a.days >= 3) q = { type: 'tempo', blocks: quality('tempo', 2, 10, 2, 5) }
    } else if (phase === 'build') {
      q = (i - start) % 2 === 0
        ? { type: 'tempo', blocks: quality('tempo', lerp(2, 3, p), lerp(8, 10, p), 2, cool) }
        : { type: 'intervals', blocks: quality('intervals', lerp(5, 6, p), lerp(2, 3, p), 2, cool) }
    } else if (phase === 'specific') {
      q = specificWorkout(a.goal, p, cool)
    } else if (phase === 'taper') {
      q = specificWorkout(a.goal, 0, 5)
    }
    if (recovery && q?.type === 'intervals') q = { type: 'tempo', blocks: LIGHT_TEMPO() }

    const kinds: { type: SessionType; blocks: Item[] }[] = [{ type: 'long', blocks: [easy(l)] }]
    if (q) kinds.push(q)
    while (kinds.length < a.days) kinds.push({ type: 'easy', blocks: [easy(e)] })
    const sessions = kinds.map((s, k) => ({ id: `w${index}-s${k + 1}`, type: s.type, blocks: s.blocks }))

    if (phase === 'taper') {
      // Race week 40% less than the peak, the week before it 25% less.
      const fromEnd = phases.length - 1 - i
      trimTo(sessions, Math.round((top ?? 0) * (fromEnd === 0 ? 0.6 : 0.75)))
    } else if (recovery) {
      trimTo(sessions, Math.round(weekMinutes(weeks[i - 1]) * 0.75))
    } else if (top != null) {
      trimTo(sessions, Math.floor(top * 1.1))
    }

    const week: PlanWeek = { index, phase, recovery, sessions }
    weeks.push(week)
    if (!recovery && phase !== 'taper') top = weekMinutes(week)
  })
  return weeks
}

// ---- deadline ----

const deadlineWeeks = (a: Answers, today: string): number | undefined => {
  if (a.raceDate) return Math.floor((utc(a.raceDate) - utc(today)) / DAY_MS / 7)
  return a.weeks
}

// Weeks the plan itself takes: a longer deadline adds base weeks (at most 8) and the rest waits;
// a shorter one removes base weeks down to the shortest finish plan.
function planWeeks(a: Answers, today: string): number {
  const f = FAMILIES[a.goal]
  if (a.goal === 'maintain') return f.minWeeks
  if (a.goal === 'start') return START.length - startSkip(a)
  return clamp(deadlineWeeks(a, today) ?? f.minWeeks, f.finishWeeks, f.minWeeks + MAX_EXTRA_BASE)
}

export function buildPlan(a: Answers, today: string, _vdot: number | null): { weeks: PlanWeek[] } {
  // The plan stores zones, not paces, so the VDOT does not change the sessions.
  if (a.goal === 'start') return { weeks: buildStart(a) }
  return { weeks: buildRace(a, planWeeks(a, today)) }
}

// ---- questionnaire checks ----

export type CheckResult =
  | { ok: true; weeks: number }
  | {
    ok: false
    reason: 'too_short' | 'time_out_of_reach' | 'days_not_allowed' | 'reference_too_old'
    minWeeks?: number
    possibleMinutes?: number
    finishWeeks?: number
  }

const monthsBefore = (iso: string, months: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1 - months, d)
}

export function checkAnswers(a: Answers, today: string): CheckResult {
  const f = FAMILIES[a.goal]
  if (!f.days.includes(a.days)) return { ok: false, reason: 'days_not_allowed' }
  const ref = a.reference
  if (ref.kind === 'race' && utc(ref.date) < monthsBefore(today, 3)) return { ok: false, reason: 'reference_too_old' }
  if (a.goal === 'maintain') return { ok: true, weeks: f.minWeeks }

  const deadline = deadlineWeeks(a, today)
  if (a.goal === 'start') {
    const need = planWeeks(a, today)
    if (deadline != null && deadline < need) return { ok: false, reason: 'too_short', minWeeks: need }
    return { ok: true, weeks: need }
  }

  const weeks = deadline ?? f.minWeeks
  if (weeks < f.minWeeks) {
    return weeks >= f.finishWeeks
      ? { ok: false, reason: 'too_short', minWeeks: f.minWeeks, finishWeeks: weeks }
      : { ok: false, reason: 'too_short', minWeeks: f.minWeeks }
  }

  if (a.goalType === 'time' && a.targetMinutes && ref.kind === 'race' && f.distanceM) {
    const reach = Math.round((vdotFrom(ref.distanceM, ref.minutes) + Math.min(weeks / 4, 6)) * 10) / 10
    if (requiredVdot(f.distanceM, a.targetMinutes) > reach) {
      return { ok: false, reason: 'time_out_of_reach', possibleMinutes: Math.round(predictMinutes(reach, f.distanceM) * 60) / 60 }
    }
  }
  return { ok: true, weeks: planWeeks(a, today) }
}
