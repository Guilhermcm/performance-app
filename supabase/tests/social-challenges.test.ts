import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, sql, legacyTraining } from './helpers/game'
import { C, D, befriend, createChallenge, one, rows } from './helpers/social'

let db: PGlite
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const join = (uid: string, id: string, share = false) => rows(db, uid, 'select public.join_challenge($1, $2)', [id, share])
const leave = (uid: string, id: string) => rows(db, uid, 'select public.leave_challenge($1)', [id])
const progressByName = (c: { members: { name: string; progress: number | null }[] }) =>
  Object.fromEntries(c.members.map(m => [m.name, m.progress]))

beforeEach(async () => {
  db = await freshDb()
  await legacyTraining(db)   // the workout rules from before check-ins
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')   // Monday
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('create_challenge', () => {
  it('puts the creator in, invites the friends and shows it to members only', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C] })
    const [mine] = await list(A)
    expect(mine).toMatchObject({
      id, template: 'workouts_count', title: 'Outubro forte', mode: 'team', target: 6,
      starts_on: '2026-10-05', ends_on: '2026-10-18', status: 'active', created_by: A,
      invited_by: null, total: 0, me: { joined: true, won: null }
    })
    expect(mine.members.map((m: any) => [m.name, m.me, m.joined, m.progress]))
      .toEqual([['Ana', true, true, 0], ['Bia', false, false, null], ['Caio', false, false, null]])
    const [theirs] = await list(B)
    expect(theirs).toMatchObject({ id, invited_by: 'Ana', me: { joined: false, won: null } })
    expect(await list(D)).toEqual([])
    expect(await rows(db, D, 'select id from public.challenges')).toEqual([])
    expect(await rows(db, D, 'select user_id from public.challenge_members')).toEqual([])
    expect(await rows(db, B, 'select id from public.challenges')).toHaveLength(1)
    expect(await rows(db, B, 'select user_id from public.challenge_members')).toHaveLength(3)
  })

  it('invites only friends of the creator', async () => {
    await expect(createChallenge(db, A, { invitees: [B, D] })).rejects.toThrow('not_friends')
    await expect(createChallenge(db, B, { invitees: [C] })).rejects.toThrow('not_friends')
  })

  it.each([
    { template: 'weeks_on_target', mode: 'team', target: 1 },
    { template: 'chess' },
    { mode: 'duo' },
    { title: '   ' },
    { title: 'x'.repeat(61) },
    { ends_on: '2026-10-10' },                              // 6 days
    { ends_on: '2027-01-05' },                              // 93 days
    { starts_on: '2026-10-04', ends_on: '2026-10-17' },     // yesterday
    { starts_on: '2026-11-05', ends_on: '2026-11-18' },     // 31 days ahead
    { target: 0 },
    { target: 2.5 },
    { target: 501 },
    { template: 'volume_total', target: 5001, share_volume: true },
    { template: 'weeks_on_target', mode: 'solo', target: 3 }, // the period touches 2 weeks
    { invitees: [] },
    { invitees: [A] }
  ])('refuses %j', async over => {
    await expect(createChallenge(db, A, over)).rejects.toThrow('invalid_challenge')
  })

  it('accepts the edges: 7 and 92 days, starting in 30 days, 19 friends', async () => {
    await createChallenge(db, A, { ends_on: '2026-10-11' })
    await createChallenge(db, A, { ends_on: '2027-01-04' })
    await createChallenge(db, A, { starts_on: '2026-11-04', ends_on: '2026-11-10' })
    await createChallenge(db, A, { template: 'weeks_on_target', mode: 'solo', target: 2 })
    const many: string[] = []
    for (let i = 0; i < 20; i++) {
      const id = `00000000-0000-0000-0000-0000000002${String(i).padStart(2, '0')}`
      await makeUser(db, id, { display_name: 'P' + i })
      await befriend(db, A, id)
      many.push(id)
    }
    await createChallenge(db, A, { invitees: many.slice(0, 19) })
    await expect(createChallenge(db, A, { invitees: many })).rejects.toThrow('invalid_challenge')
  })

  it('asks the creator to agree to share volume', async () => {
    await expect(createChallenge(db, A, { template: 'volume_total', target: 10 })).rejects.toThrow('volume_opt_in_required')
    const id = await createChallenge(db, A, { template: 'volume_total', target: 10, share_volume: true })
    const [m] = await sql(db, 'select share_volume from public.challenge_members where challenge_id = $1 and user_id = $2', [id, A])
    expect(m.share_volume).toBe(true)
  })

  it('keeps ten active challenges per creator', async () => {
    for (let i = 0; i < 10; i++) await createChallenge(db, A, { title: 'D' + i })
    await expect(createChallenge(db, A)).rejects.toThrow('challenge_limit')
  })

  it('needs a session', async () => {
    await expect(rows(db, null, 'select public.get_challenges()')).rejects.toThrow(/permission denied/)
    await expect(rows(db, null, `select public.create_challenge('workouts_count', 'x', 'team', 6, '2026-10-05', '2026-10-18', array['${B}'::uuid])`))
      .rejects.toThrow(/permission denied/)
  })
})

describe('join and leave', () => {
  it('lets an invited friend join, once', async () => {
    const id = await createChallenge(db, A)
    await join(B, id)
    await join(B, id)
    expect((await list(B))[0].me).toEqual({ joined: true, won: null })
  })

  it('asks for the volume opt-in when joining a volume challenge', async () => {
    const id = await createChallenge(db, A, { template: 'volume_total', target: 10, share_volume: true })
    await expect(join(B, id)).rejects.toThrow('volume_opt_in_required')
    await join(B, id, true)
    const [m] = await sql(db, 'select share_volume from public.challenge_members where challenge_id = $1 and user_id = $2', [id, B])
    expect(m.share_volume).toBe(true)
  })

  it('is invisible to whoever was not invited', async () => {
    const id = await createChallenge(db, A)
    await expect(join(D, id)).rejects.toThrow('challenge_not_found')
    await expect(join(C, id)).rejects.toThrow('challenge_not_found')
    await expect(leave(D, id)).rejects.toThrow('challenge_not_found')
  })

  it('lets an invited person decline', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C] })
    await leave(C, id)
    expect(await list(C)).toEqual([])
    expect((await list(A))[0].members.map((m: any) => m.name)).toEqual(['Ana', 'Bia'])
  })

  it('deletes the challenge when the last participant leaves', async () => {
    const id = await createChallenge(db, A)
    await join(B, id)
    await leave(A, id)
    expect(await list(A)).toEqual([])
    expect((await list(B))[0].members.map((m: any) => m.name)).toEqual(['Bia'])
    await leave(B, id)
    expect(await sql(db, 'select count(*)::int as n from public.challenges')).toEqual([{ n: 0 }])
  })

  it('refuses to join or leave after the end', async () => {
    const id = await createChallenge(db, A)
    await setClock(db, '2026-10-19T15:00:00Z')
    await expect(join(B, id)).rejects.toThrow('challenge_closed')
    await expect(leave(A, id)).rejects.toThrow('challenge_closed')
  })
})

describe('progress', () => {
  it('counts the workouts of people who joined, inside the period', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C] })
    await join(B, id)
    await event(db, A, 'workout_completed', '2026-10-05', 'a1')
    await event(db, A, 'workout_completed', '2026-10-06', 'a2')
    await event(db, B, 'workout_completed', '2026-10-07', 'b1')
    await event(db, B, 'workout_completed', '2026-10-04', 'before')
    await event(db, B, 'workout_completed', '2026-10-19', 'after')
    await event(db, C, 'workout_completed', '2026-10-06', 'c1')
    const [c] = await list(A)
    expect(progressByName(c)).toEqual({ Ana: 2, Bia: 1, Caio: null })
    expect(c.total).toBe(3)
  })

  it('counts weeks with the goal met for weeks_on_target', async () => {
    const id = await createChallenge(db, A, { template: 'weeks_on_target', mode: 'solo', target: 2 })
    await join(B, id)
    for (const d of ['2026-09-28', '2026-09-29', '2026-09-30']) await event(db, A, 'workout_completed', d, 'old' + d)
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) await event(db, A, 'workout_completed', d, d)
    await event(db, B, 'workout_completed', '2026-10-05', 'b1')
    expect(progressByName((await list(A))[0])).toEqual({ Ana: 1, Bia: 0 })
  })

  it('adds volume in tonnes, converting pounds and capping forged numbers', async () => {
    await sql(db, `update public.profiles set unit = 'lb' where id = $1`, [B])
    const id = await createChallenge(db, A, { template: 'volume_total', target: 10, share_volume: true })
    await join(B, id, true)
    await event(db, A, 'workout_completed', '2026-10-05', 'a1', { vol: 1500 })
    await event(db, A, 'workout_completed', '2026-10-06', 'a2', { vol: 999999 })
    await event(db, B, 'workout_completed', '2026-10-05', 'b1', { vol: 2204.6 })
    await event(db, B, 'workout_completed', '2026-10-06', 'b2', { vol: 'lots' })
    const [c] = await list(A)
    expect(progressByName(c)).toEqual({ Ana: 101.5, Bia: 1 })
    expect(c.total).toBe(102.5)
  })

  it('keeps the internal challenge functions away from clients', async () => {
    const id = await createChallenge(db, A)
    for (const q of [`select public.challenge_progress('${id}', '${A}')`, `select public.challenge_json('${id}', '${A}')`]) {
      await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
    }
  })
})
