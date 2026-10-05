import { levelFor } from './xp'
import type { Progress, WeekProgress } from './types'

// A Progress as get_my_progress would answer it, in the week of Monday 2026-10-05.
export function progressOf(total: number, week: Partial<WeekProgress> = {}, over: Partial<Progress> = {}): Progress {
  return {
    today: '2026-10-07',
    total_xp: total,
    level: levelFor(total),
    pillars: { strength: { ...levelFor(total), xp: total } },
    week: { start: '2026-10-05', xp: 0, max: 960, target: 3, workouts: 1, extras: 0, prs: 0, target_hit: false, weighed_today: false, ...week },
    streak: { current: 0, best: 0, shields: 0 },
    achievements: [],
    stats: {},
    ...over
  }
}
