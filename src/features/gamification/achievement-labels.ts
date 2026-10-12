import { t, tn } from '../../lib/i18n.js'
import type { AchievementCode } from './achievements'

type Text = { title: () => string; detail: () => string }

// Functions, so each t() call stays a literal that scripts/check-source-strings.mjs can see and the
// text follows the language chosen at render time.
export const ACHIEVEMENT_TEXT: Record<AchievementCode, Text> = {
  // Since check-ins (spec 5.1) these count training days: days with a check-in, or with a workout
  // finished before the cutover.
  first_workout: { title: () => t('First workout'), detail: () => t('Log your first training day.') },
  workouts_10: { title: () => tn(10, '{0} training days', 10), detail: () => tn(10, 'Log {0} training days.', 10) },
  workouts_50: { title: () => tn(50, '{0} training days', 50), detail: () => tn(50, 'Log {0} training days.', 50) },
  workouts_100: { title: () => tn(100, '{0} training days', 100), detail: () => tn(100, 'Log {0} training days.', 100) },
  workouts_250: { title: () => tn(250, '{0} training days', 250), detail: () => tn(250, 'Log {0} training days.', 250) },
  workouts_500: { title: () => tn(500, '{0} training days', 500), detail: () => tn(500, 'Log {0} training days.', 500) },
  first_pr: { title: () => t('First PR'), detail: () => t('Beat your best weight on an exercise.') },
  prs_10: { title: () => t('{0} PRs', 10), detail: () => t('Set {0} personal records.', 10) },
  prs_50: { title: () => t('{0} PRs', 50), detail: () => t('Set {0} personal records.', 50) },
  week_target_1: { title: () => t('Goal met'), detail: () => t('Meet your weekly workout goal for the first time.') },
  streak_4: { title: () => t('{0} weeks in a row', 4), detail: () => t('Meet your weekly goal {0} weeks in a row.', 4) },
  streak_12: { title: () => t('{0} weeks in a row', 12), detail: () => t('Meet your weekly goal {0} weeks in a row.', 12) },
  streak_26: { title: () => t('{0} weeks in a row', 26), detail: () => t('Meet your weekly goal {0} weeks in a row.', 26) },
  streak_52: { title: () => t('{0} weeks in a row', 52), detail: () => t('Meet your weekly goal {0} weeks in a row.', 52) },
  weigh_in_7: { title: () => t('Steady scale'), detail: () => t('Log your weight 7 days in a row.') },
  level_10: { title: () => t('Level {0}', 10), detail: () => t('Reach level {0}.', 10) },
  level_25: { title: () => t('Level {0}', 25), detail: () => t('Reach level {0}.', 25) },
  level_50: { title: () => t('Level {0}', 50), detail: () => t('Reach level {0}.', 50) },
  first_friend: { title: () => t('First friend'), detail: () => t('Add your first friend.') },
  challenge_first: { title: () => t('First challenge'), detail: () => t('Complete a challenge with friends.') },
  challenge_won_5: { title: () => t('{0} challenges', 5), detail: () => t('Complete {0} challenges with friends.', 5) },
  early_bird: { title: () => t('Early bird'), detail: () => t('Finish 5 workouts started before 7 a.m.') },
  nutrition_first_day: { title: () => t('First day logged'), detail: () => t('Log your meals for a whole day.') },
  nutrition_days_10: { title: () => t('{0} days on target', 10), detail: () => t('Hit your calories and protein on {0} days.', 10) },
  nutrition_days_50: { title: () => t('{0} days on target', 50), detail: () => t('Hit your calories and protein on {0} days.', 50) },
  nutrition_days_100: { title: () => t('{0} days on target', 100), detail: () => t('Hit your calories and protein on {0} days.', 100) },
  nutrition_days_250: { title: () => t('{0} days on target', 250), detail: () => t('Hit your calories and protein on {0} days.', 250) },
  nutrition_week_target_1: { title: () => t('Nutrition goal met'), detail: () => t('Meet your weekly nutrition goal for the first time.') },
  nutrition_streak_4: { title: () => t('{0} nutrition weeks in a row', 4), detail: () => t('Meet your weekly nutrition goal {0} weeks in a row.', 4) },
  nutrition_streak_12: { title: () => t('{0} nutrition weeks in a row', 12), detail: () => t('Meet your weekly nutrition goal {0} weeks in a row.', 12) },
  nutrition_streak_26: { title: () => t('{0} nutrition weeks in a row', 26), detail: () => t('Meet your weekly nutrition goal {0} weeks in a row.', 26) },
  protein_7: { title: () => t('Protein week'), detail: () => t('Hit your protein target 7 days in a row.') },
  sleep_first_night: { title: () => t('First night'), detail: () => t('Log your first night of sleep.') },
  sleep_nights_10: { title: () => tn(10, '{0} nights on target', 10), detail: () => tn(10, 'Sleep enough and go to bed on time on {0} nights.', 10) },
  sleep_nights_50: { title: () => tn(50, '{0} nights on target', 50), detail: () => tn(50, 'Sleep enough and go to bed on time on {0} nights.', 50) },
  sleep_nights_100: { title: () => tn(100, '{0} nights on target', 100), detail: () => tn(100, 'Sleep enough and go to bed on time on {0} nights.', 100) },
  sleep_nights_250: { title: () => tn(250, '{0} nights on target', 250), detail: () => tn(250, 'Sleep enough and go to bed on time on {0} nights.', 250) },
  sleep_week_target_1: { title: () => t('Sleep goal met'), detail: () => t('Meet your weekly sleep goal for the first time.') },
  sleep_streak_4: { title: () => tn(4, '{0} weeks of sleep', 4), detail: () => tn(4, 'Meet your weekly sleep goal {0} weeks in a row.', 4) },
  sleep_streak_12: { title: () => tn(12, '{0} weeks of sleep', 12), detail: () => tn(12, 'Meet your weekly sleep goal {0} weeks in a row.', 12) },
  sleep_streak_26: { title: () => tn(26, '{0} weeks of sleep', 26), detail: () => tn(26, 'Meet your weekly sleep goal {0} weeks in a row.', 26) },
  sleep_clock_7: { title: () => t('Clock on time'), detail: () => t('Go to bed within 30 minutes of your bedtime 7 nights in a row.') }
}

// A badge's name; one this build does not know yet (added on the server later) gets a generic
// name instead of its code.
export const achievementTitle = (code: string): string =>
  ACHIEVEMENT_TEXT[code as AchievementCode]?.title() ?? t('New achievement')
