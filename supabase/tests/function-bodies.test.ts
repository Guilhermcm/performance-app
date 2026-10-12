import { describe, it, expect } from 'vitest'
import { bodyLines, definitions } from './helpers/function-bodies'

// Every function a phase redefines with create or replace starts from the latest body (spec 0.2).
// For each one: the definition right before it in the migrations is the declared base, and every
// code line of the base is still in the new body, except the ones listed in changed (copied
// literally from the base).
const REDEFINED: { fn: string; base: string; in: string; changed: string[] }[] = [
  {
    fn: 'week_target_for', base: '0008_weekly_targets_pillar.sql', in: '0021_sleep_base.sql',
    changed: ["values (p_user, p_pillar, p_week, coalesce(v, case when p_pillar = 'nutrition' then 5 else 3 end))"],
  },
  { fn: 'freeze_week_target', base: '0008_weekly_targets_pillar.sql', in: '0021_sleep_base.sql', changed: [] },
  { fn: 'award_xp', base: '0020_checkin_feed.sql', in: '0022_sleep_close.sql', changed: [] },
  // The last line of protein_best_run gains a comma: the sleep metrics follow it.
  { fn: 'achievement_stats', base: '0020_checkin_feed.sql', in: '0022_sleep_close.sql', changed: [') lengths), 0)'] },
  // The active-week test gains the sleep case: nutrition moves to its own when.
  {
    fn: 'pillar_consistency', base: '0020_checkin_feed.sql', in: '0023_sleep_progress.sql',
    changed: ['else public.nutrition_week_active(p_user, w::date) end;'],
  },
  {
    fn: 'progress_card', base: '0019_training_days.sql', in: '0023_sleep_progress.sql',
    changed: ["'max', 960 * (1 + public.nutrition_week_active(p_user, v_week)::int),"],
  },
  // The nutrition radar point is no longer the last one: the sleep one follows it.
  {
    fn: 'my_progress_extras', base: '0019_training_days.sql', in: '0023_sleep_progress.sql',
    changed: ["'previous', public.pillar_consistency(p_user, 'nutrition', 1))))"],
  },
  { fn: 'get_my_progress', base: '0019_training_days.sql', in: '0023_sleep_progress.sql', changed: [] },
  { fn: 'challenge_progress', base: '0020_checkin_feed.sql', in: '0024_sleep_challenge.sql', changed: [] },
  { fn: 'close_challenge', base: '0020_checkin_feed.sql', in: '0024_sleep_challenge.sql', changed: [] },
  // The two-day templates gain the sleep one.
  {
    fn: 'challenge_grace', base: '0020_checkin_feed.sql', in: '0024_sleep_challenge.sql',
    changed: ["select case when p_template in ('nutrition_days_on_target', 'weeks_on_target', 'workouts_count', 'checkin_days')"],
  },
  // The template list gains the sleep one and the creator's row records share_sleep.
  {
    fn: 'create_challenge', base: '0020_checkin_feed.sql', in: '0024_sleep_challenge.sql',
    changed: [
      "'checkin_days')",
      'insert into public.challenge_members (challenge_id, user_id, invited_by, joined_at, share_volume, share_nutrition)',
      "values (v_id, v_me, null, public.app_now(), p_template = 'volume_total', p_template = 'nutrition_days_on_target');",
    ],
  },
  // Joining records share_sleep next to share_nutrition.
  {
    fn: 'join_challenge', base: '0015_nutrition_challenge.sql', in: '0024_sleep_challenge.sql',
    changed: ["share_nutrition = (v_c.template = 'nutrition_days_on_target')"],
  },
]

describe('redefined function bodies', () => {
  it.each(REDEFINED)('$fn in $in starts from $base', ({ fn, base, in: file, changed }) => {
    const defs = definitions(fn)
    const at = defs.findIndex(d => d.file === file)
    expect(at, `${fn} is not defined in ${file}`).toBeGreaterThan(0)
    expect(defs[at - 1].file).toBe(base)

    const before = bodyLines(defs[at - 1].body)
    const after = new Set(bodyLines(defs[at].body))
    for (const line of changed) expect(before, `changed line not in the base: ${line}`).toContain(line)
    const lost = before.filter(line => !changed.includes(line) && !after.has(line))
    expect(lost).toEqual([])
  })
})
