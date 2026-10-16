import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { rows } from './helpers/social'
import { H, addHabit, archiveHabit, checkHabit, enableHabits, setHabitTarget, targetOf } from './helpers/habits'

let db: PGlite
const periods = (uid: string) =>
  sql(db, `select to_char(started_on, 'YYYY-MM-DD') as started_on, to_char(ended_on, 'YYYY-MM-DD') as ended_on
             from public.habit_periods where user_id = $1 order by started_on`, [uid])
const activeOn = async (uid: string, day: string) =>
  (await sql<{ v: boolean }>(db, 'select public.habits_active_on($1, $2) as v', [uid, day]))[0].v
const freeze = (uid: string, week: string) => sql(db, 'select public.freeze_habit_targets($1, $2)', [uid, week])
const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))
const habit = async (id: string) =>
  (await sql(db, 'select name, per_week, archived_at is not null as archived from public.habits where id = $1', [id]))[0]
// The 14-day window of activity_events reads the real clock, so the client case uses the real
// local today rather than the pinned one.
const realToday = async () =>
  (await sql<{ d: string }>(db, `select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`))[0].d

const WEEK = '2026-10-05'
const NEXT = '2026-10-12'

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A)
})

describe('habit periods', () => {
  it('opens, closes and reopens periods like sleep', async () => {
    const [p] = await sql(db, 'select habits_enabled from public.profiles where id = $1', [A])
    expect(p.habits_enabled).toBe(false)
    expect(await periods(A)).toEqual([])

    await enableHabits(db, A)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
    await enableHabits(db, A)   // already on: nothing changes
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])

    await setClock(db, '2026-10-09T15:00:00Z')   // Friday
    await enableHabits(db, A, false)
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: '2026-10-08' }])
    expect(await activeOn(A, '2026-10-08')).toBe(true)
    expect(await activeOn(A, '2026-10-09')).toBe(false)
    expect(await activeOn(A, '2026-10-06')).toBe(false)

    await enableHabits(db, A)   // back on the same day: the same period continues
    expect(await periods(A)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
    expect(await activeOn(A, '2026-10-20')).toBe(true)

    // Turned on and off the same day: the period covers no day.
    await setClock(db, '2026-10-07T15:00:00Z')
    await makeUser(db, H)
    await enableHabits(db, H)
    await enableHabits(db, H, false)
    expect(await periods(H)).toEqual([{ started_on: '2026-10-07', ended_on: '2026-10-06' }])
    expect(await activeOn(H, '2026-10-07')).toBe(false)
  })

  it('opens a period when a profile is created with the pillar on', async () => {
    await makeUser(db, B, { habits_enabled: true })
    expect(await periods(B)).toEqual([{ started_on: '2026-10-07', ended_on: null }])
  })

  it('lets clients read but not write periods and targets', async () => {
    await enableHabits(db, A)
    const h = await addHabit(db, A)
    await expect(asA(`insert into public.habit_periods (user_id, started_on) values ($1, '2026-01-01')`, [A]))
      .rejects.toThrow(/permission denied/)
    await expect(asA('update public.habit_periods set ended_on = null')).rejects.toThrow(/permission denied/)
    await expect(asA('delete from public.habit_periods')).rejects.toThrow(/permission denied/)
    await expect(asA(`insert into public.habit_targets (habit_id, user_id, week_start, target) values ($1, $2, $3, 1)`,
      [h, A, NEXT])).rejects.toThrow(/permission denied/)
    await expect(asA('update public.habit_targets set target = 7')).rejects.toThrow(/permission denied/)
    await expect(asA('delete from public.habit_targets')).rejects.toThrow(/permission denied/)
    expect(await targetOf(db, h, WEEK)).toBe(5)

    expect(await rows(db, A, 'select * from public.habit_periods')).toHaveLength(1)
    expect(await rows(db, A, 'select * from public.habit_targets')).toHaveLength(1)
    await makeUser(db, B)
    expect(await rows(db, B, 'select * from public.habit_periods')).toEqual([])
    expect(await rows(db, B, 'select * from public.habit_targets')).toEqual([])
    await expect(rows(db, null, 'select * from public.habit_periods')).rejects.toThrow(/permission denied/)
    await expect(rows(db, null, 'select * from public.habit_targets')).rejects.toThrow(/permission denied/)
  })

  it('keeps the internal functions closed to clients', async () => {
    await expect(asA(`select public.habits_active_on($1, '2026-10-07')`, [A])).rejects.toThrow(/permission denied/)
    await expect(asA('select public.habit_days_left($1)', [A])).rejects.toThrow(/permission denied/)
    await expect(asA('select public.freeze_habit_targets($1, $2)', [A, NEXT])).rejects.toThrow(/permission denied/)
  })

  it('refuses habit server-only kinds from clients', async () => {
    const today = await realToday()
    const insertKind = (kind: string) =>
      db.query(
        `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
         values ($1, 'habits', $2, $3, $4)`, [A, kind, today, `habits:${today}`])
    const kinds = await sql(db, `select kind, server_only from public.event_kinds where pillar = 'habits' order by kind`)
    expect(kinds).toEqual([
      { kind: 'habit_check', server_only: true },
      { kind: 'habit_day', server_only: true },
      { kind: 'habit_week_target', server_only: true },
    ])
    for (const kind of ['habit_check', 'habit_day', 'habit_week_target']) {
      await expect(asUser(db, A, () => insertKind(kind))).rejects.toThrow(/row-level security/)
      await expect(asUser(db, A, async () => {
        await db.exec('begin')
        try {
          await db.query(`select set_config('perf.server_write', 'on', true)`)
          await insertKind(kind)
        } finally {
          await db.exec('rollback')
        }
      })).rejects.toThrow(/row-level security/)
    }
  })
})

describe('habits', () => {
  it('checks the habit columns', async () => {
    for (const name of [' Ler', 'Ler ', '', 'x'.repeat(41)]) {
      await expect(addHabit(db, A, { name })).rejects.toThrow(/check/)
    }
    for (const icon of ['Book', '1book', 'book_open', '']) {
      await expect(addHabit(db, A, { icon })).rejects.toThrow(/check/)
    }
    for (const perWeek of [0, 8]) {
      await expect(addHabit(db, A, { perWeek })).rejects.toThrow(/check/)
    }
    await addHabit(db, A, { name: 'x'.repeat(40), icon: 'piggy-bank', perWeek: 1 })
    await addHabit(db, A, { name: 'Ler', perWeek: 7 })
    await addHabit(db, A, { name: 'Ler' })
    expect(await sql(db, `select 1 from public.habits where user_id = $1 and name = 'Ler'`, [A])).toHaveLength(2)
  })

  it('refuses the 21st active habit', async () => {
    const ids: string[] = []
    for (let i = 0; i < 20; i++) ids.push(await addHabit(db, A, { name: `H${i}`, sort: i }))
    await expect(addHabit(db, A, { name: 'H20' })).rejects.toThrow(/too_many_habits/)
    // An archived one may still be written, and another person has their own 20.
    await asA(`insert into public.habits (id, name, icon, per_week, archived_at)
               values (gen_random_uuid(), 'Old', 'book', 7, now())`)
    await makeUser(db, B)
    await addHabit(db, B)

    await archiveHabit(db, A, ids[0])
    const extra = await addHabit(db, A, { name: 'H20' })
    await expect(archiveHabit(db, A, ids[0], false)).rejects.toThrow(/too_many_habits/)
    // Re-sending an active habit that already exists is not a new one.
    await asA(`insert into public.habits (id, name, icon, per_week) values ($1, 'H20 bis', 'book', 7)
               on conflict (id) do update set name = excluded.name, updated_at = excluded.updated_at`, [extra])
    expect((await habit(extra)).name).toBe('H20 bis')
    const [{ n }] = await sql<{ n: number }>(db,
      'select count(*)::int as n from public.habits where user_id = $1 and archived_at is null', [A])
    expect(n).toBe(20)
    await archiveHabit(db, A, extra)
    await archiveHabit(db, A, ids[0], false)
    expect((await habit(ids[0])).archived).toBe(false)
  })

  it('never deletes a habit and never moves it to another person', async () => {
    await makeUser(db, B)
    const h = await addHabit(db, A)
    await expect(asA('delete from public.habits where id = $1', [h])).rejects.toThrow(/permission denied/)
    expect(await habit(h)).toBeDefined()
    await expect(asA('update public.habits set user_id = $1 where id = $2', [B, h])).rejects.toThrow(/item_immutable/)
    await expect(sql(db, 'update public.habits set user_id = $1 where id = $2', [B, h])).rejects.toThrow(/item_immutable/)

    expect(await rows(db, B, 'select * from public.habits')).toEqual([])
    expect(await rows(db, B, `update public.habits set name = 'Meu' where id = $1 returning 1`, [h])).toEqual([])
    await expect(rows(db, B, `insert into public.habits (id, user_id, name, icon, per_week)
                              values (gen_random_uuid(), $1, 'Teu', 'book', 3)`, [A])).rejects.toThrow(/row-level security/)
    await expect(rows(db, null, 'select * from public.habits')).rejects.toThrow(/permission denied/)
    expect(await habit(h)).toMatchObject({ name: 'Ler' })
    expect(await sql(db, 'select 1 from public.habits where user_id = $1', [A])).toHaveLength(1)
  })

  it('never moves created_at, which the freezing reads', async () => {
    const createdAt = async (id: string) =>
      (await sql(db, `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as c
                        from public.habits where id = $1`, [id]))[0].c
    // A client dating a habit in the future gets the clock instead; the past is kept.
    const future = await addHabit(db, A, { createdAt: '2026-12-01T12:00:00Z' })
    expect(await createdAt(future)).toBe('2026-10-07 15:00')
    const past = await addHabit(db, A, { createdAt: '2026-09-20T12:00:00Z' })
    expect(await createdAt(past)).toBe('2026-09-20 12:00')
    // An update, or an upsert from the queue, cannot change it.
    await asA(`update public.habits set created_at = '2026-01-01T00:00:00Z', name = 'Correr' where id = $1`, [past])
    await asA(`insert into public.habits (id, name, icon, per_week, created_at) values ($1, 'Ler', 'book', 7, '2026-12-01T00:00:00Z')
               on conflict (id) do update set name = excluded.name, created_at = excluded.created_at`, [past])
    expect(await createdAt(past)).toBe('2026-09-20 12:00')
    expect((await habit(past)).name).toBe('Ler')
  })

  it('keeps the newest write', async () => {
    const h = await addHabit(db, A)
    const upsert = (name: string, at: string) =>
      asA(`insert into public.habits (id, name, icon, per_week, updated_at) values ($1, $2, 'book', 7, $3)
           on conflict (id) do update set name = excluded.name, icon = excluded.icon, per_week = excluded.per_week,
             sort = excluded.sort, archived_at = excluded.archived_at, updated_at = excluded.updated_at`, [h, name, at])
    await upsert('Velho', '2000-01-01T00:00:00Z')
    expect((await habit(h)).name).toBe('Ler')
    await upsert('Novo', new Date(Date.now() + 60_000).toISOString())
    expect((await habit(h)).name).toBe('Novo')
    const [r] = await sql(db, 'select updated_at <= now() as ok from public.habits where id = $1', [h])
    expect(r.ok).toBe(true)
    await upsert('Mais novo', new Date(Date.now() + 86_400_000 * 30).toISOString())
    expect((await habit(h)).name).toBe('Mais novo')
    const [r2] = await sql(db, 'select updated_at <= now() as ok from public.habits where id = $1', [h])
    expect(r2.ok).toBe(true)
  })
})

describe('weekly targets', () => {
  it('gives a habit created mid-week the days left', async () => {
    const seven = await addHabit(db, A, { perWeek: 7 })
    const three = await addHabit(db, A, { perWeek: 3 })
    expect(await targetOf(db, seven, WEEK)).toBe(5)
    expect(await targetOf(db, three, WEEK)).toBe(3)
    expect(await sql(db, 'select public.habit_days_left($1) as n', [A])).toEqual([{ n: 5 }])
    await setClock(db, '2026-10-11T15:00:00Z')   // Sunday
    const sunday = await addHabit(db, A, { perWeek: 5 })
    expect(await targetOf(db, sunday, WEEK)).toBe(1)
    // A habit that reaches the server already archived (created and archived offline) has no week.
    await asA(`insert into public.habits (id, name, icon, per_week, archived_at)
               values (gen_random_uuid(), 'Arquivado', 'book', 4, now())`)
    expect(await sql(db, `select 1 from public.habit_targets t join public.habits h on h.id = t.habit_id
                           where h.name = 'Arquivado'`)).toEqual([])
    expect(await sql(db, 'select 1 from public.habit_targets')).toHaveLength(3)
  })

  it('applies a new N from next week', async () => {
    await setClock(db, '2026-09-28T15:00:00Z')   // the Monday before
    const h = await addHabit(db, A, { perWeek: 3 })
    expect(await targetOf(db, h, '2026-09-28')).toBe(3)
    await setClock(db, '2026-10-07T15:00:00Z')
    expect(await targetOf(db, h, WEEK)).toBeNull()   // nothing touched the week yet
    await asA('update public.habits set per_week = 5 where id = $1', [h])
    expect(await targetOf(db, h, WEEK)).toBe(3)
    await asA('update public.habits set per_week = 6 where id = $1', [h])
    expect(await targetOf(db, h, WEEK)).toBe(3)
    await freeze(A, NEXT)
    expect(await targetOf(db, h, NEXT)).toBe(6)
    expect(await targetOf(db, h, '2026-09-28')).toBe(3)
  })

  it('lowers the target when archived mid-week', async () => {
    await setClock(db, '2026-09-28T15:00:00Z')
    const done2 = await addHabit(db, A, { perWeek: 5 })
    await setClock(db, '2026-10-07T15:00:00Z')
    const none = await addHabit(db, A, { perWeek: 5 })
    await checkHabit(db, A, done2, '2026-10-04', { asOwner: true })   // the week before
    await checkHabit(db, A, done2, '2026-10-05', { asOwner: true })
    await checkHabit(db, A, done2, '2026-10-06', { asOwner: true })
    await checkHabit(db, A, none, '2026-10-04', { asOwner: true })
    await archiveHabit(db, A, done2)
    await archiveHabit(db, A, none)
    expect(await targetOf(db, done2, WEEK)).toBe(2)
    expect(await targetOf(db, none, WEEK)).toBe(0)
    await freeze(A, NEXT)
    expect(await sql(db, 'select 1 from public.habit_targets where week_start = $1', [NEXT])).toEqual([])
    // Editing an archived habit leaves its weeks alone.
    await asA(`update public.habits set name = 'Outro', per_week = 7 where id = $1`, [none])
    expect(await sql(db, 'select target from public.habit_targets where habit_id = $1', [none])).toEqual([{ target: 0 }])
  })

  it('treats reactivation as creation and never lowers a target', async () => {
    const h = await addHabit(db, A, { perWeek: 5 })
    await checkHabit(db, A, h, '2026-10-05', { asOwner: true })
    await checkHabit(db, A, h, '2026-10-06', { asOwner: true })
    await archiveHabit(db, A, h)
    expect(await targetOf(db, h, WEEK)).toBe(2)
    await setClock(db, '2026-10-08T15:00:00Z')   // Thursday
    await archiveHabit(db, A, h, false)
    expect(await targetOf(db, h, WEEK)).toBe(4)

    const sat1 = await addHabit(db, A, { perWeek: 7 })
    const sat2 = await addHabit(db, A, { perWeek: 7 })
    await setClock(db, '2026-10-10T15:00:00Z')   // Saturday
    await checkHabit(db, A, sat1, '2026-10-10', { asOwner: true })
    await checkHabit(db, A, sat2, '2026-10-09', { asOwner: true })
    await checkHabit(db, A, sat2, '2026-10-10', { asOwner: true })
    await archiveHabit(db, A, sat1)
    await archiveHabit(db, A, sat2)
    expect(await targetOf(db, sat1, WEEK)).toBe(1)
    expect(await targetOf(db, sat2, WEEK)).toBe(2)
    await setClock(db, '2026-10-11T15:00:00Z')   // Sunday: one day left
    await archiveHabit(db, A, sat1, false)
    await archiveHabit(db, A, sat2, false)
    expect(await targetOf(db, sat1, WEEK)).toBe(1)
    expect(await targetOf(db, sat2, WEEK)).toBe(2)

    // Reactivated in a later week with no row yet: as if created that day, with the new N.
    await archiveHabit(db, A, sat1)
    await setClock(db, '2026-10-14T15:00:00Z')   // the next Wednesday
    await asA('update public.habits set archived_at = null, per_week = 3 where id = $1', [sat1])
    expect(await targetOf(db, sat1, NEXT)).toBe(3)
  })

  it('freezes only missing targets for habits active on Monday', async () => {
    await makeUser(db, B)
    const old = await addHabit(db, A, { perWeek: 4, createdAt: '2026-09-20T15:00:00Z' })
    const now = await addHabit(db, A, { perWeek: 6 })
    const kept = await addHabit(db, A, { perWeek: 5 })
    await setHabitTarget(db, kept, A, NEXT, 2)
    const gone = await addHabit(db, A, { perWeek: 3 })
    await archiveHabit(db, A, gone)
    // 13 Oct 02:00 UTC is still Monday the 12th in Sao Paulo; 13 Oct 12:00 UTC is Tuesday.
    const lateMonday = await addHabit(db, A, { perWeek: 2, createdAt: '2026-10-13T02:00:00Z', asOwner: true })
    const tuesday = await addHabit(db, A, { perWeek: 2, createdAt: '2026-10-13T12:00:00Z', asOwner: true })
    const theirs = await addHabit(db, B, { perWeek: 7 })

    await freeze(A, NEXT)
    expect(await targetOf(db, old, NEXT)).toBe(4)
    expect(await targetOf(db, now, NEXT)).toBe(6)
    expect(await targetOf(db, kept, NEXT)).toBe(2)
    expect(await targetOf(db, gone, NEXT)).toBeNull()
    expect(await targetOf(db, lateMonday, NEXT)).toBe(2)
    expect(await targetOf(db, tuesday, NEXT)).toBeNull()
    expect(await targetOf(db, theirs, NEXT)).toBeNull()
    // The running week keeps what creation gave it.
    await freeze(A, WEEK)
    expect(await targetOf(db, now, WEEK)).toBe(5)
    expect(await targetOf(db, old, WEEK)).toBe(4)
  })
})
