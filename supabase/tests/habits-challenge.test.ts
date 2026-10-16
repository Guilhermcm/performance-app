import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'
import { enableSleep, setSleepTarget } from './helpers/sleep'
import { addHabit, checkHabit, closeHabitsAs, enableHabits } from './helpers/habits'

// Phase 4a, Task 5 (0029_habits_challenge.sql, 0030_habits_cron.sql): the habit checks challenge
// (spec 6.5) and the daily close job (spec 6.6). Ana creates on Monday 2026-10-05 in Sao Paulo;
// Bia and Caio are her friends, Duda knows nobody. The pillar is on for the first three from Monday.

let db: PGlite
const HAB = 'habit_checks'

type Args = {
  mode?: string; target?: number; starts_on?: string; ends_on?: string
  invitees?: string[]; share_habits?: boolean
}

// Named parameters, the way the client calls it. Seven days from Monday 2026-10-05, Bia invited.
async function create(uid: string, over: Args = {}): Promise<string> {
  const a = { mode: 'team', target: 5, starts_on: '2026-10-05', ends_on: '2026-10-11', invitees: [B], share_habits: true, ...over }
  const r = await one<{ id: string }>(db, uid,
    `select public.create_challenge(p_template => $1, p_title => 'Todo dia', p_mode => $2, p_target => $3::numeric,
            p_starts_on => $4::date, p_ends_on => $5::date, p_invitees => $6::uuid[],
            p_share_volume => false, p_share_nutrition => false, p_share_sleep => false, p_share_habits => $7) as v`,
    [HAB, a.mode, a.target, a.starts_on, a.ends_on, '{' + a.invitees.join(',') + '}', a.share_habits])
  return r.id
}
const join = (uid: string, id: string, share = true) =>
  rows(db, uid,
    `select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => false, p_share_sleep => false,
            p_share_habits => $2)`,
    [id, share])
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)
const statusOf = async (id: string) => (await sql<{ status: string }>(db, 'select status from public.challenges where id = $1', [id]))[0].status
const closeAll = async () => (await sql<{ n: number }>(db, 'select public.close_all_challenges() as n'))[0].n
const progressByName = (c: { members: { name: string; progress: number | null }[] }) =>
  Object.fromEntries(c.members.map(m => [m.name, m.progress]))
const sharing = (id: string) => sql(db,
  `select user_id, share_habits, share_sleep, share_nutrition, share_volume
     from public.challenge_members where challenge_id = $1 order by user_id`, [id])
// A check on any day, as the database owner (the client only writes today and yesterday).
const check = (uid: string, habit: string, day: string) => checkHabit(db, uid, habit, day, { asOwner: true })
const counted = async (habit: string, day: string) =>
  (await sql<{ counted: boolean | null }>(db,
    'select counted from public.habit_checks where habit_id = $1 and day = $2', [habit, day]))[0].counted

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  for (const u of [A, B, C]) await enableHabits(db, u)
})

describe('creating a habit checks challenge', () => {
  const challengeTemplates = async () =>
    (await sql<{ template: string }>(db, 'select distinct template from public.challenges')).map(r => r.template)

  it('creates valid team and solo challenges', async () => {
    const team = await create(A)
    const solo = await create(A, { mode: 'solo', target: 7 })
    const all = await list(A)
    expect(all.find((x: any) => x.id === team)).toMatchObject({ template: HAB, mode: 'team', target: 5, total: 0, status: 'active' })
    expect(all.find((x: any) => x.id === solo)).toMatchObject({ template: HAB, mode: 'solo', target: 7 })
    // The creator shares the count from the start; the invited person only once they join.
    expect(await sharing(team)).toEqual([
      { user_id: A, share_habits: true, share_sleep: false, share_nutrition: false, share_volume: false },
      { user_id: B, share_habits: false, share_sleep: false, share_nutrition: false, share_volume: false },
    ])
    // The edges of the goal (10 checks a day per person) and of the period.
    await create(A, { mode: 'solo', target: 1 })
    await create(A, { mode: 'solo', target: 140, ends_on: '2026-10-18' })                 // 10 x 14
    await create(A, { mode: 'team', target: 140 })                                        // 10 x 7 x (1 + 1)
    await create(A, { mode: 'team', target: 420, ends_on: '2026-10-18', invitees: [B, C] }) // 140 x (1 + 2)
    await create(A, { mode: 'solo', target: 920, ends_on: '2027-01-04' })                 // 92 days
    expect(await challengeTemplates()).toEqual([HAB])
  })

  it.each([
    { mode: 'solo', target: 141, ends_on: '2026-10-18' },                   // more than 10 x 14 days
    { mode: 'team', target: 421, ends_on: '2026-10-18', invitees: [B, C] }, // 140 x (1 + 2)
    { mode: 'team', target: 141 },                                         // 70 x (1 + 1)
    { target: 0 },
    { target: 2.5 },
    { mode: 'solo', target: 1, ends_on: '2026-10-10' },                     // 6 days
    { mode: 'solo', target: 1, ends_on: '2027-01-05' },                     // 93 days
    { invitees: [] },                                                       // alone
    { mode: 'pairs' },
  ])('refuses targets out of range: %j', async over => {
    await expect(create(A, over)).rejects.toThrow('invalid_challenge')
  })

  it('requires the opt-in to create and to join', async () => {
    await expect(create(A, { share_habits: false })).rejects.toThrow('habits_opt_in_required')
    // The Sleep-era client names the other parameters and never sends p_share_habits.
    await expect(one(db, A,
      `select public.create_challenge(p_template => $1, p_title => 'Todo dia', p_mode => 'team', p_target => 5,
              p_starts_on => '2026-10-05', p_ends_on => '2026-10-11', p_invitees => $2::uuid[],
              p_share_volume => false, p_share_nutrition => false, p_share_sleep => true) as v`, [HAB, '{' + B + '}']))
      .rejects.toThrow('habits_opt_in_required')
    const id = await create(A)
    await expect(join(B, id, false)).rejects.toThrow('habits_opt_in_required')
    await expect(rows(db, B,
      'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => false, p_share_sleep => true)', [id]))
      .rejects.toThrow('habits_opt_in_required')
    await join(B, id)
    expect((await sharing(id)).find(m => m.user_id === B)).toMatchObject({ share_habits: true, share_sleep: false })
  })

  it('requires the pillar on to create and to join', async () => {
    await enableHabits(db, A, false)
    await expect(create(A)).rejects.toThrow('habits_off')
    await enableHabits(db, A)
    const id = await create(A, { invitees: [B, C] })
    await enableHabits(db, C, false)
    await expect(join(C, id)).rejects.toThrow('habits_off')
    await enableHabits(db, C)
    await join(C, id)
  })

  it('waits two days past ends_on', async () => {
    const [r] = await sql(db, `select public.challenge_grace('habit_checks') as g`)
    expect(r.g).toBe(2)
  })
})

describe('habit checks challenge progress', () => {
  it('counts only valid checks of joined members', async () => {
    const id = await create(A, { invitees: [B, C] })
    await join(B, id)
    // Ana reads twice a week: Wednesday's check is past the target and never counts. She runs on
    // Sunday (the last day) and on Monday after the period.
    const read = await addHabit(db, A, { name: 'Ler', perWeek: 2 })
    const run = await addHabit(db, A, { name: 'Correr', perWeek: 7, sort: 1 })
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) await check(A, read, d)
    for (const d of ['2026-10-11', '2026-10-12']) await check(A, run, d)
    // Caio was invited and has not joined.
    const caio = await addHabit(db, C)
    await check(C, caio, '2026-10-06')
    // Bia checks on Tuesday, turns the pillar off on Thursday and still has a check on Friday: a
    // day outside her period never closes, so that check is never counted.
    const bia = await addHabit(db, B)
    await check(B, bia, '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')
    await enableHabits(db, B, false)
    await check(B, bia, '2026-10-09')

    await setClock(db, '2026-10-15T15:00:00Z')   // Ana's Monday is closed too
    for (const u of [A, B, C]) await closeHabitsAs(db, u)
    expect(await counted(read, '2026-10-07')).toBe(false)
    expect(await counted(run, '2026-10-12')).toBe(true)
    expect(await counted(bia, '2026-10-09')).toBe(null)
    // Live progress, as get_challenges shows it while the challenge is active.
    const [{ v: c }] = await sql<{ v: any }>(db, 'select public.challenge_json($1, $2) as v', [id, A])
    expect(progressByName(c)).toEqual({ Ana: 3, Bia: 1, Caio: null })
    expect(c.total).toBe(4)
  })

  it('shows only the count in the payload', async () => {
    const id = await create(A)
    await join(B, id)
    const habit = await addHabit(db, A, { name: 'Meditar', icon: 'lotus' })
    await check(A, habit, '2026-10-06')
    await check(A, habit, '2026-10-07')
    await setClock(db, '2026-10-09T15:00:00Z')
    await closeHabitsAs(db, A)
    const [c] = await list(B)
    expect(Object.keys(c).sort()).toEqual(
      ['created_by', 'ends_on', 'id', 'invited_by', 'me', 'members', 'mode', 'starts_on', 'status', 'target', 'template', 'title', 'total'])
    for (const m of c.members) {
      expect(Object.keys(m).sort()).toEqual(['avatar_url', 'id', 'joined', 'me', 'name', 'progress', 'won'])
      expect(typeof m.progress).toBe('number')
    }
    expect(progressByName(c)).toEqual({ Ana: 2, Bia: 0 })
    const text = JSON.stringify(c)
    for (const leak of ['Meditar', 'lotus', habit, 'habit_id', 'icon', 'counted', '2026-10-06', '2026-10-07']) {
      expect(text, leak).not.toContain(leak)
    }
    expect(await rows(db, B, 'select * from public.habits where user_id = $1', [A])).toEqual([])
    expect(await rows(db, B, 'select * from public.habit_checks where user_id = $1', [A])).toEqual([])
    expect(await rows(db, B, 'select * from public.habit_days where user_id = $1', [A])).toEqual([])
  })
})

describe('closing a habit checks challenge', () => {
  // Ana checks on Monday, Tuesday and the last two days; Bia on Wednesday and Thursday. Nobody's
  // days are closed before the challenge closes them.
  async function checkAll() {
    const ana = await addHabit(db, A)
    const bia = await addHabit(db, B)
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-10', '2026-10-11']) await check(A, ana, d)
    for (const d of ['2026-10-07', '2026-10-08']) await check(B, bia, d)
    return ana
  }

  it('closes at ends_on + 3 after closing pending days', async () => {
    const id = await create(A, { target: 6 })
    await join(B, id)
    const ana = await checkAll()
    await setClock(db, '2026-10-12T15:00:00Z')   // ends_on + 1
    await list(A)
    expect(await closeAll()).toBe(0)
    await setClock(db, '2026-10-14T02:59:00Z')   // 23:59 on ends_on + 2 in Sao Paulo
    await list(B)
    expect(await closeAll()).toBe(0)
    expect(await statusOf(id)).toBe('active')
    expect(await counted(ana, '2026-10-11')).toBe(null)
    await setClock(db, '2026-10-14T03:01:00Z')   // 00:01 on ends_on + 3
    expect(await closeAll()).toBe(1)
    expect(await statusOf(id)).toBe('won')
    // The last two days were closed by the challenge before the result.
    expect(await counted(ana, '2026-10-10')).toBe(true)
    expect(await counted(ana, '2026-10-11')).toBe(true)
    const [c] = await list(B)
    expect(c).toMatchObject({ status: 'won', total: 6, me: { joined: true, won: true } })
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 4, true], ['Bia', 2, true]])
    const last = await sql(db,
      `select to_char(max(day), 'YYYY-MM-DD') as d from public.habit_days where user_id = $1`, [A])
    expect(last[0].d).toBe('2026-10-12')
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([300])
  })

  it('pays only who reached the goal in solo', async () => {
    const id = await create(A, { mode: 'solo', target: 3 })
    await join(B, id)
    await checkAll()
    await setClock(db, '2026-10-14T15:00:00Z')
    const [c] = await list(A)
    expect(c.status).toBe('won')
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 4, true], ['Bia', 2, false]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([])
  })
})

describe('signatures', () => {
  it('leaves one create_challenge and one join_challenge', async () => {
    const [r] = await sql(db,
      `select (select count(*)::int from pg_proc where proname = 'create_challenge') as c,
              (select count(*)::int from pg_proc where proname = 'join_challenge') as j`)
    expect(r).toEqual({ c: 1, j: 1 })
    // By oid, like sleep-challenge: the signature grows with each pillar.
    const g = await sql(db,
      `select proname, has_function_privilege('authenticated', oid, 'execute') as signed_in,
              has_function_privilege('anon', oid, 'execute') as anon
         from pg_proc where proname in ('create_challenge', 'join_challenge') order by proname`)
    expect(g).toEqual([
      { proname: 'create_challenge', signed_in: true, anon: false },
      { proname: 'join_challenge', signed_in: true, anon: false },
    ])

    // The Sleep-era client names its parameters and does not know p_share_habits: it keeps working.
    for (const u of [A, B]) {
      await enableSleep(db, u)
      await setSleepTarget(db, u, '2026-10-05', 480, '23:00')
    }
    const { id } = await one<{ id: string }>(db, A,
      `select public.create_challenge(p_template => 'sleep_nights_on_target', p_title => 'Dormir bem', p_mode => 'team',
              p_target => 5, p_starts_on => '2026-10-05', p_ends_on => '2026-10-11', p_invitees => $1::uuid[],
              p_share_volume => false, p_share_nutrition => false, p_share_sleep => true) as v`, ['{' + B + '}'])
    await rows(db, B,
      'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => false, p_share_sleep => true)', [id])
    expect(await sharing(id)).toEqual([
      { user_id: A, share_habits: false, share_sleep: true, share_nutrition: false, share_volume: false },
      { user_id: B, share_habits: false, share_sleep: true, share_nutrition: false, share_volume: false },
    ])
  })
})

describe('close-habit-days job (0030)', () => {
  const CRON = new URL('../migrations/0030_habits_cron.sql', import.meta.url)

  it('schedules nothing without pg_cron', async () => {
    await db.exec(readFileSync(CRON, 'utf8'))
    expect(await sql(db, `select count(*)::int as n from pg_extension where extname = 'pg_cron'`)).toEqual([{ n: 0 }])
  })

  it('runs close_all_habit_days daily at 06:50 UTC', () => {
    expect(readFileSync(CRON, 'utf8')).toContain(
      "cron.schedule('close-habit-days', '50 6 * * *', 'select public.close_all_habit_days()')")
  })
})
