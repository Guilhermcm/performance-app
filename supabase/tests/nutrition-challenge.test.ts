import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, ledger, sql } from './helpers/game'
import { C, D, befriend, createChallenge, one, rows } from './helpers/social'
import { enableNutrition, setTarget } from './helpers/nutrition'

let db: PGlite
const T = { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }
const NUT = 'nutrition_days_on_target'

type Args = {
  mode?: string; target?: number; starts_on?: string; ends_on?: string
  invitees?: string[]; share_nutrition?: boolean
}

// Named parameters, the way the client calls it. Seven days from Monday 2026-10-05, Bia invited.
async function create(uid: string, over: Args = {}): Promise<string> {
  const a = { mode: 'team', target: 5, starts_on: '2026-10-05', ends_on: '2026-10-11', invitees: [B], share_nutrition: true, ...over }
  const r = await one<{ id: string }>(db, uid,
    `select public.create_challenge(p_template => $1, p_title => 'No alvo', p_mode => $2, p_target => $3::numeric,
            p_starts_on => $4::date, p_ends_on => $5::date, p_invitees => $6::uuid[],
            p_share_volume => false, p_share_nutrition => $7) as v`,
    [NUT, a.mode, a.target, a.starts_on, a.ends_on, '{' + a.invitees.join(',') + '}', a.share_nutrition])
  return r.id
}
const join = (uid: string, id: string, share = true) =>
  rows(db, uid, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => $2)', [id, share])
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)
const statusOf = async (id: string) => (await sql<{ status: string }>(db, 'select status from public.challenges where id = $1', [id]))[0].status
const progressByName = (c: { members: { name: string; progress: number | null }[] }) =>
  Object.fromEntries(c.members.map(m => [m.name, m.progress]))

// A closed day straight into nutrition_days, as the server would leave it.
const day = (uid: string, d: string, onTarget = true, imported = false) =>
  sql(db,
    `insert into public.nutrition_days (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, target, logged, on_target, balanced, imported)
     values ($1, $2, 2000, 150, 200, 60, 2, null, true, $3, $3, $4)`, [uid, d, onTarget, imported])

// Two meals on the target, in the diary (still to be closed).
const eatOnTarget = async (uid: string, d: string) => {
  for (const meal of ['lunch', 'dinner']) {
    await sql(db,
      `insert into public.food_logs (id, user_id, day, meal, name, source, kcal, protein_g, carbs_g, fat_g)
       values ($1, $2, $3, $4, 'Item', 'quick', 1000, 75, 100, 30)`, [randomUUID(), uid, d, meal])
  }
}

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
  for (const u of [A, B]) {
    await enableNutrition(db, u)
    await setTarget(db, u, '2026-10-05', T)
  }
})

describe('creating a nutrition challenge', () => {
  it('creates team and solo challenges with the opt-in recorded', async () => {
    const team = await create(A)
    const solo = await create(A, { mode: 'solo', target: 7 })
    const [c] = (await list(A)).filter((x: any) => x.id === team)
    expect(c).toMatchObject({ template: NUT, mode: 'team', target: 5, total: 0, status: 'active' })
    expect((await list(A)).find((x: any) => x.id === solo)).toMatchObject({ template: NUT, mode: 'solo', target: 7 })
    const m = await sql(db, 'select user_id, share_nutrition, share_volume from public.challenge_members where challenge_id = $1 order by user_id', [team])
    expect(m).toEqual([
      { user_id: A, share_nutrition: true, share_volume: false },
      { user_id: B, share_nutrition: false, share_volume: false },
    ])
  })

  it.each([
    { mode: 'solo', target: 8 },                                 // more than the 7 days
    { mode: 'team', target: 15 },                                // 7 x (1 + 1)
    { mode: 'team', target: 22, invitees: [B, C] },              // 7 x (1 + 2)
    { target: 0 },
    { target: 2.5 },
  ])('refuses the target %j', async over => {
    await expect(create(A, over)).rejects.toThrow('invalid_challenge')
  })

  it('accepts the target edges', async () => {
    await create(A, { mode: 'solo', target: 1 })
    await create(A, { mode: 'solo', target: 7 })
    await create(A, { mode: 'team', target: 14 })
    await create(A, { mode: 'team', target: 21, invitees: [B, C] })
  })

  it('asks for the opt-in', async () => {
    await expect(create(A, { share_nutrition: false })).rejects.toThrow('nutrition_opt_in_required')
    // The positional call of the older clients does not carry it either.
    await expect(createChallenge(db, A, { template: NUT, target: 5, ends_on: '2026-10-11' })).rejects.toThrow('nutrition_opt_in_required')
  })

  it('needs the pillar on', async () => {
    await enableNutrition(db, A, false)
    await expect(create(A)).rejects.toThrow('nutrition_off')
  })

  it('keeps one create_challenge and one join_challenge, callable only when signed in', async () => {
    const [r] = await sql(db,
      `select (select count(*)::int from pg_proc where proname = 'create_challenge') as c,
              (select count(*)::int from pg_proc where proname = 'join_challenge') as j`)
    expect(r).toEqual({ c: 1, j: 1 })
    const [g] = await sql(db,
      `select has_function_privilege('authenticated', 'public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean)', 'execute') as ca,
              has_function_privilege('anon', 'public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean)', 'execute') as cn,
              has_function_privilege('authenticated', 'public.join_challenge(uuid, boolean, boolean)', 'execute') as ja,
              has_function_privilege('anon', 'public.join_challenge(uuid, boolean, boolean)', 'execute') as jn`)
    expect(g).toEqual({ ca: true, cn: false, ja: true, jn: false })
  })
})

describe('joining a nutrition challenge', () => {
  it('asks for the opt-in and records it', async () => {
    const id = await create(A)
    await expect(join(B, id, false)).rejects.toThrow('nutrition_opt_in_required')
    await expect(rows(db, B, 'select public.join_challenge($1, false)', [id])).rejects.toThrow('nutrition_opt_in_required')
    await join(B, id)
    const [m] = await sql(db, 'select share_nutrition from public.challenge_members where challenge_id = $1 and user_id = $2', [id, B])
    expect(m.share_nutrition).toBe(true)
  })

  it('needs the pillar on', async () => {
    const id = await create(A, { invitees: [B, C] })
    await expect(join(C, id)).rejects.toThrow('nutrition_off')
    await enableNutrition(db, C)
    await join(C, id)
  })

  it('leaves the other templates as they were', async () => {
    const id = await createChallenge(db, A)
    await join(B, id, false)
    const [m] = await sql(db, 'select share_nutrition from public.challenge_members where challenge_id = $1 and user_id = $2', [id, B])
    expect(m.share_nutrition).toBe(false)
  })
})

describe('progress', () => {
  it('counts on-target days in the period, not imported, of who joined, with the pillar on', async () => {
    const id = await create(A, { invitees: [B, C] })
    await join(B, id)
    await enableNutrition(db, C)
    await day(A, '2026-10-04')                 // before the period
    await day(A, '2026-10-05')
    await day(A, '2026-10-06', false)          // closed, off target
    await day(A, '2026-10-07', true, true)     // imported
    await day(A, '2026-10-11')
    await day(A, '2026-10-12')                 // after the period
    await day(B, '2026-10-06')
    await day(C, '2026-10-06')                 // invited, has not joined
    // Bia turns the pillar off on Thursday: a day after that does not count.
    await setClock(db, '2026-10-08T15:00:00Z')
    await enableNutrition(db, B, false)
    await day(B, '2026-10-09')
    const [c] = await list(A)
    expect(progressByName(c)).toEqual({ Ana: 2, Bia: 1, Caio: null })
    expect(c.total).toBe(3)
  })

  it('shows the members nothing but the count', async () => {
    const id = await create(A)
    await join(B, id)
    await day(B, '2026-10-06')
    const [c] = await list(A)
    expect(Object.keys(c).sort()).toEqual(
      ['created_by', 'ends_on', 'id', 'invited_by', 'me', 'members', 'mode', 'starts_on', 'status', 'target', 'template', 'title', 'total'])
    for (const m of c.members) {
      expect(Object.keys(m).sort()).toEqual(['avatar_url', 'id', 'joined', 'me', 'name', 'progress', 'won'])
    }
    expect(await rows(db, A, 'select * from public.nutrition_days where user_id = $1', [B])).toEqual([])
  })
})

describe('closing a nutrition challenge', () => {
  // Ana on target on Monday, Tuesday and the last day; Bia on Wednesday and Thursday. Nobody's
  // days are closed before the challenge closes them.
  async function eatAll() {
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-11', '2026-10-12']) await eatOnTarget(A, d)
    for (const d of ['2026-10-07', '2026-10-08']) await eatOnTarget(B, d)
  }

  it('waits for the last two days to close, in the creator time zone', async () => {
    const id = await create(A)
    await join(B, id)
    await eatAll()
    await setClock(db, '2026-10-12T15:00:00Z')   // ends_on + 1
    await list(A)
    await sql(db, 'select public.close_all_challenges()')
    expect(await statusOf(id)).toBe('active')
    await setClock(db, '2026-10-14T02:59:00Z')   // 23:59 of ends_on + 2 in Sao Paulo
    await list(B)
    await sql(db, 'select public.close_all_challenges()')
    expect(await statusOf(id)).toBe('active')
    await setClock(db, '2026-10-14T03:01:00Z')   // 00:01 of ends_on + 3
    expect((await sql(db, 'select public.close_all_challenges() as n'))[0].n).toBe(1)
    expect(await statusOf(id)).toBe('won')
  })

  it('closes the pending days first and pays the team', async () => {
    const id = await create(A, { target: 5 })
    await join(B, id)
    await eatAll()
    await setClock(db, '2026-10-14T15:00:00Z')
    const [c] = await list(B)
    expect(c).toMatchObject({ status: 'won', total: 5, me: { joined: true, won: true } })
    expect(progressByName(c)).toEqual({ Ana: 3, Bia: 2 })
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([300])
    const closed = await sql(db, `select count(*)::int as n from public.nutrition_days where user_id = $1`, [A])
    expect(closed[0].n).toBe(8)   // 2026-10-05 to 2026-10-12
  })

  it('pays only who reached the goal in solo', async () => {
    const id = await create(A, { mode: 'solo', target: 3 })
    await join(B, id)
    await eatAll()
    await setClock(db, '2026-10-14T15:00:00Z')
    const [c] = await list(A)
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 3, true], ['Bia', 2, false]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([])
  })

  it('still closes the other templates the day after ends_on', async () => {
    const id = await createChallenge(db, A, { ends_on: '2026-10-11' })
    await rows(db, B, 'select public.join_challenge($1, false)', [id])
    await setClock(db, '2026-10-12T15:00:00Z')
    await list(A)
    expect(await statusOf(id)).toBe('lost')
  })
})
