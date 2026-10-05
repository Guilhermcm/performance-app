import { t } from '../../lib/i18n.js'
import type { AchievementCode } from './achievements'

type Text = { title: () => string; detail: () => string }

// Functions, so each t() call stays a literal that scripts/check-source-strings.mjs can see and the
// text follows the language chosen at render time.
export const ACHIEVEMENT_TEXT: Record<AchievementCode, Text> = {
  first_workout: { title: () => t('First workout'), detail: () => t('Finish your first workout.') },
  workouts_10: { title: () => t('{0} workouts', 10), detail: () => t('Finish {0} workouts.', 10) },
  workouts_50: { title: () => t('{0} workouts', 50), detail: () => t('Finish {0} workouts.', 50) },
  workouts_100: { title: () => t('{0} workouts', 100), detail: () => t('Finish {0} workouts.', 100) },
  workouts_250: { title: () => t('{0} workouts', 250), detail: () => t('Finish {0} workouts.', 250) },
  workouts_500: { title: () => t('{0} workouts', 500), detail: () => t('Finish {0} workouts.', 500) },
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
  early_bird: { title: () => t('Early bird'), detail: () => t('Finish 5 workouts started before 7 a.m.') }
}
