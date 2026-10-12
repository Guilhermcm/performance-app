import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { C, D, befriend, one, rows } from './helpers/social'
import { enableNutrition } from './helpers/nutrition'
import { enableSleep, logNight, setSleepTarget } from './helpers/sleep'

// Phase 3, Task 5 (0024_sleep_challenge.sql, 0025_sleep_cron.sql): the sleep nights challenge
// (spec 6.6) and the nightly close job (spec 6.7). Ana creates on Monday 2026-10-05 in Sao Paulo;
// Bia and Caio are her friends, Duda knows nobody. The pillar is on for the first three, with an
// 8 h target and a 23:00 bedtime from Monday.

let db: PGlite
const SLEEP = 'sleep_nights_on_target'

type Args = {
  mode?: string; target?: number; starts_on?: string; ends_on?: string
  invitees?: string[]; share_sleep?: boolean
}

// Named parameters, the way the client calls it. Seven days from Monday 2026-10-05, Bia invited.
async function create(uid: string, over: Args = {}): Promise<string> {
  const a = { mode: 'team', target: 5, starts_on: '2026-10-05', ends_on: '2026-10-11', invitees: [B], share_sleep: true, ...over }
  const r = await one<{ id: string }>(db, uid,
    `select public.create_challenge(p_template => $1, p_title => 'Dormir bem', p_mode => $2, p_target => $3::numeric,
            p_starts_on => $4::date, p_ends_on => $5::date, p_invitees => $6::uuid[],
            p_share_volume => false, p_share_nutrition => false, p_share_sleep => $7) as v`,
    [SLEEP, a.mode, a.target, a.starts_on, a.ends_on, '{' + a.invitees.join(',') + '}', a.share_sleep])
  return r.id
}
const join = (uid: string, id: string, share = true) =>
  rows(db, uid,
    'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => false, p_share_sleep => $2)',
    [id, share])
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)
const statusOf = async (id: string) => (await sql<{ status: string }>(db, 'select status from public.challenges where id = $1', [id]))[0].status
const closeAll = async () => (await sql<{ n: number }>(db, 'select public.close_all_challenges() as n'))[0].n
const progressByName = (c: { members: { name: string; progress: number | null }[] }) =>
  Object.fromEntries(c.members.map(m => [m.name, m.progress]))
const sharing = (id: string) => sql(db,
  'select user_id, share_sleep, share_nutrition, share_volume from public.challenge_members where challenge_id = $1 order by user_id', [id])

// A night logged as the owner (any past night), on target by default: 23:00 to 07:00 is 8 h.
const sleep = (uid: string, night: string, bed = '23:00', wake = '07:00', quality: number | null = null, note: string | null = null) =>
  logNight(db, uid, night, bed, wake, { asOwner: true, quality, note })
// A closed night straight into sleep_nights, as the server would leave it.
const closedNight = (uid: string, night: string, onTarget = true) =>
  sql(db,
    `insert into public.sleep_nights (user_id, night, target, logged, duration_min, bed_diff_min, quality, on_target, rested)
     values ($1, $2, '{"goal_min": 480, "bed_target": "23:00"}', true, 480, 0, null, $3, false)`, [uid, night, onTarget])

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  for (const u of [A, B, C]) {
    await enableSleep(db, u)
    await setSleepTarget(db, u, '2026-10-05', 480, '23:00')
  }
})

describe('creating a sleep challenge', () => {
  const challengeTemplates = async () =>
    (await sql<{ template: string }>(db, 'select distinct template from public.challenges')).map(r => r.template)

  it('creates valid team and solo challenges', async () => {
    const team = await create(A)
    const solo = await create(A, { mode: 'solo', target: 7 })
    const all = await list(A)
    expect(all.find((x: any) => x.id === team)).toMatchObject({ template: SLEEP, mode: 'team', target: 5, total: 0, status: 'active' })
    expect(all.find((x: any) => x.id === solo)).toMatchObject({ template: SLEEP, mode: 'solo', target: 7 })
    // The creator shares the count from the start; the invited person only once they join.
    expect(await sharing(team)).toEqual([
      { user_id: A, share_sleep: true, share_nutrition: false, share_volume: false },
      { user_id: B, share_sleep: false, share_nutrition: false, share_volume: false },
    ])
    // The edges of the goal and of the period.
    await create(A, { mode: 'solo', target: 1 })
    await create(A, { mode: 'team', target: 14 })
    await create(A, { mode: 'team', target: 21, invitees: [B, C] })
    await create(A, { mode: 'solo', target: 92, ends_on: '2027-01-04' })   // 92 days
    expect(await challengeTemplates()).toEqual([SLEEP])
  })

  it.each([
    { mode: 'solo', target: 8 },                                 // more than the 7 days
    { mode: 'team', target: 15 },                                // 7 x (1 + 1)
    { mode: 'team', target: 22, invitees: [B, C] },              // 7 x (1 + 2)
    { target: 0 },
    { target: 2.5 },
    { mode: 'solo', target: 1, ends_on: '2026-10-10' },          // 6 days
    { mode: 'solo', target: 1, ends_on: '2027-01-05' },          // 93 days
    { invitees: [] },                                            // alone
    { mode: 'pairs' },
  ])('refuses targets out of range: %j', async over => {
    await expect(create(A, over)).rejects.toThrow('invalid_challenge')
  })

  it('requires the opt-in to create and to join', async () => {
    await expect(create(A, { share_sleep: false })).rejects.toThrow('sleep_opt_in_required')
    // A client of 2b names the other parameters and never sends p_share_sleep.
    await expect(one(db, A,
      `select public.create_challenge(p_template => $1, p_title => 'Dormir bem', p_mode => 'team', p_target => 5,
              p_starts_on => '2026-10-05', p_ends_on => '2026-10-11', p_invitees => $2::uuid[],
              p_share_volume => false, p_share_nutrition => true) as v`, [SLEEP, '{' + B + '}']))
      .rejects.toThrow('sleep_opt_in_required')
    const id = await create(A)
    await expect(join(B, id, false)).rejects.toThrow('sleep_opt_in_required')
    await expect(rows(db, B, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => true)', [id]))
      .rejects.toThrow('sleep_opt_in_required')
    await join(B, id)
    expect((await sharing(id)).find(m => m.user_id === B)).toMatchObject({ share_sleep: true, share_nutrition: false })
  })

  it('requires the pillar on to create and to join', async () => {
    await enableSleep(db, A, false)
    await expect(create(A)).rejects.toThrow('sleep_off')
    await enableSleep(db, A)
    const id = await create(A, { invitees: [B, C] })
    await enableSleep(db, C, false)
    await expect(join(C, id)).rejects.toThrow('sleep_off')
    await enableSleep(db, C)
    await join(C, id)
  })

  it('waits two days past ends_on', async () => {
    const [r] = await sql(db, `select public.challenge_grace('sleep_nights_on_target') as g`)
    expect(r.g).toBe(2)
  })
})

describe('sleep challenge progress', () => {
  it('counts nights on target in the period of joined members only', async () => {
    const id = await create(A, { invitees: [B, C] })
    await join(B, id)
    await closedNight(A, '2026-10-04')                 // before the period
    await closedNight(A, '2026-10-05')
    await closedNight(A, '2026-10-06', false)          // closed, off target
    await closedNight(A, '2026-10-11')
    await closedNight(A, '2026-10-12')                 // after the period
    await closedNight(C, '2026-10-06')                 // invited, has not joined
    // Bia sleeps on target on Tuesday, turns the pillar off on Thursday and still logs Friday: a
    // night outside her period never closes, so it does not exist and cannot count.
    await sleep(B, '2026-10-06')
    await setClock(db, '2026-10-08T15:00:00Z')
    await enableSleep(db, B, false)
    await sleep(B, '2026-10-09')
    await setClock(db, '2026-10-13T15:00:00Z')         // ends_on + 2: still open
    await sql(db, 'select public.close_sleep_nights($1)', [B])
    const nights = await sql<{ night: string }>(db,
      `select to_char(night, 'YYYY-MM-DD') as night from public.sleep_nights where user_id = $1 order by night`, [B])
    expect(nights.map(n => n.night)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
    const [c] = await list(A)
    expect(c.status).toBe('active')
    expect(progressByName(c)).toEqual({ Ana: 2, Bia: 1, Caio: null })
    expect(c.total).toBe(3)
  })

  it('shows only the count in the payload', async () => {
    const id = await create(A)
    await join(B, id)
    await sleep(A, '2026-10-05', '22:50', '07:05', 5, 'Sonho estranho')
    await sleep(A, '2026-10-06', '01:10', '06:20', 1, 'Acordei cedo')
    await setClock(db, '2026-10-08T15:00:00Z')
    await sql(db, 'select public.close_sleep_nights($1)', [A])
    const [c] = await list(B)
    expect(Object.keys(c).sort()).toEqual(
      ['created_by', 'ends_on', 'id', 'invited_by', 'me', 'members', 'mode', 'starts_on', 'status', 'target', 'template', 'title', 'total'])
    for (const m of c.members) {
      expect(Object.keys(m).sort()).toEqual(['avatar_url', 'id', 'joined', 'me', 'name', 'progress', 'won'])
      expect(typeof m.progress).toBe('number')
    }
    expect(progressByName(c)).toEqual({ Ana: 1, Bia: 0 })
    const text = JSON.stringify(c)
    for (const leak of ['22:50', '07:05', '01:10', '06:20', 'Sonho', 'Acordei', 'quality', 'duration', 'bed', 'note']) {
      expect(text, leak).not.toContain(leak)
    }
    // The minutes slept (495 and 310) are nowhere among the members either.
    for (const leak of ['495', '310']) expect(JSON.stringify(c.members), leak).not.toContain(leak)
    expect(await rows(db, B, 'select * from public.sleep_nights where user_id = $1', [A])).toEqual([])
    expect(await rows(db, B, 'select * from public.sleep_logs where user_id = $1', [A])).toEqual([])
  })
})

describe('closing a sleep challenge', () => {
  // Ana on target on Monday, Tuesday and the last two days; Bia on Wednesday and Thursday. Nobody's
  // nights are closed before the challenge closes them.
  async function sleepAll() {
    for (const n of ['2026-10-05', '2026-10-06', '2026-10-10', '2026-10-11']) await sleep(A, n)
    await sleep(A, '2026-10-08', '02:00', '07:00')   // off target
    for (const n of ['2026-10-07', '2026-10-08']) await sleep(B, n)
  }

  it('closes at ends_on + 2 after closing pending nights', async () => {
    const id = await create(A, { target: 6 })
    await join(B, id)
    await sleepAll()
    await setClock(db, '2026-10-12T15:00:00Z')   // ends_on + 1
    await list(A)
    expect(await closeAll()).toBe(0)
    await setClock(db, '2026-10-14T02:59:00Z')   // 23:59 on ends_on + 2 in Sao Paulo
    await list(B)
    expect(await closeAll()).toBe(0)
    expect(await statusOf(id)).toBe('active')
    await setClock(db, '2026-10-14T03:01:00Z')   // 00:01 on ends_on + 3
    expect(await closeAll()).toBe(1)
    expect(await statusOf(id)).toBe('won')
    // The last two nights were closed by the challenge before the result.
    const [c] = await list(B)
    expect(c).toMatchObject({ status: 'won', total: 6, me: { joined: true, won: true } })
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 4, true], ['Bia', 2, true]])
    const last = await sql(db,
      `select to_char(max(night), 'YYYY-MM-DD') as n from public.sleep_nights where user_id = $1`, [A])
    expect(last[0].n).toBe('2026-10-12')
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([300])
  })

  it('pays only who reached the goal in solo', async () => {
    const id = await create(A, { mode: 'solo', target: 3 })
    await join(B, id)
    await sleepAll()
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
    const [g] = await sql(db,
      `select has_function_privilege('authenticated', 'public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean, boolean)', 'execute') as ca,
              has_function_privilege('anon', 'public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean, boolean)', 'execute') as cn,
              has_function_privilege('authenticated', 'public.join_challenge(uuid, boolean, boolean, boolean)', 'execute') as ja,
              has_function_privilege('anon', 'public.join_challenge(uuid, boolean, boolean, boolean)', 'execute') as jn`)
    expect(g).toEqual({ ca: true, cn: false, ja: true, jn: false })

    // The client of 2b names its parameters and does not know p_share_sleep: it keeps working.
    await enableNutrition(db, A)
    await enableNutrition(db, B)
    const { id } = await one<{ id: string }>(db, A,
      `select public.create_challenge(p_template => 'nutrition_days_on_target', p_title => 'No alvo', p_mode => 'team',
              p_target => 5, p_starts_on => '2026-10-05', p_ends_on => '2026-10-11', p_invitees => $1::uuid[],
              p_share_volume => false, p_share_nutrition => true) as v`, ['{' + B + '}'])
    await rows(db, B, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => true)', [id])
    expect(await sharing(id)).toEqual([
      { user_id: A, share_sleep: false, share_nutrition: true, share_volume: false },
      { user_id: B, share_sleep: false, share_nutrition: true, share_volume: false },
    ])
  })
})

describe('close-sleep-nights job (0025)', () => {
  const CRON = new URL('../migrations/0025_sleep_cron.sql', import.meta.url)

  it('schedules nothing without pg_cron', async () => {
    await db.exec(readFileSync(CRON, 'utf8'))
    expect(await sql(db, `select count(*)::int as n from pg_extension where extname = 'pg_cron'`)).toEqual([{ n: 0 }])
  })

  it('runs close_all_sleep_nights daily at 06:40 UTC', () => {
    expect(readFileSync(CRON, 'utf8')).toContain(
      "cron.schedule('close-sleep-nights', '40 6 * * *', 'select public.close_all_sleep_nights()')")
  })
})
