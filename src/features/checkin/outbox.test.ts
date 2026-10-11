// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.hoisted(() => ({ session: { access_token: 't' } as object | null }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: auth.session } }) } } }))

import { enqueueCheckin, pendingCheckins, flushCheckins, clearCheckinOutbox, memoryOutboxBackend, setCheckinOutboxBackend, type CheckinOp } from './outbox'
import type { CheckinRow } from './types'

const ME = '00000000-0000-0000-0000-00000000000a'
const OTHER = '00000000-0000-0000-0000-00000000000b'

const rowOf = (id: string, over: Partial<CheckinRow> = {}): CheckinRow => ({
  id, day: '2026-10-10', activity: 'strength', routine_id: null, routine_name: null, title: 'Treino A', caption: null, note: null,
  duration_min: 50, visibility: 'friends', photo_path: `${ME}/${id}.jpg`, detail: null, ...over
})
const photo = (n = 4, type = 'image/jpeg') => new Blob([new Uint8Array(n).fill(7)], { type })
const create = (id: string, over: Partial<CheckinRow> = {}): CheckinOp => ({ kind: 'checkin', id, row: rowOf(id, over), photo: photo(), ext: 'jpg' })
const del = (id: string): CheckinOp => ({ kind: 'checkin_delete', id })
const refusal = (m: string) => Object.assign(new Error(m), { code: 'P0001' })
const ids = async (u: string) => (await pendingCheckins(u)).map(o => o.id)

beforeEach(() => {
  setCheckinOutboxBackend(memoryOutboxBackend())
  auth.session = { access_token: 't' }
})

describe('check-in outbox', () => {
  it('keeps the photo as a Blob with its row', async () => {
    await enqueueCheckin(ME, create('a'))
    const [op] = await pendingCheckins(ME)
    expect(op).toMatchObject({ kind: 'checkin', id: 'a', ext: 'jpg', row: { id: 'a', title: 'Treino A' } })
    expect(op.photo).toBeInstanceOf(Blob)
    expect(op.photo!.size).toBe(4)
    expect(op.photo!.type).toBe('image/jpeg')
  })

  it('keeps the order of arrival, not the order of the ids', async () => {
    for (const id of ['z', 'a', 'm']) await enqueueCheckin(ME, create(id))
    expect(await ids(ME)).toEqual(['z', 'a', 'm'])
    const sent: string[] = []
    await flushCheckins(ME, async op => { sent.push(op.id) })
    expect(sent).toEqual(['z', 'a', 'm'])
  })

  it('is per account: another account neither sees, sends nor clears it', async () => {
    await enqueueCheckin(ME, create('mine'))
    await enqueueCheckin(OTHER, create('theirs'))
    expect(await ids(ME)).toEqual(['mine'])
    expect(await ids(OTHER)).toEqual(['theirs'])
    const send = vi.fn(async (_op: CheckinOp) => {})
    await expect(flushCheckins(OTHER, send)).resolves.toEqual({ sent: 1, refused: [] })
    expect(send.mock.calls.map(c => (c[0] as CheckinOp).id)).toEqual(['theirs'])
    expect(await ids(ME)).toEqual(['mine'])
    await clearCheckinOutbox(ME)
    expect(await ids(ME)).toEqual([])
  })

  it('does not hand one account the same id of another (key is account + id)', async () => {
    await enqueueCheckin(ME, create('same', { title: 'minha' }))
    await enqueueCheckin(OTHER, create('same', { title: 'dela' }))
    expect((await pendingCheckins(ME))[0].row?.title).toBe('minha')
    expect((await pendingCheckins(OTHER))[0].row?.title).toBe('dela')
  })

  it('stops at the first network error and keeps that op and the rest, in order', async () => {
    for (const id of ['a', 'b', 'c']) await enqueueCheckin(ME, create(id))
    const send = vi.fn(async (op: CheckinOp) => { if (op.id === 'b') throw new TypeError('Failed to fetch') })
    await expect(flushCheckins(ME, send)).resolves.toEqual({ sent: 1, refused: [] })
    expect(send.mock.calls.map(c => (c[0] as CheckinOp).id)).toEqual(['a', 'b'])
    expect(await ids(ME)).toEqual(['b', 'c'])
    const later: string[] = []
    await expect(flushCheckins(ME, async op => { later.push(op.id) })).resolves.toEqual({ sent: 2, refused: [] })
    expect(later).toEqual(['b', 'c'])
    expect(await ids(ME)).toEqual([])
  })

  it('drops a definitive refusal with its reason and keeps sending the rest', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await enqueueCheckin(ME, create(id))
    const send = vi.fn(async (op: CheckinOp) => {
      if (op.id === 'b') throw refusal('day_closed')
      if (op.id === 'c') throw refusal('too_many_checkins')
    })
    await expect(flushCheckins(ME, send)).resolves.toEqual({
      sent: 2, refused: [{ id: 'b', reason: 'day_closed' }, { id: 'c', reason: 'too_many_checkins' }]
    })
    expect(await ids(ME)).toEqual([])
  })

  it('reports item_immutable and a check violation as refusals too', async () => {
    await enqueueCheckin(ME, create('a'))
    await enqueueCheckin(ME, create('b'))
    const send = async (op: CheckinOp) => {
      if (op.id === 'a') throw refusal('item_immutable')
      throw Object.assign(new Error('violates check constraint'), { code: '23514' })
    }
    const res = await flushCheckins(ME, send)
    expect(res.refused[0]).toEqual({ id: 'a', reason: 'item_immutable' })
    expect(res.refused[1].id).toBe('b')
    expect(typeof res.refused[1].reason).toBe('string')
  })

  it('keeps an op whose error is a lost session (42501) or a 5xx', async () => {
    await enqueueCheckin(ME, create('a'))
    await flushCheckins(ME, async () => { throw Object.assign(new Error('permission denied'), { code: '42501' }) })
    await flushCheckins(ME, async () => { throw Object.assign(new Error('bad gateway'), { code: '502' }) })
    expect(await ids(ME)).toEqual(['a'])
  })

  it('sends nothing and drops nothing without a live session', async () => {
    await enqueueCheckin(ME, create('a'))
    await enqueueCheckin(ME, del('b'))
    auth.session = null
    const send = vi.fn(async (_op: CheckinOp) => {})
    await expect(flushCheckins(ME, send)).resolves.toEqual({ sent: 0, refused: [] })
    expect(send).not.toHaveBeenCalled()
    expect(await ids(ME)).toEqual(['a', 'b'])
    auth.session = { access_token: 't' }
    await expect(flushCheckins(ME, send)).resolves.toEqual({ sent: 2, refused: [] })
  })

  it('is idempotent: the same op twice is one op, a second flush sends nothing', async () => {
    await enqueueCheckin(ME, create('a'))
    await enqueueCheckin(ME, create('a'))
    expect(await ids(ME)).toEqual(['a'])
    const send = vi.fn(async (_op: CheckinOp) => {})
    await expect(flushCheckins(ME, send)).resolves.toEqual({ sent: 1, refused: [] })
    await expect(flushCheckins(ME, send)).resolves.toEqual({ sent: 0, refused: [] })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a re-enqueued op keeps its place in line', async () => {
    for (const id of ['a', 'b', 'c']) await enqueueCheckin(ME, create(id))
    await enqueueCheckin(ME, create('a', { title: 'editado' }))
    expect(await ids(ME)).toEqual(['a', 'b', 'c'])
    expect((await pendingCheckins(ME))[0].row?.title).toBe('editado')
  })

  it('a delete for the same id replaces the pending create', async () => {
    await enqueueCheckin(ME, create('a'))
    await enqueueCheckin(ME, create('b'))
    await enqueueCheckin(ME, del('a'))
    const ops = await pendingCheckins(ME)
    expect(ops.map(o => [o.id, o.kind])).toEqual([['b', 'checkin'], ['a', 'checkin_delete']])
    expect(ops[1].photo).toBeUndefined()
  })

  it('an op replaced while it is in flight stays queued', async () => {
    await enqueueCheckin(ME, create('a', { title: 'v1' }))
    await flushCheckins(ME, async () => { await enqueueCheckin(ME, create('a', { title: 'v2' })) })
    const [op] = await pendingCheckins(ME)
    expect(op.row?.title).toBe('v2')
  })

  it('runs one flush at a time per account and sends each op once', async () => {
    for (const id of ['a', 'b']) await enqueueCheckin(ME, create(id))
    let active = 0, peak = 0
    const sent: string[] = []
    const send = async (op: CheckinOp) => {
      active++; peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      sent.push(op.id); active--
    }
    const [r1, r2] = await Promise.all([flushCheckins(ME, send), flushCheckins(ME, send)])
    expect(peak).toBe(1)
    expect(sent).toEqual(['a', 'b'])
    expect(r1.sent + r2.sent).toBe(2)
  })

  it('survives a throwing send that is not an Error', async () => {
    await enqueueCheckin(ME, create('a'))
    await expect(flushCheckins(ME, async () => { throw 'offline' })).resolves.toEqual({ sent: 0, refused: [] })
    expect(await ids(ME)).toEqual(['a'])
  })
})
