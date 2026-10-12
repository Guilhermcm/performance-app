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
