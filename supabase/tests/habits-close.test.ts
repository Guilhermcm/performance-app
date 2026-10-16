import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { addHabit, checkHabit, closeHabitsAs, enableHabits } from './helpers/habits'

let db: PGlite
let h: string   // N = 5, sort 0, created on Monday 05/10

const REASONS = ['habit_check', 'habit_day', 'habit_week_target']

// Checks straight into the table as the owner, so any past day can be filled.
const past = (habitId: string, ...days: string[]) =>
  Promise.all(days.map(day => checkHabit(db, A, habitId, day, { asOwner: true })))

const closedDays = async (uid: string) =>
  (await sql<{ day: string }>(db,
    `select to_char(day, 'YYYY-MM-DD') as day from public.habit_days where user_id = $1 order by day`, [uid]))
    .map(r => r.day)
const dayRow = async (uid: string, day: string) =>
  (await sql(db, 'select checks, valid, xp from public.habit_days where user_id = $1 and day = $2', [uid, day]))[0]
const counted = async (habitId: string, day: string) =>
  (await sql(db, 'select counted from public.habit_checks where habit_id = $1 and day = $2', [habitId, day]))[0].counted
const events = (uid: string) => sql(db,
  `select kind, pillar::text as pillar, to_char(occurred_on, 'YYYY-MM-DD') as on, source_ref
     from public.activity_events where user_id = $1 order by id`, [uid])
// The habits ledger with the source_ref of each event, in payment order.
const paid = (uid: string) => sql(db,
  `select l.reason, l.amount, e.source_ref as ref, to_char(l.week_start, 'YYYY-MM-DD') as week
     from public.xp_ledger l join public.activity_events e on e.id = l.event_id
    where l.user_id = $1 and l.pillar = 'habits' order by l.id`, [uid])

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await enableHabits(db, A)
  h = await addHabit(db, A, { perWeek: 5 })
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday
})

describe('closing a habit day', () => {
  it('closes a day at the start of D+2', async () => {
    await past(h, '2026-10-05', '2026-10-06')
    await setClock(db, '2026-10-07T02:59:00Z')   // 23:59 on Tuesday in Sao Paulo
    expect(await closeHabitsAs(db, A)).toBe(0)
    await setClock(db, '2026-10-07T03:01:00Z')   // 00:01 on Wednesday
    expect(await closeHabitsAs(db, A)).toBe(1)
    expect(await closedDays(A)).toEqual(['2026-10-05'])
    expect(await counted(h, '2026-10-06')).toBeNull()
  })

  it('marks the valid checks and stores the day', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    const once = await addHabit(db, A, { perWeek: 1, sort: 1 })   // Q = 6, so P = 7: 86 a check
    await past(h, '2026-10-05', '2026-10-06', '2026-10-07')
    await past(once, '2026-10-05', '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')   // Thursday: Monday and Tuesday close
    expect(await closeHabitsAs(db, A)).toBe(2)
    expect(await dayRow(A, '2026-10-05')).toEqual({ checks: 2, valid: 2, xp: 86 + 86 + 30 })
    expect(await dayRow(A, '2026-10-06')).toEqual({ checks: 2, valid: 1, xp: 86 + 30 })
    expect(await counted(h, '2026-10-05')).toBe(true)
    expect(await counted(once, '2026-10-05')).toBe(true)
    expect(await counted(h, '2026-10-06')).toBe(true)
    expect(await counted(once, '2026-10-06')).toBe(false)   // beyond its target of 1
    expect(await counted(h, '2026-10-07')).toBeNull()        // still open
    // xp is what the ledger paid for the day's events.
    const [{ sum }] = await sql(db,
      `select sum(l.amount)::int as sum from public.xp_ledger l join public.activity_events e on e.id = l.event_id
        where l.user_id = $1 and e.occurred_on = '2026-10-06'`, [A])
    expect(sum).toBe(116)
  })

  it('closes an in-period day without checks', async () => {
    expect(await closeHabitsAs(db, A)).toBe(1)
    expect(await dayRow(A, '2026-10-05')).toEqual({ checks: 0, valid: 0, xp: 0 })
    expect(await events(A)).toEqual([])
    expect(await ledger(db, A)).toEqual([])
  })

  it('skips days outside a period', async () => {
    await setClock(db, '2026-10-06T15:00:00Z')
    await enableHabits(db, A, false)             // the period ends on Monday
    await setClock(db, '2026-10-08T15:00:00Z')
    await enableHabits(db, A)                    // a new one starts on Thursday
    await past(h, '2026-10-06', '2026-10-08')
    await setClock(db, '2026-10-10T15:00:00Z')   // Saturday: up to Thursday closes
    expect(await closeHabitsAs(db, A)).toBe(2)
    expect(await closedDays(A)).toEqual(['2026-10-05', '2026-10-08'])
    expect(await counted(h, '2026-10-06')).toBeNull()
    expect(await counted(h, '2026-10-08')).toBe(true)
    expect((await events(A)).map(e => e.on)).toEqual(['2026-10-08', '2026-10-08'])
  })

  it('skips days before the pillar was ever on', async () => {
    await makeUser(db, B)
    expect(await closeHabitsAs(db, B)).toBe(0)   // never turned on
    await enableHabits(db, B)                    // Wednesday
    const mine = await addHabit(db, B, { perWeek: 3 })
    await checkHabit(db, B, mine, '2026-10-06', { asOwner: true })
    await checkHabit(db, B, mine, '2026-10-07', { asOwner: true })
    await setClock(db, '2026-10-09T15:00:00Z')   // Friday: up to Wednesday closes
    expect(await closeHabitsAs(db, B)).toBe(1)
    expect(await closedDays(B)).toEqual(['2026-10-07'])
    expect(await counted(mine, '2026-10-06')).toBeNull()
    expect(await counted(mine, '2026-10-07')).toBe(true)
  })

  it('pays a day once', async () => {
    await past(h, '2026-10-05')
    expect(await closeHabitsAs(db, A)).toBe(1)
    const first = await paid(A)
    expect(first).toEqual([
      { reason: 'habit_check', amount: 86, ref: `habit:${h}:2026-10-05`, week: '2026-10-05' },
      { reason: 'habit_day', amount: 30, ref: 'habits:2026-10-05', week: '2026-10-05' },
    ])
    expect(await closeHabitsAs(db, A)).toBe(0)
    // Even if the day closes again, its events are already there and pay nothing new.
    await sql(db, 'delete from public.habit_days where user_id = $1', [A])
    expect(await closeHabitsAs(db, A)).toBe(1)
    expect(await paid(A)).toEqual(first)
    expect(await dayRow(A, '2026-10-05')).toEqual({ checks: 1, valid: 1, xp: 116 })
  })

  it('pays the week bonus when C reaches Q', async () => {
    // Q = 5: Monday to Friday reach it; Saturday is beyond the target.
    await past(h, '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10')
    await setClock(db, '2026-10-09T15:00:00Z')   // Friday: up to Wednesday
    expect(await closeHabitsAs(db, A)).toBe(3)
    expect((await paid(A)).filter(r => r.reason === 'habit_week_target')).toEqual([])
    await setClock(db, '2026-10-13T15:00:00Z')   // Tuesday after: up to Sunday
    expect(await closeHabitsAs(db, A)).toBe(4)
    const bonus = (await events(A)).filter(e => e.kind === 'habit_week_target')
    expect(bonus).toEqual([
      { kind: 'habit_week_target', pillar: 'habits', on: '2026-10-09', source_ref: 'habits-week:2026-10-05' },
    ])
    expect((await paid(A)).filter(r => r.reason === 'habit_week_target')).toEqual([
      { reason: 'habit_week_target', amount: 107, ref: 'habits-week:2026-10-05', week: '2026-10-05' },
    ])
    expect(await counted(h, '2026-10-10')).toBe(false)
    expect(await dayRow(A, '2026-10-10')).toEqual({ checks: 1, valid: 0, xp: 0 })
    // The bonus is not part of the day's XP: 86 for the check and 30 for the day.
    expect(await dayRow(A, '2026-10-09')).toEqual({ checks: 1, valid: 1, xp: 116 })
  })

  it('never pays more than 600 for checks when Q grows mid-week', async () => {
    await setClock(db, '2026-10-05T15:00:00Z')
    const two = await addHabit(db, A, { perWeek: 2, sort: 1 })   // Q = 7
    await past(h, '2026-10-05', '2026-10-06')
    await past(two, '2026-10-05', '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')   // Thursday: four checks paid at 86
    expect(await closeHabitsAs(db, A)).toBe(2)
    const checksPaid = async () => (await paid(A)).filter(r => r.reason === 'habit_check').map(r => r.amount)
    expect(await checksPaid()).toEqual([86, 86, 86, 86])

    const late = await addHabit(db, A, { perWeek: 3, sort: 2 })   // Thursday: target 3, Q = 10
    await past(h, '2026-10-07', '2026-10-08', '2026-10-09')
    await past(late, '2026-10-08', '2026-10-09', '2026-10-10')
    await setClock(db, '2026-10-12T15:00:00Z')   // Monday after: up to Saturday
    await closeHabitsAs(db, A)
    // round(600 / 10) = 60 until the 600 runs out: the 9th pays 16, the 10th writes nothing.
    expect(await checksPaid()).toEqual([86, 86, 86, 86, 60, 60, 60, 60, 16])
    expect((await events(A)).filter(e => e.kind === 'habit_check')).toHaveLength(10)
    expect((await paid(A)).filter(r => r.reason === 'habit_week_target').map(r => r.amount)).toEqual([150])
    expect((await events(A)).find(e => e.kind === 'habit_week_target')?.on).toBe('2026-10-10')
  })

  it('closes days in the profile time zone', async () => {
    await sql(db, `update public.profiles set timezone = 'Asia/Tokyo' where id = $1`, [A])
    await past(h, '2026-10-11')
    await setClock(db, '2026-10-12T16:00:00Z')   // Tuesday the 13th, 01:00 in Tokyo; Monday in Sao Paulo
    await closeHabitsAs(db, A)
    expect((await closedDays(A)).at(-1)).toBe('2026-10-11')
    expect(await counted(h, '2026-10-11')).toBe(true)
    expect(await paid(A)).toEqual([
      { reason: 'habit_check', amount: 86, ref: `habit:${h}:2026-10-11`, week: '2026-10-05' },
      { reason: 'habit_day', amount: 30, ref: 'habits:2026-10-11', week: '2026-10-05' },
    ])
  })

  it('never touches other pillars', async () => {
    // Ledger rows of the other pillars, written before the week closes.
    for (const pillar of ['strength', 'nutrition', 'sleep'])
      await sql(db,
        `insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
         values ($1, $2, 100, $3, null, '2026-10-05')`, [A, pillar, 'test_' + pillar])
    const others = () => sql(db,
      `select pillar::text, reason, amount from public.xp_ledger
        where user_id = $1 and pillar in ('strength', 'nutrition', 'sleep') order by id`, [A])
    // habits_week is the pillar's own streak; the other pillars' streaks stay as they were.
    const streaks = () => sql(db,
      `select * from public.streaks where user_id = $1 and kind <> 'habits_week' order by kind`, [A])
    const beforeLedger = await others()
    const beforeStreaks = await streaks()

    await setClock(db, '2026-10-05T15:00:00Z')
    const two = await addHabit(db, A, { perWeek: 2, sort: 1 })   // Q = 7
    await past(h, '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09')
    await past(two, '2026-10-10', '2026-10-11')
    await setClock(db, '2026-10-13T15:00:00Z')
    expect(await closeHabitsAs(db, A)).toBe(7)

    const rows = await paid(A)
    expect(rows.every(r => REASONS.includes(r.reason))).toBe(true)
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(960)
    const [{ n }] = await sql(db,
      `select count(*)::int as n from public.xp_ledger
        where user_id = $1 and (pillar = 'habits') <> (reason = any($2::text[]))`, [A, REASONS])
    expect(n).toBe(0)
    expect((await events(A)).every(e => e.pillar === 'habits')).toBe(true)
    expect(await others()).toEqual(beforeLedger)
    expect(await streaks()).toEqual(beforeStreaks)
  })
})

describe('habit_days access', () => {
  it('lets clients read but not write closed days', async () => {
    await past(h, '2026-10-05')
    await closeHabitsAs(db, A)
    await makeUser(db, B)
    const read = (uid: string) => asUser(db, uid, () => db.query('select day from public.habit_days'))
    expect((await read(A)).rows).toHaveLength(1)
    expect((await read(B)).rows).toHaveLength(0)
    await expect(asUser(db, null, () => db.query('select day from public.habit_days')))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      `insert into public.habit_days (user_id, day, checks, valid, xp) values ($1, '2026-10-06', 1, 1, 116)`, [A])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      'update public.habit_days set xp = 960 where user_id = $1', [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      'delete from public.habit_days where user_id = $1', [A]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(
      'update public.habit_checks set counted = true where habit_id = $1', [h]))).rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query('select public.close_habit_days($1)', [A])))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, A, () => db.query(`select public.habit_week_q($1, '2026-10-05')`, [A])))
      .rejects.toThrow(/permission denied/)
  })

  it('leaves counted to the closing', async () => {
    // A client cannot mark its own check as valid: the guard clears what it sends.
    await asUser(db, A, () => db.query(
      `insert into public.habit_checks (habit_id, day, counted) values ($1, '2026-10-07', true)`, [h]))
    expect(await counted(h, '2026-10-07')).toBeNull()
  })

  it('lets account deletion remove closed days', async () => {
    await closeHabitsAs(db, A)
    await asUser(db, A, () => db.query('select public.delete_my_account()'))
    expect(await sql(db, 'select 1 from public.habit_days where user_id = $1', [A])).toHaveLength(0)
  })
})
