import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, makeUser, setClock, sql, withoutEventWindow } from './helpers/game'
import { addCheckin } from './helpers/checkin'

// The radar's Treino axis (pillar_consistency, 'strength') counts a week as closed from the day its
// Sunday closes (D+2, so Tuesday), like nutrition: on Monday last week is not in yet.
let db: PGlite

// 15:00 UTC is 12:00 in Sao Paulo, the middle of the local day.
const at = (day: string) => setClock(db, day + 'T15:00:00Z')
const radar = async (offset = 0) =>
  Number((await sql(db, `select public.pillar_consistency($1, 'strength', $2) as v`, [A, offset]))[0].v)

let n = 0
const xpRow = (amount: number, week: string) =>
  sql(db,
    `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
     values ($1, 'strength', $2, $3, null, $4)`,
    [A, amount, `test_${++n}`, week])

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await at('2026-10-05')
  await makeUser(db, A)
  await sql(db, `update public.profiles set created_at = '2026-10-05T15:00:00Z' where id = $1`, [A])
})

describe('radar: closed Treino weeks follow the D+2 close', () => {
  it('leaves last week out on Monday and counts it from Tuesday', async () => {
    await xpRow(960, '2026-10-05')
    await xpRow(480, '2026-10-12')
    // Monday 19/10: Sunday 18/10 is still open, so only the week of 05/10 is closed.
    await at('2026-10-19')
    expect(await radar()).toBe(1)
    // Tuesday 20/10: Sunday closed, the week of 12/10 joins the window.
    await at('2026-10-20')
    expect(await radar()).toBe(0.75)
  })

  it('has no closed week at all until the first one has closed', async () => {
    await xpRow(960, '2026-10-05')
    await at('2026-10-12')                  // Monday of the second week
    expect(await sql(db, `select public.pillar_consistency($1, 'strength', 0) as v`, [A])).toEqual([{ v: null }])
    await at('2026-10-13')
    expect(await radar()).toBe(1)
  })

  it('counts the XP of a Sunday check-in that only pays when it closes', async () => {
    // Three check-ins, the last on Sunday 11/10; with T = 3 the week pays 600 + 150 + 30 once closed.
    for (const day of ['2026-10-09', '2026-10-10', '2026-10-11']) {
      await at(day)
      await addCheckin(db, A, { day })
    }
    await at('2026-10-12')                  // Monday: Friday and Saturday closed, Sunday and the week not
    await sql(db, 'select public.close_training_days($1)', [A])
    expect(await sql(db, `select public.pillar_consistency($1, 'strength', 0) as v`, [A])).toEqual([{ v: null }])
    await at('2026-10-13')                  // Tuesday: Sunday closes and the week is in
    await sql(db, 'select public.close_training_days($1)', [A])
    expect(await radar()).toBe(0.8125)      // 780 / 960
  })

  it('leaves nutrition as it was', async () => {
    const [r] = await sql(db, `select pg_get_functiondef('public.pillar_consistency(uuid, public.pillar, int)'::regprocedure) as d`)
    expect(r.d).toContain(`v_last := public.week_start_of(public.local_today(p_user) - 8);`)
    expect(r.d).toContain('nutrition_week_active')
  })
})
