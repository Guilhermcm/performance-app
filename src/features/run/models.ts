// Running plan models (spec §5, plan Decisions 4 to 8): families, questionnaire checks and the plan
// builder. Pure functions. Sessions come out without `day`; fitting them into the week is fit.ts.
import type { Answers, Block, Item, Phase, RunGoal, Session, SessionType, Week } from './types'
import { predictMinutes, requiredVdot, vdotFrom } from './vdot'

export type { Answers }

export type PlanSession = Omit<Session, 'day'>
export type PlanWeek = Omit<Week, 'sessions'> & { sessions: PlanSession[] }

// A reference VDOT below this is not a usable pace (a typo such as "6:00" for 6 minutes in an h:mm
// field, or a walk): the plan goes by feel, as with `continuous` and `none`.
export const MIN_VDOT = 15

type RaceGoal = '5k' | '10k' | 'half'
type Family = {
  days: number[]
  minWeeks: number
  // Races only: shortest finish plan (the minimum without its base weeks, spec §5.3), taper weeks
  // and race distance. `start` and `maintain` have no deadline arithmetic.
  finishWeeks?: number
  taper?: number
  distanceM?: number
}

// Decision 5: taper at the end; of the rest, 35% build, 35% specific, base takes the rounding.
function split(weeks: number, taper: number) {
  const rest = weeks - taper
  const build = Math.floor(rest * 0.35)
  const specific = Math.floor(rest * 0.35)
  return { base: rest - build - specific, build, specific, taper }
}

const race = (days: number[], minWeeks: number, taper: number, distanceM: number): Family =>
  ({ days, minWeeks, finishWeeks: minWeeks - split(minWeeks, taper).base, taper, distanceM })

export const FAMILIES: Record<RunGoal, Family> = {
  start: { days: [2, 3], minWeeks: 8 },
  '5k': race([2, 3, 4], 8, 1, 5000),
  '10k': race([3, 4], 10, 2, 10000),
  half: race([3, 4], 12, 2, 21097.5),
  maintain: { days: [2, 3, 4], minWeeks: 8 }
}

// Decision 4: first easy run with a race reference, and the easy and long run caps (maintain uses
// the 5k ones). Not used by `start`, which follows its own table.
const VOLUME: Record<RaceGoal | 'maintain', { raceEasy: number; easyCap: number; longCap: number }> = {
  '5k': { raceEasy: 30, easyCap: 50, longCap: 60 },
  '10k': { raceEasy: 35, easyCap: 55, longCap: 80 },
  half: { raceEasy: 40, easyCap: 60, longCap: 120 },
  maintain: { raceEasy: 30, easyCap: 50, longCap: 60 }
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

const usableVdot = (vdot: number | null) => (vdot != null && Number.isFinite(vdot) && vdot >= MIN_VDOT ? vdot : null)

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

const copy = (items: Item[]): Item[] => items.map(it => ('repeat' in it ? { repeat: it.repeat, blocks: it.blocks.map(b => ({ ...b })) } : { ...it }))

// 80% of a workout's minutes: long repeats lose repetitions, the rest loses minutes per block.
const scaleBlock = (b: Block): Block => ({ zone: b.zone, min: Math.max(1, Math.round(b.min * 0.8)) })
const eighty = (items: Item[]): Item[] =>
  items.map(it => ('repeat' in it
    ? it.repeat >= 5 ? { repeat: Math.round(it.repeat * 0.8), blocks: it.blocks.map(b => ({ ...b })) } : { repeat: it.repeat, blocks: it.blocks.map(scaleBlock) }
    : scaleBlock(it)))

// `start` ignores the deadline: no extra base weeks and no delay. It is the table, from the skipped
// week on.
function buildStart(a: Answers): PlanWeek[] {
  const phases = phaseList(split(START.length, 0))
  const skip = startSkip(a)
  return START.slice(skip).map((tpl, i) => {
    const index = i + 1
    const blocks = [copy(tpl.blocks), copy(tpl.blocks), eighty(tpl.blocks)].slice(0, a.days)
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

function firstEasy(a: Answers, vdot: number | null): number {
  const ref = a.reference
  if (ref.kind === 'continuous') return clamp(Math.round(ref.minutes * 0.8), 20, 40)
  if (ref.kind === 'race' && vdot != null) return VOLUME[a.goal as RaceGoal | 'maintain'].raceEasy
  // `none` (meant for `start` only, Decision 4) and a race without a usable VDOT: the lowest start.
  return 20
}

const lerp = (from: number, to: number, p: number) => Math.round(from + (to - from) * p)

// A quality workout (Ritmo or Intervalado): `warm` easy, `reps` × (`min` in the zone, `between`
// easy) or one block when reps is 1, then `cool` easy.
type Quality = { type: 'tempo' | 'intervals'; warm: number; reps: number; min: number; between: number; cool: number }

const tempo = (reps: number, min: number, cool: number): Quality => ({ type: 'tempo', warm: 10, reps, min, between: reps > 1 ? 2 : 0, cool })
const intervals = (reps: number, min: number, between: number, cool: number): Quality => ({ type: 'intervals', warm: 10, reps, min, between, cool })
const LIGHT_TEMPO = tempo(2, 8, 5)

const qualityMinutes = (q: Quality) => q.warm + (q.reps > 1 ? q.reps * (q.min + q.between) : q.min) + q.cool

function qualityBlocks(q: Quality): Item[] {
  const zone = q.type === 'tempo' ? 'moderate' : 'hard'
  const main: Item = q.reps > 1 ? { repeat: q.reps, blocks: [{ zone, min: q.min }, easy(q.between)] } : { zone, min: q.min }
  return [easy(q.warm), main, easy(q.cool)]
}

// The shorter forms of a quality workout, longest first: cool down, then warm up (both down to 5),
// then repetitions (Ritmo down to one block, Intervalado down to 2).
function forms(q: Quality): Quality[] {
  const out = [q]
  const minReps = q.type === 'tempo' ? 1 : 2
  for (;;) {
    const c = { ...out[out.length - 1] }
    if (c.cool > 5) c.cool--
    else if (c.warm > 5) c.warm--
    else if (c.reps > minReps) {
      c.reps--
      if (c.reps === 1) c.between = 0
    } else return out
    out.push(c)
  }
}

// The longest form within `limit` minutes, or the shortest form.
const shrink = (all: Quality[], limit: number) => all.find(c => qualityMinutes(c) <= limit) ?? all[all.length - 1]

// The family workout of the specific phase at ladder position p (0 to 1).
function specificWorkout(goal: RaceGoal, p: number, cool: number): Quality {
  if (goal === '5k') return intervals(5, lerp(3, 4, p), 3, cool)
  const [min, finalMin] = goal === '10k' ? [12, 20] : [15, 30]
  return p >= 1 ? tempo(1, finalMin, cool) : tempo(2, min, cool)
}

type Slot = { phase: Phase; recovery: boolean; kind: 'tempo' | 'intervals' | 'light' | null; p: number }

// Which quality workout each week gets, and where it sits on its ladder. Each workout type climbs
// its own ladder by its own occurrences within the phase, so the first Intervalado of the build is
// the bottom rung (5 × 2). A recovery week takes the bottom rung of its type (Intervalado becomes the
// light Ritmo) and is not a rung of the climb.
function slots(a: Answers, phases: Phase[]): Slot[] {
  const out: Slot[] = phases.map((phase, i) => {
    const index = i + 1
    const recovery = phase !== 'taper' && index % 4 === 0
    let kind: Slot['kind'] = null
    if (a.goal === 'maintain') kind = index >= 3 && a.days >= 3 ? 'tempo' : null
    else if (phase === 'build') kind = (i - phases.indexOf('build')) % 2 === 0 ? 'tempo' : 'intervals'
    else if (phase === 'specific' || phase === 'taper') kind = a.goal === '5k' ? 'intervals' : 'tempo'
    if (recovery && kind === 'intervals') kind = 'light'
    return { phase, recovery, kind, p: 0 }
  })
  for (const phase of ['build', 'specific'] as const) {
    for (const kind of ['tempo', 'intervals'] as const) {
      const at = out.filter(s => s.phase === phase && s.kind === kind && !s.recovery)
      at.forEach((s, j) => { s.p = at.length > 1 ? j / (at.length - 1) : 0 })
    }
  }
  return out
}

function qualityOf(a: Answers, s: Slot): Quality | null {
  if (!s.kind) return null
  if (s.kind === 'light') return LIGHT_TEMPO
  if (a.goal === 'maintain') return tempo(2, 10, 5)
  const goal = a.goal as RaceGoal
  if (s.phase === 'taper') return specificWorkout(goal, 0, 5)
  const cool = lerp(5, 10, s.p)
  if (s.phase === 'specific') return specificWorkout(goal, s.p, cool)
  return s.kind === 'tempo' ? tempo(lerp(2, 3, s.p), lerp(8, 10, s.p), cool) : intervals(lerp(5, 6, s.p), lerp(2, 3, s.p), 2, cool)
}

const EASY_FLOOR = 10

type Sized = { l: number; e: number; q: Quality | null; total: number }

// A week at scale s (0 to 1000 per mille) of its nominal easy and long minutes, with quality form
// `q`. The Longão is never shorter than any other session.
function withForm(long: number, easyMin: number, nEasy: number, q: Quality | null, s: number): Sized {
  const f = s / 1000
  const e = Math.max(EASY_FLOOR, Math.round(easyMin * f))
  const qm = q ? qualityMinutes(q) : 0
  const l = Math.max(Math.round(long * f), e, qm)
  return { l, e, q, total: l + nEasy * e + qm }
}

// Everything at scale s: the quality shortens with the week and never runs past the nominal
// Longão at that scale.
function sized(long: number, easyMin: number, nEasy: number, all: Quality[] | null, s: number): Sized {
  const f = s / 1000
  const q = all ? shrink(all, Math.min(Math.round(qualityMinutes(all[0]) * f), Math.round(long * f))) : null
  return withForm(long, easyMin, nEasy, q, s)
}

// Volume is non-decreasing in s, so a binary search finds the largest scale at or under `target`.
function largestUnder(at: (s: number) => Sized, target: number): number {
  if (at(1000).total <= target) return 1000
  if (at(0).total > target) return 0
  let lo = 0
  let hi = 1000
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (at(mid).total <= target) lo = mid
    else hi = mid
  }
  return lo
}

// The scale whose volume is nearest `target` (the step just above may jump by several minutes).
function closestTo(at: (s: number) => Sized, target: number): number {
  const lo = largestUnder(at, target)
  if (lo === 1000) return lo
  const hi = lo + 1
  return Math.abs(at(hi).total - target) < Math.abs(target - at(lo).total) ? hi : lo
}

// The week nearest `target`: everything scaled together if that lands within `tolerance`; else
// the longest quality form that, with the easy and long runs scaled on their own, does.
function nearest(at: (s: number) => Sized, all: Quality[] | null, target: number, tolerance: number,
  form: (q: Quality, s: number) => Sized): Sized {
  const best = at(closestTo(at, target))
  if (Math.abs(best.total - target) <= tolerance || !all) return best
  let out = best
  for (const q of all) {
    const fixed = (s: number) => form(q, s)
    const w = fixed(closestTo(fixed, target))
    if (Math.abs(w.total - target) <= tolerance) return w
    if (Math.abs(w.total - target) < Math.abs(out.total - target)) out = w
  }
  return out
}

function buildRace(a: Answers, total: number, vdot: number | null): PlanWeek[] {
  const v = VOLUME[a.goal as RaceGoal | 'maintain']
  const plan = slots(a, phasesOf(a, total))
  const maintain = a.goal === 'maintain'
  let e = firstEasy(a, vdot)
  let l = Math.min(v.longCap, Math.round(e * 1.3))
  const weeks: PlanWeek[] = []
  // Minutes of the last week that is neither recovery nor taper: the 110% reference and the peak.
  let top: number | null = null

  plan.forEach((slot, i) => {
    const index = i + 1
    const { phase, recovery } = slot
    if (i > 0 && !recovery && phase !== 'taper' && !maintain) {
      e = Math.min(v.easyCap, Math.round(e * 1.08))
      l = Math.min(v.longCap, Math.round(l * 1.08))
    }
    const q = qualityOf(a, slot)
    const all = q ? forms(q) : null
    const nEasy = a.days - 1 - (q ? 1 : 0)
    const at = (s: number) => sized(l, e, nEasy, all, s)

    let w = at(1000)
    if (top != null && phase !== 'taper' && !recovery) w = at(largestUnder(at, Math.floor(top * 1.1)))
    else if (top != null) {
      // Recovery: 25% less than the last regular week. Taper: race week 40% less than the peak,
      // the week before it 25% less. Within 5 points, else the nearest.
      const share = recovery ? 0.75 : i === plan.length - 1 ? 0.6 : 0.75
      w = nearest(at, all, top * share, top * 0.05, (q2, s) => withForm(l, e, nEasy, q2, s))
    }
    const kinds: { type: SessionType; blocks: Item[] }[] = [{ type: 'long', blocks: [easy(w.l)] }]
    if (w.q) kinds.push({ type: w.q.type, blocks: qualityBlocks(w.q) })
    for (let k = 0; k < nEasy; k++) kinds.push({ type: 'easy', blocks: [easy(w.e)] })
    const week: PlanWeek = { index, phase, recovery, sessions: kinds.map((x, k) => ({ id: `w${index}-s${k + 1}`, ...x })) }
    weeks.push(week)
    if (!recovery && phase !== 'taper') top = weekMinutes(week)
  })
  return weeks
}

// maintain has no race: two easy weeks, then tempo from week 3 (Decision 8).
function phasesOf(a: Answers, total: number): Phase[] {
  if (a.goal === 'maintain') return phaseList({ base: 2, build: 6, specific: 0, taper: 0 })
  const f = FAMILIES[a.goal]
  const p = split(f.minWeeks, f.taper ?? 0)
  return phaseList({ ...p, base: total - p.build - p.specific - p.taper })
}

// ---- deadline ----

const deadlineWeeks = (a: Answers, today: string): number | undefined => {
  if (a.raceDate) return Math.floor((utc(a.raceDate) - utc(today)) / DAY_MS / 7)
  return a.weeks
}

// Weeks the plan itself takes. Races: a longer deadline adds base weeks (at most 8) and the rest
// waits; a shorter one removes base weeks down to the shortest finish plan. `start` ignores the
// deadline (its table, from the skipped week on); `maintain` is its 8-week cycle.
function planWeeks(a: Answers, today: string): number {
  const f = FAMILIES[a.goal]
  if (a.goal === 'maintain') return f.minWeeks
  if (a.goal === 'start') return START.length - startSkip(a)
  return clamp(deadlineWeeks(a, today) ?? f.minWeeks, f.finishWeeks!, f.minWeeks + MAX_EXTRA_BASE)
}

// `vdot` is the reference VDOT (null without a race reference). The plan stores zones, not paces;
// the returned `vdot` is the one the plan should keep: null below MIN_VDOT, so it goes by feel.
export function buildPlan(a: Answers, today: string, vdot: number | null): { weeks: PlanWeek[]; vdot: number | null } {
  const v = usableVdot(vdot)
  if (a.goal === 'start') return { weeks: buildStart(a), vdot: v }
  return { weeks: buildRace(a, planWeeks(a, today), v), vdot: v }
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

// The same day `months` calendar months earlier, clamped to the end of a shorter month
// (May 31 minus 3 months is Feb 28, or Feb 29 in a leap year).
function monthsBefore(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m - months, 0)).getUTCDate()
  return Date.UTC(y, m - 1 - months, Math.min(d, lastDay))
}

// `weeks` on success is the plan length. Races: at most the minimum plus 8 (a longer deadline waits;
// the delay is the deadline minus these weeks). `start` ignores the deadline: its table from the
// skipped week on, 8 weeks without a skip, never delayed. `maintain`: 8.
export function checkAnswers(a: Answers, today: string): CheckResult {
  const f = FAMILIES[a.goal]
  if (!f.days.includes(a.days)) return { ok: false, reason: 'days_not_allowed' }
  const ref = a.reference
  if (ref.kind === 'race' && utc(ref.date) < monthsBefore(today, 3)) return { ok: false, reason: 'reference_too_old' }
  if (a.goal === 'maintain' || a.goal === 'start') return { ok: true, weeks: planWeeks(a, today) }

  const weeks = deadlineWeeks(a, today) ?? f.minWeeks
  if (weeks < f.minWeeks) {
    return weeks >= f.finishWeeks!
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
