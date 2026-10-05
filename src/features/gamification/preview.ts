import { achievementByCode } from './achievements'
import { EXTRA_XP, PR_LIMIT, PR_XP, WEEK_TARGET_BONUS, WEIGHT_XP, sessionXp, weekStartOf, workoutAwards } from './xp'
import type { Progress, XpLine, XpPreview } from './types'

const sum = (lines: XpLine[]) => lines.reduce((n, l) => n + l.amount, 0)

// What finishing a workout on `occurredOn` with `prs` new records is about to pay, from the
// progress the app already holds. Null when it cannot be known here: no progress yet, or a
// session logged into another week (that week's counts are not on the phone).
export function previewWorkout(p: Progress | null, input: { occurredOn: string; prs: number }): XpPreview | null {
  if (!p || weekStartOf(input.occurredOn) !== p.week.start) return null
  const w = p.week
  const lines: XpLine[] = []
  for (const a of workoutAwards({ workouts: w.workouts, extras: w.extras, prs: w.prs }, w.target)) {
    if (a.reason === 'workout') lines.push({ kind: 'workout', amount: a.amount, index: w.workouts + 1, of: w.target })
    else if (a.reason === 'week_target') lines.push({ kind: 'goal', amount: a.amount })
    else lines.push({ kind: 'extra', amount: a.amount })
  }
  const prs = Math.max(0, Math.min(input.prs, PR_LIMIT - w.prs))
  if (prs > 0) lines.push({ kind: 'pr', amount: prs * PR_XP, count: prs })
  return { lines, total: sum(lines) }
}

// The server's answer told line by line: the week's counters before and after, the new badges,
// and whatever is left (a session in a past week, say) as one last line.
export function linesFromProgress(before: Progress, after: Progress): XpLine[] {
  const lines: XpLine[] = []
  const b = before.week
  const a = after.week
  if (b.start === a.start) {
    for (let k = b.workouts + 1; k <= a.workouts; k++) lines.push({ kind: 'workout', amount: sessionXp(a.target, k), index: k, of: a.target })
    if (!b.target_hit && a.target_hit) lines.push({ kind: 'goal', amount: WEEK_TARGET_BONUS })
    for (let k = b.extras; k < a.extras; k++) lines.push({ kind: 'extra', amount: EXTRA_XP })
    if (a.prs > b.prs) lines.push({ kind: 'pr', amount: (a.prs - b.prs) * PR_XP, count: a.prs - b.prs })
    if (before.today === after.today && !b.weighed_today && a.weighed_today) lines.push({ kind: 'weight', amount: WEIGHT_XP })
  }
  const had = new Set(before.achievements.map(x => x.code))
  for (const x of after.achievements) {
    const xp = had.has(x.code) ? 0 : achievementByCode(x.code)?.xp ?? 0
    if (xp > 0) lines.push({ kind: 'achievement', amount: xp, code: x.code })
  }
  const rest = after.total_xp - before.total_xp - sum(lines)
  if (rest > 0) lines.push({ kind: 'other', amount: rest })
  return lines
}

// The running week never breaks a streak, and once its goal is met it is already in.
export const displayStreak = (p: Progress): number => p.streak.current + (p.week.target_hit ? 1 : 0)
