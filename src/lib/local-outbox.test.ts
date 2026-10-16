// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.hoisted(() => ({ session: { access_token: 't' } as object | null }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: auth.session } }) } } }))

import { createLocalOutbox } from './local-outbox'

type Op = { id: string; v: number }
const KEY = 'perf_test_outbox_v1'
const ME = 'me', OTHER = 'other'
const send = vi.fn<(op: Op) => Promise<void>>()
const box = createLocalOutbox<Op>({ key: KEY, same: (a, b) => a.id === b.id, send })
const pg = (code: string, message: string) => Object.assign(new Error(message), { code })

beforeEach(() => {
  localStorage.clear(); box.clear(); auth.session = { access_token: 't' }
  send.mockReset().mockResolvedValue(undefined)
})

describe('createLocalOutbox', () => {
  it('sends in the order the ops arrived', async () => {
    for (const id of ['a', 'b', 'c']) box.enqueue(ME, { id, v: 1 })
    await expect(box.flush(ME)).resolves.toEqual({ sent: 3, left: 0, dropped: 0, reasons: [] })
    expect(send.mock.calls.map(c => c[0].id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('collapses ops that `same` matches, the newest at the end', () => {
    box.enqueue(ME, { id: 'a', v: 1 })
    box.enqueue(ME, { id: 'b', v: 1 })
    box.enqueue(ME, { id: 'a', v: 2 })
    expect(box.pending(ME)).toEqual([{ id: 'b', v: 1 }, { id: 'a', v: 2 }])
  })

  it('with inPlace, puts the newest op where the first match was', () => {
    const inPlace = createLocalOutbox<Op>({ key: KEY, same: (a, b) => a.id === b.id, send, inPlace: true })
    inPlace.enqueue(ME, { id: 'a', v: 1 })
    inPlace.enqueue(ME, { id: 'b', v: 1 })
    inPlace.enqueue(ME, { id: 'a', v: 2 })
    expect(inPlace.pending(ME)).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }])
    inPlace.enqueue(ME, { id: 'c', v: 1 })
    expect(inPlace.pending(ME)).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }])
  })

  it('drops a refusal for good with its reason and goes on', async () => {
    for (const id of ['a', 'b', 'c']) box.enqueue(ME, { id, v: 1 })
    send.mockImplementation(async op => {
      if (op.id === 'a') throw pg('P0001', 'night_closed')
      if (op.id === 'b') throw pg('23514', 'check violation')
    })
    await expect(box.flush(ME)).resolves.toEqual({ sent: 1, left: 0, dropped: 2, reasons: ['night_closed', 'refused'] })
  })

  it('tells a watcher which ops it dropped, per account, until it stops watching', async () => {
    for (const id of ['a', 'b']) box.enqueue(ME, { id, v: 1 })
    send.mockImplementation(async op => { if (op.id === 'a') throw pg('P0001', 'day_closed') })
    const seen: [string, Op, string][] = []
    const stop = box.onRefused((userId, op, detail) => { seen.push([userId, op, detail]) })
    await box.flush(ME)
    // With the server's own words, so a store can tell one refusal from another.
    expect(seen).toEqual([[ME, { id: 'a', v: 1 }, 'day_closed']])
    stop()
    box.enqueue(ME, { id: 'a', v: 2 })
    await box.flush(ME)
    expect(seen).toHaveLength(1)
  })

  it('stops on a network error and keeps the rest, in order', async () => {
    for (const id of ['a', 'b', 'c']) box.enqueue(ME, { id, v: 1 })
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(box.flush(ME)).resolves.toEqual({ sent: 1, left: 2, dropped: 0, reasons: [] })
    expect(box.pending(ME).map(o => o.id)).toEqual(['b', 'c'])
    await expect(box.flush(ME)).resolves.toEqual({ sent: 2, left: 0, dropped: 0, reasons: [] })
  })

  it('sends nothing and drops nothing without a session', async () => {
    box.enqueue(ME, { id: 'a', v: 1 })
    auth.session = null
    await expect(box.flush(ME)).resolves.toEqual({ sent: 0, left: 1, dropped: 0, reasons: [] })
    expect(send).not.toHaveBeenCalled()
  })

  it('forgets one account and keeps the others', () => {
    box.enqueue(ME, { id: 'a', v: 1 })
    box.enqueue(OTHER, { id: 'b', v: 1 })
    box.forget(ME)
    expect(box.pending(ME)).toEqual([])
    expect(box.pending(OTHER)).toEqual([{ id: 'b', v: 1 }])
    box.forget(OTHER)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps one queue per account', async () => {
    box.enqueue(ME, { id: 'a', v: 1 })
    box.enqueue(OTHER, { id: 'z', v: 1 })
    await box.flush(ME)
    expect(send.mock.calls.map(c => c[0].id)).toEqual(['a'])
    expect(box.pending(OTHER)).toEqual([{ id: 'z', v: 1 }])
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ [OTHER]: [{ id: 'z', v: 1 }] })
  })

  it('runs one flush per account at a time; a second caller runs on what is left', async () => {
    box.enqueue(ME, { id: 'a', v: 1 })
    let release!: () => void
    send.mockImplementationOnce(() => new Promise<void>(r => { release = r }))
    const first = box.flush(ME)
    const second = box.flush(ME)
    await new Promise(r => setTimeout(r, 0))
    expect(send).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toMatchObject({ sent: 1, left: 0 })
    await expect(second).resolves.toEqual({ sent: 0, left: 0, dropped: 0, reasons: [] })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keeps an op enqueued for the same id while the older one was in flight', async () => {
    box.enqueue(ME, { id: 'a', v: 1 })
    let release!: () => void
    send.mockImplementationOnce(() => new Promise<void>(r => { release = r }))
    const run = box.flush(ME)
    await new Promise(r => setTimeout(r, 0))
    box.enqueue(ME, { id: 'a', v: 2 })
    release()
    await run
    expect(box.pending(ME)).toEqual([{ id: 'a', v: 2 }])
  })

  it('reads a broken saved queue as empty', () => {
    localStorage.setItem(KEY, '[1,2')
    expect(box.pending(ME)).toEqual([])
    localStorage.setItem(KEY, '[1,2]')
    expect(box.pending(ME)).toEqual([])
  })
})
