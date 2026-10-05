import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './helpers/db'
import { A, B, makeUser, setClock, withoutEventWindow, event, ledger, sql } from './helpers/game'
import { C, D, befriend, createChallenge, one, rows } from './helpers/social'

let db: PGlite
const list = (uid: string) => one<any[]>(db, uid, 'select public.get_challenges() as v')
const join = (uid: string, id: string) => rows(db, uid, 'select public.join_challenge($1, false)', [id])
const bonus = async (uid: string) => (await ledger(db, uid)).filter(r => r.reason.startsWith('challenge:')).map(r => r.amount)
const statusOf = async (id: string) => (await sql<{ status: string }>(db, 'select status from public.challenges where id = $1', [id]))[0].status
const afterEnd = () => setClock(db, '2026-10-19T15:00:00Z')   // ends_on 2026-10-18

// Ana 2 workouts, Bia 1, inside the period.
async function trainBoth() {
  await event(db, A, 'workout_completed', '2026-10-05', 'a1')
  await event(db, A, 'workout_completed', '2026-10-06', 'a2')
  await event(db, B, 'workout_completed', '2026-10-07', 'b1')
}

beforeEach(async () => {
  db = await freshDb()
  await withoutEventWindow(db)
  await setClock(db, '2026-10-05T15:00:00Z')
  await makeUser(db, A, { display_name: 'Ana' })
  await makeUser(db, B, { display_name: 'Bia' })
  await makeUser(db, C, { display_name: 'Caio' })
  await makeUser(db, D, { display_name: 'Duda' })
  await befriend(db, A, B)
  await befriend(db, A, C)
})

describe('closing a challenge', () => {
  it('pays 300 to every member when the team reaches the goal, once', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C], target: 3 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    const [c] = await list(A)
    expect(c).toMatchObject({ status: 'won', total: 3, me: { joined: true, won: true } })
    expect(c.members.map((m: any) => [m.name, m.progress, m.won])).toEqual([['Ana', 2, true], ['Bia', 1, true]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([300])
    expect(await bonus(C)).toEqual([])
    expect((await ledger(db, A)).find(r => r.reason.startsWith('challenge:'))).toMatchObject({ reason: 'challenge:' + id, week_start: '2026-10-19', pillar: null })
    await list(B)
    await sql(db, 'select public.close_all_challenges()')
    expect(await bonus(A)).toEqual([300])
  })

  it('unlocks challenge_first and counts challenges_won', async () => {
    const id = await createChallenge(db, A, { target: 3 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    await list(A)
    expect((await ledger(db, A)).filter(r => r.reason === 'achievement:challenge_first').map(r => r.amount)).toEqual([200])
    const p = await one(db, A, 'select public.get_my_progress() as v')
    expect(p.stats.challenges_won).toBe(1)
    expect(p.achievements.map((a: { code: string }) => a.code)).toContain('challenge_first')
  })

  it('pays nothing when the team misses the goal', async () => {
    const id = await createChallenge(db, A, { target: 10 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    expect((await list(A))[0]).toMatchObject({ status: 'lost', me: { won: false } })
    expect(await bonus(A)).toEqual([])
    expect(await bonus(B)).toEqual([])
  })

  it('pays only who reached the goal in solo', async () => {
    const id = await createChallenge(db, A, { mode: 'solo', target: 2 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    const [c] = await list(B)
    expect(c).toMatchObject({ status: 'won', me: { joined: true, won: false } })
    expect(c.members.map((m: any) => [m.name, m.won])).toEqual([['Ana', true], ['Bia', false]])
    expect(await bonus(A)).toEqual([300])
    expect(await bonus(B)).toEqual([])
  })

  it('is lost in solo when nobody reached the goal', async () => {
    const id = await createChallenge(db, A, { mode: 'solo', target: 5 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    expect(await statusOf(id)).toBe('active')
    await list(A)
    expect(await statusOf(id)).toBe('lost')
  })

  it('is cancelled when fewer than two people joined', async () => {
    const id = await createChallenge(db, A, { invitees: [B, C], target: 1 })
    await trainBoth()
    await afterEnd()
    const [c] = await list(A)
    expect(c).toMatchObject({ status: 'cancelled' })
    expect(c.members.map((m: any) => m.name)).toEqual(['Ana'])
    expect(await bonus(A)).toEqual([])
  })

  it('waits for the day after the end in the creator time zone', async () => {
    const id = await createChallenge(db, A, { target: 1 })
    await join(B, id)
    await trainBoth()
    await setClock(db, '2026-10-19T02:30:00Z')   // still Sunday 18 in São Paulo
    await list(A)
    expect(await statusOf(id)).toBe('active')
    await setClock(db, '2026-10-19T03:30:00Z')   // Monday 19, 00:30 in São Paulo
    await list(A)
    expect(await statusOf(id)).toBe('won')
  })

  it('is closed by either ranking too', async () => {
    const id = await createChallenge(db, A, { target: 3 })
    await join(B, id)
    await trainBoth()
    await afterEnd()
    await one(db, B, 'select public.get_weekly_leaderboard() as v')
    expect(await statusOf(id)).toBe('won')
  })

  it('close_all_challenges closes every due challenge and only those', async () => {
    const due = await createChallenge(db, A, { target: 1 })
    const later = await createChallenge(db, A, { target: 1, ends_on: '2026-10-25' })
    await join(B, due)
    await join(B, later)
    await afterEnd()
    expect(await sql(db, 'select public.close_all_challenges() as n')).toEqual([{ n: 1 }])
    // Bia joined both and nobody trained: the due one is lost, the other one keeps going.
    expect([await statusOf(due), await statusOf(later)]).toEqual(['lost', 'active'])
  })

  it('gives challenge_won_5 after five wins', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await createChallenge(db, A, { title: 'D' + i, target: 1, ends_on: '2026-10-11' })
      await join(B, id)
    }
    await event(db, A, 'workout_completed', '2026-10-05', 'a1')
    await setClock(db, '2026-10-12T15:00:00Z')
    await list(A)
    const reasons = (await ledger(db, A)).map(r => r.reason)
    expect(reasons.filter(r => r.startsWith('challenge:'))).toHaveLength(5)
    expect(reasons.filter(r => r === 'achievement:challenge_first')).toHaveLength(1)
    expect(reasons.filter(r => r === 'achievement:challenge_won_5')).toHaveLength(1)
  })

  it('keeps the closing functions away from clients', async () => {
    const id = await createChallenge(db, A)
    for (const q of [
      `select public.close_challenge('${id}')`,
      `select public.close_due_challenges('${A}')`,
      `select public.close_all_challenges()`,
      `select public.leaderboard_json('${A}', 'week')`
    ]) await expect(rows(db, A, q), q).rejects.toThrow(/permission denied/)
  })

  it('skips pg_cron where the extension does not exist', async () => {
    expect(await sql(db, `select count(*)::int as n from pg_extension where extname = 'pg_cron'`)).toEqual([{ n: 0 }])
  })
})
