import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import { befriend, one, rows } from './helpers/social'
import { addCheckin } from './helpers/checkin'
import fixture from './fixtures/run-details.json'

// Phase 1e-b, Task 1 (0032_run.sql): checkins_guard validates detail.run for the client roles,
// close_training_days counts a run with distance or effort as a detailed day, and the feed item and
// get_checkin show others only the run type and the distance. The cases of detail.run live in
// fixtures/run-details.json, shared with the client's checkRunDetail.

let db: PGlite

const DETAIL = { entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true }] }] }
const PLANNED = {
  week: 3, session: 'w3-s2', type: 'intervals',
  blocks: [{ zone: 'easy', min: 10 }, { repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] },
    { zone: 'easy', min: 5 }],
}
const RUN = { status: 'as_planned', planned: PLANNED, distance_km: 6.2, rpe: 8 }
const PRIVATE_KEYS = ['rpe', 'blocks', 'planned', 'detail', 'note']

// A check-in straight into the table as the owner, so any past day can be filled (the guard lets a
// client post only today or yesterday, and the owner passes its rules).
const post = async (uid: string, day: string, activity: string, detail: unknown = null) => {
  const id = randomUUID()
  await sql(db,
    `insert into public.checkins (id, user_id, day, activity, title, visibility, photo_path, detail)
     values ($1, $2, $3, $4, 'Treino', 'friends', $5, $6::jsonb)`,
    [id, uid, day, activity, `${uid}/${id}.jpg`, detail === null ? null : JSON.stringify(detail)])
  return id
}
const setCutoff = (day: string) =>
  sql(db, `update public.app_settings set value = to_jsonb($1::date) where key = 'training_checkin_since'`, [day])
const close = (uid = A) => sql(db, 'select public.close_training_days($1)', [uid])
const detailed = async (uid = A) => (await sql<{ day: string; detailed: boolean }>(db,
  `select to_char(day, 'YYYY-MM-DD') as day, detailed from public.training_days where user_id = $1 and checked order by day`,
  [uid])).map(d => [d.day, d.detailed])
const strength = async (uid = A) => (await ledger(db, uid)).filter(r => r.pillar === 'strength')

// Every key of every object inside a value, at any depth.
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach(x => keysDeep(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out) }
  return out
}
const expectNoPrivateKeys = (v: unknown) => {
  const keys = keysDeep(v)
  for (const k of PRIVATE_KEYS) expect(keys.has(k), k).toBe(false)
}

describe('detail.run from a client (fixtures/run-details.json)', () => {
  // One database for every case, one person per case: the ten-a-day limit never gets in the way.
  beforeAll(async () => {
    db = await freshDb()
    await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  })

  it.each(fixture.cases)('$name: inserting it is valid $valid', async ({ activity, run, valid }) => {
    const uid = randomUUID()
    await makeUser(db, uid)
    const insert = addCheckin(db, uid, { activity, detail: { run } })
    if (valid) await expect(insert).resolves.toBeTypeOf('string')
    else await expect(insert).rejects.toThrow(/invalid_run_detail/)
  })

  it.each(fixture.cases)('$name: updating to it is valid $valid', async ({ activity, run, valid }) => {
    const uid = randomUUID()
    await makeUser(db, uid)
    const id = await addCheckin(db, uid, { activity })
    const update = asUser(db, uid, () =>
      db.query('update public.checkins set detail = $2::jsonb where id = $1', [id, JSON.stringify({ run })]))
    if (valid) {
      await update
      const [r] = await sql(db, 'select detail from public.checkins where id = $1', [id])
      expect(r.detail).toEqual({ run })
    } else {
      await expect(update).rejects.toThrow(/invalid_run_detail/)
    }
  })
})

describe('check-ins without detail.run', () => {
  beforeEach(async () => {
    db = await freshDb()
    await setClock(db, '2026-10-07T15:00:00Z')
    await makeUser(db, A)
  })

  it('are accepted as before: no detail, strength entries, a bike ride', async () => {
    await addCheckin(db, A)
    await addCheckin(db, A, { detail: DETAIL })
    await addCheckin(db, A, { activity: 'bike', detail: { entries: [] } })
    await addCheckin(db, A, { activity: 'run' })
    expect((await sql(db, 'select count(*)::int as n from public.checkins where user_id = $1', [A]))[0].n).toBe(4)
  })

  it('refuse an invalid run part even next to strength entries', async () => {
    await expect(addCheckin(db, A, { activity: 'run', detail: { ...DETAIL, run: { status: 'done' } } }))
      .rejects.toThrow(/invalid_run_detail/)
  })

  it('pass as the database owner, as the other rules do', async () => {
    await post(A, '2026-10-01', 'strength', { run: { status: 'done' } })
    expect((await sql(db, 'select count(*)::int as n from public.checkins where user_id = $1', [A]))[0].n).toBe(1)
  })

  // The guard runs as the client (security invoker), so authenticated needs the helpers; anon does not.
  it('leave the helpers to the signed-in role only', async () => {
    expect(await one(db, A, `select public.valid_run_detail('{"status":"unplanned"}', 'run') as v`)).toBe(true)
    expect(await one(db, A, `select public.valid_run_items('[]') as v`)).toBe(false)
    await expect(asUser(db, null, () => db.query(`select public.valid_run_detail('{"status":"unplanned"}', 'run')`)))
      .rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, () => db.query(`select public.valid_run_items('[]')`)))
      .rejects.toThrow(/permission denied/)
  })
})

describe('a run as a detailed training day', () => {
  beforeEach(async () => {
    db = await freshDb()
    await withoutEventWindow(db)
    await setClock(db, '2026-10-05T15:00:00Z')   // Monday, 12:00 in Sao Paulo
    await makeUser(db, A)
    await setCutoff('2026-10-05')
  })

  it('is detailed with a distance or an effort, not with the status alone', async () => {
    await post(A, '2026-10-05', 'run', { run: { status: 'unplanned', distance_km: 5 } })
    await post(A, '2026-10-06', 'run', { run: { status: 'unplanned' } })
    await post(A, '2026-10-07', 'run', { run: { status: 'unplanned', rpe: 6 } })
    await post(A, '2026-10-08', 'run', { run: { status: 'as_planned', planned: PLANNED } })
    await post(A, '2026-10-09', 'run')
    await setClock(db, '2026-10-11T15:00:00Z')
    await close()
    expect(await detailed()).toEqual([
      ['2026-10-05', true], ['2026-10-06', false], ['2026-10-07', true], ['2026-10-08', false], ['2026-10-09', false]])
  })

  it('shares the three detailed days a week with strength', async () => {
    await post(A, '2026-10-05', 'strength', DETAIL)
    await post(A, '2026-10-06', 'strength', DETAIL)
    await post(A, '2026-10-07', 'run', { run: { status: 'unplanned', distance_km: 5 } })
    await post(A, '2026-10-08', 'run', { run: { status: 'unplanned', rpe: 7 } })
    await setClock(db, '2026-10-13T15:00:00Z')
    await close()
    expect((await strength()).filter(r => r.reason === 'training_detailed'))
      .toEqual(Array(3).fill({ reason: 'training_detailed', amount: 30, week_start: '2026-10-05', pillar: 'strength' }))
  })

  it('keeps the Treino week at 960 with a full week of workouts, PRs, weigh-ins and runs', async () => {
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']) {
      await post(A, d, 'strength', DETAIL)
      await post(A, d, 'run', { run: RUN })
      await event(db, A, 'pr', d, 's' + d + ':bench', { ex: 'bench' })
      await event(db, A, 'weight_logged', d, d, { w: 80 })
    }
    await setClock(db, '2026-10-13T15:00:00Z')
    await close()
    const rows = await strength()
    expect(rows.filter(r => r.reason === 'training_detailed')).toHaveLength(3)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(960)
  })
})

describe('a run check-in seen by others', () => {
  // Ana posts; Bia is her friend and in her challenge.
  let run: string, unplanned: string, lift: string, bike: string

  beforeEach(async () => {
    db = await freshDb()
    await setClock(db, '2026-10-07T15:00:00Z')
    await makeUser(db, A, { display_name: 'Ana' })
    await makeUser(db, B, { display_name: 'Bia' })
    await befriend(db, A, B)
    run = await addCheckin(db, A, { activity: 'run', duration_min: 38, note: 'Nota privada', detail: { run: RUN } })
    unplanned = await addCheckin(db, A, { activity: 'run', duration_min: 30, detail: { run: { status: 'unplanned', distance_km: 5, rpe: 9 } } })
    lift = await addCheckin(db, A, { duration_min: 50, detail: DETAIL })
    // Only the owner can write a run part on another activity; the item still says nothing of it.
    bike = await post(A, '2026-10-07', 'bike', { run: RUN })
  })

  const byKey = (items: any[]) => Object.fromEntries(items.map(i => [i.key.slice('checkin:'.length), i]))
  const expectItems = (items: any[]) => {
    const by = byKey(items)
    expect(by[run]).toMatchObject({ activity: 'run', run_type: 'intervals', distance_km: 6.2, duration_min: 38 })
    expect(by[unplanned]).toMatchObject({ activity: 'run', run_type: null, distance_km: 5, duration_min: 30 })
    expect(by[lift]).toMatchObject({ activity: 'strength', run_type: null, distance_km: null })
    expect(by[bike]).toMatchObject({ activity: 'bike', run_type: null, distance_km: null })
    expectNoPrivateKeys(items)
  }

  it('in the friends feed shows the type and the distance only', async () => {
    const { items } = await one<{ items: any[] }>(db, B, 'select public.get_checkin_feed() as v')
    expect(items).toHaveLength(4)
    expectItems(items)
  })

  it('in the challenge feed shows the type and the distance only', async () => {
    const [{ v: ch }] = await rows<{ v: { id: string } }>(db, A,
      `select public.create_challenge(p_template => 'checkin_days', p_title => 'Dias de treino', p_mode => 'team',
              p_target => 5, p_starts_on => '2026-10-07', p_ends_on => '2026-10-13', p_invitees => $1::uuid[],
              p_share_volume => false, p_share_nutrition => false) as v`, ['{' + B + '}'])
    await rows(db, B, 'select public.join_challenge(p_id => $1, p_share_volume => false, p_share_nutrition => false)', [ch.id])
    const { items } = await one<{ items: any[] }>(db, B, 'select public.get_challenge_feed($1) as v', [ch.id])
    expect(items).toHaveLength(4)
    expectItems(items)
  })

  it('in get_checkin shows a friend the type and the distance, and the owner the whole detail', async () => {
    const seen = await one<any>(db, B, 'select public.get_checkin($1) as v', [run])
    expect(seen).toMatchObject({ run_type: 'intervals', distance_km: 6.2, duration_min: 38 })
    expectNoPrivateKeys(seen)
    expect(await one<any>(db, B, 'select public.get_checkin($1) as v', [lift]))
      .toMatchObject({ run_type: null, distance_km: null })

    const mine = await one<any>(db, A, 'select public.get_checkin($1) as v', [run])
    expect(mine).toMatchObject({ run_type: 'intervals', distance_km: 6.2, note: 'Nota privada' })
    expect(mine.detail).toEqual({ run: RUN })
  })
})
