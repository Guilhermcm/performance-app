import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import { befriend } from './helpers/social'
import { addCheckin } from './helpers/checkin'

let db: PGlite

const DETAIL = { entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true }] }] }

// A check-in straight into the table as the owner, so any past day can be filled (the client guard
// only lets a person post today or yesterday).
const post = async (uid: string, day: string, detail: unknown = null) => {
  const id = randomUUID()
  await sql(db,
    `insert into public.checkins (id, user_id, day, activity, title, caption, note, visibility, photo_path, detail)
     values ($1, $2, $3, 'strength', 'Treino', 'Legenda', 'Nota privada', 'friends', $4, $5::jsonb)`,
    [id, uid, day, `${uid}/${id}.jpg`, detail === null ? null : JSON.stringify(detail)])
  return id
}
const week = (from: string, n = 7) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10))

const setCutoff = (day: string) =>
  sql(db, `update public.app_settings set value = to_jsonb($1::date) where key = 'training_checkin_since'`, [day])
const close = async (uid = A) =>
  (await sql<{ n: number }>(db, 'select public.close_training_days($1) as n', [uid]))[0].n
const days = (uid = A) => sql(db,
  `select to_char(day, 'YYYY-MM-DD') as day, checked, detailed, legacy
     from public.training_days where user_id = $1 order by day`, [uid])
const pillar = async (uid = A) => (await ledger(db, uid)).filter(r => r.pillar === 'strength')
const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0)
const streak = async (uid = A) =>
  (await sql(db, `select current, best, shields from public.streaks where user_id = $1 and kind = 'training_week'`, [uid]))[0]

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await makeUser(db, B, { display_name: 'Bia' })
  await setCutoff('2026-10-05')
})

describe('the cutover setting', () => {
  it('is written by the migration with the day it ran', async () => {
    const fresh = await freshDb()
    const [r] = await sql(fresh,
      `select (value #>> '{}')::date = current_date as today from public.app_settings where key = 'training_checkin_since'`)
    expect(r).toEqual({ today: true })
    await fresh.close()
  })

  it('adds the server-only training kinds', async () => {
    expect(await sql(db,
      `select kind, server_only from public.event_kinds where pillar = 'strength' and kind like 'training%' order by kind`))
      .toEqual([{ kind: 'training_day', server_only: true }, { kind: 'training_detailed', server_only: true }])
    await expect(asUser(db, A, () => db.query(
      `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
       values ($1, 'strength', 'training_day', '2026-10-05', 'x')`, [A]))).rejects.toThrow(/row-level security/)
  })
})

describe('closing a training day', () => {
  it('closes a day with a check-in at the start of D+2', async () => {
    await addCheckin(db, A, { day: '2026-10-05' })
    await setClock(db, '2026-10-07T02:59:00Z')   // 23:59 on Tuesday in Sao Paulo
    expect(await close()).toBe(0)
    await setClock(db, '2026-10-07T03:01:00Z')   // 00:01 on Wednesday
    expect(await close()).toBe(1)
    expect(await days()).toEqual([{ day: '2026-10-05', checked: true, detailed: false, legacy: false }])
  })

  it('marks the day detailed when a check-in carries the workout detail', async () => {
    await post(A, '2026-10-05', DETAIL)
    await post(A, '2026-10-06')
    await post(A, '2026-10-07', { entries: [] })
    await setClock(db, '2026-10-09T15:00:00Z')
    expect(await close()).toBe(3)
    expect((await days()).map(d => d.detailed)).toEqual([true, false, false])
  })

  it('writes the days between check-ins as unchecked', async () => {
    await post(A, '2026-10-05')
    await post(A, '2026-10-08')
    await setClock(db, '2026-10-10T15:00:00Z')
    await close()
    expect((await days()).map(d => [d.day, d.checked])).toEqual([
      ['2026-10-05', true], ['2026-10-06', false], ['2026-10-07', false], ['2026-10-08', true]])
  })

  it('is idempotent', async () => {
    await post(A, '2026-10-05', DETAIL)
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await close()).toBe(1)
    const first = await ledger(db, A)
    expect(await close()).toBe(0)
    expect(await ledger(db, A)).toEqual(first)
    const events = await sql(db,
      `select kind, to_char(occurred_on, 'YYYY-MM-DD') as on, source_ref from public.activity_events
        where user_id = $1 order by id`, [A])
    expect(events).toEqual([
      { kind: 'training_day', on: '2026-10-05', source_ref: 'training:2026-10-05' },
      { kind: 'training_detailed', on: '2026-10-05', source_ref: 'training:2026-10-05' },
    ])
  })

  it('counts two check-ins on the same day once', async () => {
    await post(A, '2026-10-05')
    await post(A, '2026-10-05', DETAIL)
    await setClock(db, '2026-10-07T15:00:00Z')
    await close()
    expect(await pillar()).toEqual([
      { reason: 'training_logged', amount: 10, week_start: '2026-10-05', pillar: 'strength' },
      { reason: 'training_day', amount: 200, week_start: '2026-10-05', pillar: 'strength' },
      { reason: 'training_detailed', amount: 30, week_start: '2026-10-05', pillar: 'strength' },
    ])
  })

  it('drops a check-in deleted while the day is open', async () => {
    const id = await addCheckin(db, A, { day: '2026-10-05' })
    await asUser(db, A, () => db.query('delete from public.checkins where id = $1', [id]))
    await post(A, '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')
    await close()
    expect((await days()).map(d => [d.day, d.checked])).toEqual([['2026-10-06', true]])
    expect((await pillar()).filter(r => r.reason === 'training_day')).toHaveLength(1)
  })

  it('keeps a closed day when its check-in is deleted later', async () => {
    const id = await post(A, '2026-10-05')
    await setClock(db, '2026-10-07T15:00:00Z')
    await close()
    const paid = await pillar()
    await sql(db, 'delete from public.checkins where id = $1', [id])
    await close()
    expect(await days()).toEqual([{ day: '2026-10-05', checked: true, detailed: false, legacy: false }])
    expect(await pillar()).toEqual(paid)
  })

  it('close_all_training_days goes through everyone with pending days', async () => {
    await post(A, '2026-10-05')
    await post(B, '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')
    expect(await sql(db, 'select public.close_all_training_days() as n')).toEqual([{ n: 2 }])
    expect((await days(A)).length + (await days(B)).length).toBe(3)
    expect(await sql(db, 'select public.close_all_training_days() as n')).toEqual([{ n: 0 }])
  })
})

describe('training XP', () => {
  it('pays 870 for seven days with T = 3 and no detail', async () => {
    for (const d of week('2026-10-05')) await post(A, d)
    await setClock(db, '2026-10-13T15:00:00Z')
    await close()
    const rows = await pillar()
    expect(rows.filter(r => r.reason !== 'training_logged').map(r => [r.reason, r.amount])).toEqual([
      ['training_day', 200], ['training_day', 200], ['training_day', 200], ['training_week_target', 150],
      ['training_day_extra', 25], ['training_day_extra', 25],
    ])
    expect(rows.filter(r => r.reason === 'training_logged')).toHaveLength(7)
    expect(sum(rows)).toBe(870)
  })

  it('splits 600 over T days for every T from 1 to 7', async () => {
    for (let t = 1; t <= 7; t++) {
      const uid = `00000000-0000-0000-0000-0000000001${t}0`
      await makeUser(db, uid, { days_per_week: t })
      for (const d of week('2026-10-05')) await post(uid, d)
    }
    await setClock(db, '2026-10-13T15:00:00Z')
    for (let t = 1; t <= 7; t++) {
      const uid = `00000000-0000-0000-0000-0000000001${t}0`
      await close(uid)
      const rows = await pillar(uid)
      const day = rows.filter(r => r.reason === 'training_day').map(r => r.amount)
      const base = Math.round(600 / t)
      expect(day).toEqual([...Array(t - 1).fill(base), 600 - base * (t - 1)])
      expect(rows.filter(r => r.reason === 'training_week_target').map(r => r.amount)).toEqual([150])
      expect(rows.filter(r => r.reason === 'training_day_extra')).toHaveLength(Math.min(2, 7 - t))
      expect(sum(rows)).toBe(600 + 150 + 25 * Math.min(2, 7 - t) + 70)
    }
  })

  it('pays a detailed day 30, three times a week at most', async () => {
    for (const d of week('2026-10-05', 5)) await post(A, d, DETAIL)
    await setClock(db, '2026-10-11T15:00:00Z')
    await close()
    expect((await pillar()).filter(r => r.reason === 'training_detailed').map(r => r.amount)).toEqual([30, 30, 30])
  })

  it('pays a live workout that ends in a check-in once', async () => {
    await event(db, A, 'workout_completed', '2026-10-05', 's1', { sets: 12, hour: 18 })
    await post(A, '2026-10-05', DETAIL)
    await setClock(db, '2026-10-07T15:00:00Z')
    await close()
    expect((await pillar()).map(r => r.reason)).toEqual(['training_logged', 'training_day', 'training_detailed'])
    expect(await days()).toEqual([{ day: '2026-10-05', checked: true, detailed: true, legacy: false }])
  })

  it('after the cutover, a workout alone pays no day; a PR still pays', async () => {
    await event(db, A, 'workout_completed', '2026-10-05', 's1')
    await event(db, A, 'pr', '2026-10-05', 's1:bench')
    expect((await pillar()).map(r => [r.reason, r.amount])).toEqual([['pr', 30]])
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await close()).toBe(0)
    expect(await days()).toEqual([])
  })
})

describe('days before the cutover', () => {
  beforeEach(async () => {
    await setCutoff('2026-10-07')
  })

  it('turn a workout into a legacy day without new XP', async () => {
    await event(db, A, 'workout_completed', '2026-10-05', 's1')
    expect((await pillar()).map(r => [r.reason, r.amount])).toEqual([['workout', 200]])
    await post(A, '2026-10-05')
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await close()).toBe(1)
    expect(await days()).toEqual([{ day: '2026-10-05', checked: true, detailed: false, legacy: true }])
    expect((await pillar()).map(r => [r.reason, r.amount])).toEqual([['workout', 200]])
  })

  it('pay a check-in day without a workout as a training day', async () => {
    await post(A, '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')
    await close()
    expect(await days()).toEqual([{ day: '2026-10-06', checked: true, detailed: false, legacy: false }])
    // A workout of that day arriving later (an old client) pays nothing on top.
    await event(db, A, 'workout_completed', '2026-10-06', 's2')
    expect((await pillar()).map(r => r.reason)).toEqual(['training_logged', 'training_day'])
  })

  it('mark a closed day legacy when its workout arrives late', async () => {
    await post(A, '2026-10-05')
    await setClock(db, '2026-10-08T15:00:00Z')
    await close()   // 2026-10-05 paid by its check-in, 2026-10-06 closed empty
    await event(db, A, 'workout_completed', '2026-10-06', 's2')
    expect((await days()).map(d => [d.day, d.checked, d.legacy])).toEqual([
      ['2026-10-05', true, false], ['2026-10-06', true, true]])
  })

  it('share the week with training days without paying twice', async () => {
    // T = 3: two legacy workouts on Monday and Tuesday, then check-ins after the cutover.
    await event(db, A, 'workout_completed', '2026-10-05', 's1')
    await event(db, A, 'workout_completed', '2026-10-06', 's2')
    for (const d of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']) await post(A, d)
    await setClock(db, '2026-10-13T15:00:00Z')
    await close()
    expect((await pillar()).filter(r => r.reason !== 'training_logged').map(r => [r.reason, r.amount])).toEqual([
      ['workout', 200], ['workout', 200],
      ['training_day', 200], ['training_week_target', 150], ['training_day_extra', 25], ['training_day_extra', 25],
    ])
  })

  it('count for the streak', async () => {
    await sql(db, `update public.profiles set days_per_week = 1, created_at = '2026-10-05T15:00:00Z'`)
    await sql(db, `delete from public.weekly_targets`)
    await event(db, A, 'workout_completed', '2026-10-05', 's1')   // legacy week
    await post(A, '2026-10-13')                                     // next week, by check-in
    await setClock(db, '2026-10-21T15:00:00Z')
    await close()
    expect(await streak()).toEqual({ current: 2, best: 2, shields: 0 })
    expect((await pillar()).map(r => r.reason)).toEqual([
      'workout', 'week_target', 'training_logged', 'training_day', 'training_week_target'])
  })
})

describe('the training_week streak', () => {
  beforeEach(async () => {
    await sql(db, `update public.profiles set days_per_week = 1, created_at = '2026-10-05T15:00:00Z'`)
    await sql(db, `delete from public.weekly_targets`)
  })

  it('grows on weeks met by training_week_target', async () => {
    for (const d of ['2026-10-05', '2026-10-12', '2026-10-19']) await post(A, d)
    await setClock(db, '2026-10-28T15:00:00Z')
    await close()
    expect(await streak()).toEqual({ current: 3, best: 3, shields: 0 })
  })

  it('judges a week only after its seven days closed', async () => {
    await post(A, '2026-10-05')
    await post(A, '2026-10-11')   // Sunday
    await setClock(db, '2026-10-12T15:00:00Z')   // Monday: Saturday and Sunday still open
    await close()
    await sql(db, 'select public.close_weeks($1)', [A])
    expect(await streak()).toMatchObject({ current: 0 })
    expect((await sql(db, `select last_period from public.streaks where user_id = $1 and kind = 'training_week'`, [A]))[0].last_period)
      .toBeNull()
    await setClock(db, '2026-10-13T15:00:00Z')   // Tuesday: Sunday closed
    await close()
    expect(await streak()).toEqual({ current: 1, best: 1, shields: 0 })
  })
})

describe('progress and friends', () => {
  it('counts training days in the week, the metrics and the badges', async () => {
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) await post(A, d)
    await setClock(db, '2026-10-10T15:00:00Z')
    const p = (await asUser(db, A, () => db.query<{ p: any }>('select public.get_my_progress() as p'))).rows[0].p
    expect(p.week).toMatchObject({ workouts: 3, extras: 1, target_hit: true })
    expect(p.stats.workouts).toBe(4)
    expect(p.stats.week_targets).toBe(1)
    expect(p.achievements.map((a: { code: string }) => a.code)).toEqual(
      expect.arrayContaining(['first_workout', 'week_target_1']))
    expect(p.training).toEqual({
      confirms_on: '2026-10-12',
      last_closed: { day: '2026-10-08', detailed: false, xp: 35 },
    })
  })

  it('keeps check-in content out of the public card', async () => {
    await post(A, '2026-10-05', DETAIL)
    await setClock(db, '2026-10-07T15:00:00Z')
    await close()
    await befriend(db, A, B)
    const friends = (await asUser(db, B, () => db.query<{ f: any }>('select public.get_friends() as f'))).rows[0].f
    const card = friends.find((f: { id: string }) => f.id === A).card
    expect(Object.keys(card).sort()).toEqual(['achievements', 'level', 'pillars', 'streak', 'total_xp', 'week'])
    expect(Object.keys(card.week).sort()).toEqual(
      ['extras', 'max', 'pillars', 'prs', 'start', 'target', 'target_hit', 'workouts', 'xp'])
    expect(card.week.workouts).toBe(1)
    const text = JSON.stringify(friends)
    for (const secret of ['Nota privada', 'Legenda', 'bench', 'photo', 'detail', 'training'])
      expect(text).not.toContain(secret)
  })
})

describe('access', () => {
  it('lets a person read only their own training days', async () => {
    await post(A, '2026-10-05')
    await post(B, '2026-10-05')
    await setClock(db, '2026-10-07T15:00:00Z')
    await close(A)
    await close(B)
    const mine = await asUser(db, A, () => db.query('select user_id from public.training_days'))
    expect(mine.rows).toEqual([{ user_id: A }])
    await expect(asUser(db, A, () => db.query(
      `insert into public.training_days (user_id, day, checked, detailed) values ($1, '2026-10-01', true, false)`, [A])))
      .rejects.toThrow(/permission denied/)
  })

  it('keeps the closing functions away from clients', async () => {
    for (const q of [`select public.close_training_days('${A}')`, 'select public.close_all_training_days()'])
      await expect(asUser(db, A, () => db.query(q))).rejects.toThrow(/permission denied/)
  })
})
