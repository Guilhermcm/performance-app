// The achievement catalogue v1 (spec §5.5), mirrored from public.achievement_catalog in
// supabase/migrations/0002_gamification.sql and, for nutrition, 0011_nutrition_week.sql, for
// sleep, 0022_sleep_close.sql and, for habits, 0027_habits_close.sql;
// gamification-catalog.test.ts keeps the two equal.
// Pure on purpose: the SQL tests import it. Titles and descriptions live in achievement-labels.ts.

export type Metric =
  | 'workouts' | 'prs' | 'week_targets' | 'best_streak' | 'weigh_in_run'
  | 'level' | 'early_workouts' | 'friends' | 'challenges_won'
  | 'nutrition_logged_days' | 'nutrition_on_target_days' | 'nutrition_week_targets'
  | 'nutrition_best_streak' | 'protein_best_run'
  | 'sleep_logged_nights' | 'sleep_on_target_nights' | 'sleep_week_targets' | 'sleep_best_streak'
  | 'sleep_clock_best_run'
  | 'habits_checks' | 'habits_week_targets' | 'habits_best_streak' | 'habits_iron_best_run'

export type AchievementCode =
  | 'first_workout' | 'workouts_10' | 'workouts_50' | 'workouts_100' | 'workouts_250' | 'workouts_500'
  | 'first_pr' | 'prs_10' | 'prs_50' | 'week_target_1'
  | 'streak_4' | 'streak_12' | 'streak_26' | 'streak_52' | 'weigh_in_7'
  | 'level_10' | 'level_25' | 'level_50'
  | 'first_friend' | 'challenge_first' | 'challenge_won_5' | 'early_bird'
  | 'nutrition_first_day' | 'nutrition_days_10' | 'nutrition_days_50' | 'nutrition_days_100' | 'nutrition_days_250'
  | 'nutrition_week_target_1' | 'nutrition_streak_4' | 'nutrition_streak_12' | 'nutrition_streak_26' | 'protein_7'
  | 'sleep_first_night' | 'sleep_nights_10' | 'sleep_nights_50' | 'sleep_nights_100' | 'sleep_nights_250'
  | 'sleep_week_target_1' | 'sleep_streak_4' | 'sleep_streak_12' | 'sleep_streak_26' | 'sleep_clock_7'
  | 'habits_first_check' | 'habits_checks_50' | 'habits_checks_200' | 'habits_checks_500' | 'habits_checks_1000'
  | 'habits_week_target_1' | 'habits_streak_4' | 'habits_streak_12' | 'habits_streak_26' | 'habits_iron_8'

// private: never shown to friends (nutrition and sleep come from health data, habits are personal).
export type Achievement = {
  code: AchievementCode; metric: Metric; threshold: number; xp: number; sort: number; private?: boolean
}
export type AchievementStats = Partial<Record<Metric, number>>

const a = (code: AchievementCode, metric: Metric, threshold: number, xp: number, sort: number): Achievement =>
  ({ code, metric, threshold, xp, sort })
const own = (code: AchievementCode, metric: Metric, threshold: number, xp: number, sort: number): Achievement =>
  ({ code, metric, threshold, xp, sort, private: true })

export const ACHIEVEMENTS: readonly Achievement[] = [
  a('first_workout', 'workouts', 1, 50, 10),
  a('workouts_10', 'workouts', 10, 100, 20),
  a('workouts_50', 'workouts', 50, 200, 30),
  a('workouts_100', 'workouts', 100, 300, 40),
  a('workouts_250', 'workouts', 250, 500, 50),
  a('workouts_500', 'workouts', 500, 800, 60),
  a('first_pr', 'prs', 1, 50, 70),
  a('prs_10', 'prs', 10, 150, 80),
  a('prs_50', 'prs', 50, 400, 90),
  a('week_target_1', 'week_targets', 1, 75, 100),
  a('streak_4', 'best_streak', 4, 150, 110),
  a('streak_12', 'best_streak', 12, 400, 120),
  a('streak_26', 'best_streak', 26, 800, 130),
  a('streak_52', 'best_streak', 52, 1500, 140),
  a('weigh_in_7', 'weigh_in_run', 7, 100, 150),
  a('level_10', 'level', 10, 0, 160),
  a('level_25', 'level', 25, 0, 170),
  a('level_50', 'level', 50, 0, 180),
  a('first_friend', 'friends', 1, 50, 190),
  a('challenge_first', 'challenges_won', 1, 200, 200),
  a('challenge_won_5', 'challenges_won', 5, 500, 210),
  a('early_bird', 'early_workouts', 5, 100, 220),
  own('nutrition_first_day', 'nutrition_logged_days', 1, 50, 300),
  own('nutrition_days_10', 'nutrition_on_target_days', 10, 100, 310),
  own('nutrition_days_50', 'nutrition_on_target_days', 50, 200, 320),
  own('nutrition_days_100', 'nutrition_on_target_days', 100, 300, 330),
  own('nutrition_days_250', 'nutrition_on_target_days', 250, 500, 340),
  own('nutrition_week_target_1', 'nutrition_week_targets', 1, 75, 350),
  own('nutrition_streak_4', 'nutrition_best_streak', 4, 150, 360),
  own('nutrition_streak_12', 'nutrition_best_streak', 12, 400, 370),
  own('nutrition_streak_26', 'nutrition_best_streak', 26, 800, 380),
  own('protein_7', 'protein_best_run', 7, 100, 390),
  own('sleep_first_night', 'sleep_logged_nights', 1, 50, 400),
  own('sleep_nights_10', 'sleep_on_target_nights', 10, 100, 410),
  own('sleep_nights_50', 'sleep_on_target_nights', 50, 200, 420),
  own('sleep_nights_100', 'sleep_on_target_nights', 100, 300, 430),
  own('sleep_nights_250', 'sleep_on_target_nights', 250, 500, 440),
  own('sleep_week_target_1', 'sleep_week_targets', 1, 75, 450),
  own('sleep_streak_4', 'sleep_best_streak', 4, 150, 460),
  own('sleep_streak_12', 'sleep_best_streak', 12, 400, 470),
  own('sleep_streak_26', 'sleep_best_streak', 26, 800, 480),
  own('sleep_clock_7', 'sleep_clock_best_run', 7, 100, 490),
  own('habits_first_check', 'habits_checks', 1, 50, 500),
  own('habits_checks_50', 'habits_checks', 50, 100, 510),
  own('habits_checks_200', 'habits_checks', 200, 200, 520),
  own('habits_checks_500', 'habits_checks', 500, 300, 530),
  own('habits_checks_1000', 'habits_checks', 1000, 500, 540),
  own('habits_week_target_1', 'habits_week_targets', 1, 75, 550),
  own('habits_streak_4', 'habits_best_streak', 4, 150, 560),
  own('habits_streak_12', 'habits_best_streak', 12, 400, 570),
  own('habits_streak_26', 'habits_best_streak', 26, 800, 580),
  own('habits_iron_8', 'habits_iron_best_run', 8, 200, 590)
]

// Unlocked only by Phase 1b (friends, challenges); Phase 1a never computes these metrics.
export const SOCIAL_METRICS: readonly Metric[] = ['friends', 'challenges_won']

// The nutrition pillar's metrics (phase 2a); every badge on them is private.
export const NUTRITION_METRICS: readonly Metric[] = [
  'nutrition_logged_days', 'nutrition_on_target_days', 'nutrition_week_targets', 'nutrition_best_streak', 'protein_best_run'
]

// The sleep pillar's metrics (phase 3); every badge on them is private.
export const SLEEP_METRICS: readonly Metric[] = [
  'sleep_logged_nights', 'sleep_on_target_nights', 'sleep_week_targets', 'sleep_best_streak', 'sleep_clock_best_run'
]

// The habits pillar's metrics (phase 4a); every badge on them is private.
export const HABITS_METRICS: readonly Metric[] = [
  'habits_checks', 'habits_week_targets', 'habits_best_streak', 'habits_iron_best_run'
]

const BY_CODE = new Map<string, Achievement>(ACHIEVEMENTS.map(x => [x.code, x]))
export const achievementByCode = (code: string): Achievement | undefined => BY_CODE.get(code)

// Mirror of public.achievements_for_stats: the codes the stats reach that are not unlocked yet,
// in catalogue order. A metric missing from the stats unlocks nothing.
export function evaluateAchievements(stats: AchievementStats, unlocked: Iterable<string>): AchievementCode[] {
  const held = new Set(unlocked)
  return ACHIEVEMENTS
    .filter(x => !held.has(x.code) && typeof stats[x.metric] === 'number' && (stats[x.metric] as number) >= x.threshold)
    .map(x => x.code)
}
