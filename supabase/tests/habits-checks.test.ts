import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { C, rows } from './helpers/social'
import { addHabit, archiveHabit, checkHabit, enableHabits, targetOf, uncheckHabit } from './helpers/habits'

let db: PGlite
let h: string
const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))
const checks = (habitId: string) =>
  sql(db, `select to_char(day, 'YYYY-MM-DD') as day from public.habit_checks where habit_id = $1 order by day`, [habitId])
    .then(r => r.map(x => x.day))

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-09-28T15:00:00Z')   // the pillar is on since the Monday before
  await makeUser(db, A)
  await makeUser(db, B)
  await enableHabits(db, A)
  await enableHabits(db, B)
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  h = await addHabit(db, A)
})

describe('habit check window', () => {
  it('accepts today and yesterday only', async () => {
    await checkHabit(db, A, h, '2026-10-07')
    await checkHabit(db, A, h, '2026-10-06')
    await expect(checkHabit(db, A, h, '2026-10-05')).rejects.toThrow(/day_closed/)
    await expect(checkHabit(db, A, h, '2026-10-08')).rejects.toThrow(/day_closed/)
    await checkHabit(db, A, h, '2026-10-05', { asOwner: true })
    await expect(uncheckHabit(db, A, h, '2026-10-05')).rejects.toThrow(/day_closed/)
    expect(await checks(h)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    await uncheckHabit(db, A, h, '2026-10-06')
    await uncheckHabit(db, A, h, '2026-10-07')
    expect(await checks(h)).toEqual(['2026-10-05'])
  })

  it('uses the profile time zone', async () => {
    await sql(db, `update public.profiles set timezone = 'Asia/Tokyo' where id = $1`, [A])
    await setClock(db, '2026-10-11T23:30:00Z')   // Monday the 12th, 08:30 in Tokyo; still Sunday in UTC
    await checkHabit(db, A, h, '2026-10-12')
    await checkHabit(db, A, h, '2026-10-11')
    await expect(checkHabit(db, A, h, '2026-10-10')).rejects.toThrow(/day_closed/)
    const fresh = await addHabit(db, A, { perWeek: 7 })
    expect(await targetOf(db, fresh, '2026-10-12')).toBe(7)
    expect(await targetOf(db, fresh, '2026-10-05')).toBeNull()
  })
})

describe('habit check rules', () => {
  it('refuses archived and foreign habits', async () => {
    await checkHabit(db, A, h, '2026-10-07')
    await archiveHabit(db, A, h)
    await expect(checkHabit(db, A, h, '2026-10-06')).rejects.toThrow(/habit_archived/)
    await expect(uncheckHabit(db, A, h, '2026-10-07')).rejects.toThrow(/habit_archived/)
    expect(await checks(h)).toEqual(['2026-10-07'])

    const mine = await addHabit(db, A)
    await expect(checkHabit(db, B, mine, '2026-10-07')).rejects.toThrow(/habit_archived/)
    // B cannot reach A's checks either.
    await checkHabit(db, A, mine, '2026-10-07')
    expect(await rows(db, B, 'select * from public.habit_checks')).toEqual([])
    expect(await rows(db, B, 'delete from public.habit_checks returning 1')).toEqual([])
    await expect(rows(db, null, 'select * from public.habit_checks')).rejects.toThrow(/permission denied/)
    expect(await checks(mine)).toEqual(['2026-10-07'])
  })

  it('refuses days outside a period', async () => {
    await checkHabit(db, A, h, '2026-10-06')
    await enableHabits(db, A, false)   // the period ends on Tuesday
    await expect(checkHabit(db, A, h, '2026-10-07')).rejects.toThrow(/pillar_off/)
    await uncheckHabit(db, A, h, '2026-10-06')
    expect(await checks(h)).toEqual([])
    await checkHabit(db, A, h, '2026-10-06')
    // Never turned on.
    await makeUser(db, C)
    const other = await addHabit(db, C)
    await expect(checkHabit(db, C, other, '2026-10-07')).rejects.toThrow(/pillar_off/)
  })

  it('is idempotent and has no update', async () => {
    const ins = () => asA(
      `insert into public.habit_checks (habit_id, day) values ($1, '2026-10-07') on conflict (habit_id, day) do nothing`, [h])
    await ins()
    await ins()
    expect(await checks(h)).toEqual(['2026-10-07'])
    expect(await sql(db, 'select user_id from public.habit_checks')).toEqual([{ user_id: A }])
    await expect(asA(`update public.habit_checks set day = '2026-10-06'`)).rejects.toThrow(/permission denied/)
    await expect(asA('truncate public.habit_checks')).rejects.toThrow(/permission denied/)
  })

  it('lets account deletion remove everything', async () => {
    const other = await addHabit(db, A, { perWeek: 3 })
    await checkHabit(db, A, h, '2026-09-29', { asOwner: true })
    await checkHabit(db, A, h, '2026-10-07')
    await archiveHabit(db, A, other)
    const theirs = await addHabit(db, B)
    await checkHabit(db, B, theirs, '2026-10-07')
    await asA('select public.delete_my_account()')
    for (const t of ['habits', 'habit_targets', 'habit_checks', 'habit_periods']) {
      expect(await sql(db, `select 1 from public.${t} where user_id = $1`, [A])).toHaveLength(0)
    }
    for (const t of ['habits', 'habit_targets', 'habit_checks', 'habit_periods']) {
      expect(await sql(db, `select 1 from public.${t} where user_id = $1`, [B])).toHaveLength(1)
    }
  })
})
