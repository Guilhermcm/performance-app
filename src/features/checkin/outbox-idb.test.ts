// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { idbOutboxBackend } from './outbox-idb'
import type { StoredOp } from './outbox'

/* Just enough IndexedDB for the backend: one database, the store 'ops' keyed by [userId, id] with a
   'user' index, requests that answer on the next tick and transactions that complete after their
   last request. Values are kept as they are put. */
function fakeIdb(opts: { failOpen?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>()
  const seen = { opened: [] as [string, number][], store: null as null | { name: string; keyPath: unknown }, index: null as null | [string, string] }
  const later = (fn: () => void) => setTimeout(fn, 0)
  const keyOf = (k: unknown) => JSON.stringify(k)
  const request = (run: () => unknown) => {
    const r: { onsuccess: null | (() => void); onerror: null | (() => void); result?: unknown } = { onsuccess: null, onerror: null }
    later(() => { r.result = run(); r.onsuccess?.() })
    return r
  }
  const db = {
    objectStoreNames: { contains: () => !!seen.store },
    createObjectStore(name: string, o: { keyPath: unknown }) { seen.store = { name, keyPath: o.keyPath }; return { createIndex: (n: string, p: string) => { seen.index = [n, p] } } },
    onversionchange: null,
    close() {},
    transaction() {
      const t: { oncomplete: null | (() => void); onerror: null; onabort: null; pending: number; objectStore?: unknown } = { oncomplete: null, onerror: null, onabort: null, pending: 0 }
      const settle = () => { if (--t.pending === 0) later(() => t.oncomplete?.()) }
      const track = (run: () => unknown) => { t.pending++; return request(() => { const v = run(); later(settle); return v }) }
      t.objectStore = () => ({
        put: (v: Record<string, unknown>) => track(() => { rows.set(keyOf([v.userId, v.id]), v) }),
        get: (k: unknown) => track(() => rows.get(keyOf(k))),
        delete: (k: unknown) => track(() => { rows.delete(keyOf(k)) }),
        index: () => ({ getAll: (u: string) => track(() => [...rows.values()].filter(r => r.userId === u)) })
      })
      return t
    }
  }
  const idb = {
    open(name: string, version: number) {
      seen.opened.push([name, version])
      const r: { onsuccess: null | (() => void); onerror: null | (() => void); onupgradeneeded: null | (() => void); onblocked: null; result: unknown; error?: unknown } = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: db }
      later(() => {
        if (opts.failOpen) { r.error = new Error('denied'); r.onerror?.(); return }
        r.onupgradeneeded?.(); r.onsuccess?.()
      })
      return r
    }
  }
  return { idb: idb as unknown as IDBFactory, rows, seen }
}

const rec = (userId: string, id: string, seq: number, op: Partial<StoredOp['op']> = {}): StoredOp => ({
  userId, id, seq, rev: String(seq), op: { kind: 'checkin_delete', id, ...op }
})

describe('idbOutboxBackend', () => {
  it('opens perf-checkin-outbox with the store ops keyed by [userId, id]', async () => {
    const f = fakeIdb()
    const b = idbOutboxBackend({ idb: f.idb })
    await expect(b.open()).resolves.toBe(true)
    expect(f.seen.opened).toEqual([['perf-checkin-outbox', 1]])
    expect(f.seen.store).toEqual({ name: 'ops', keyPath: ['userId', 'id'] })
    expect(f.seen.index?.[1]).toBe('userId')
  })

  it('answers false when IndexedDB is missing or refuses', async () => {
    await expect(idbOutboxBackend({ idb: undefined as unknown as IDBFactory }).open()).resolves.toBe(false)
    await expect(idbOutboxBackend({ idb: fakeIdb({ failOpen: true }).idb }).open()).resolves.toBe(false)
  })

  it('puts, lists by account in order, gets and deletes', async () => {
    const f = fakeIdb()
    const b = idbOutboxBackend({ idb: f.idb })
    await b.open()
    await b.put(rec('u1', 'z', 2)); await b.put(rec('u1', 'a', 3)); await b.put(rec('u2', 'q', 1)); await b.put(rec('u1', 'm', 1))
    expect((await b.list('u1')).map(r => r.id)).toEqual(['m', 'z', 'a'])
    expect((await b.list('u2')).map(r => r.id)).toEqual(['q'])
    expect((await b.get('u1', 'z'))?.seq).toBe(2)
    expect(await b.get('u2', 'z')).toBeUndefined()
    await b.delete('u1', 'z')
    expect((await b.list('u1')).map(r => r.id)).toEqual(['m', 'a'])
    await b.clear('u1')
    expect(await b.list('u1')).toEqual([])
    expect((await b.list('u2')).map(r => r.id)).toEqual(['q'])
  })

  it('stores the photo as bytes and gives a Blob of the same type back', async () => {
    const f = fakeIdb()
    const b = idbOutboxBackend({ idb: f.idb })
    await b.open()
    const photo = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/webp' })
    await b.put(rec('u1', 'a', 1, { kind: 'checkin', photo, ext: 'webp' }))
    const stored = f.rows.get(JSON.stringify(['u1', 'a']))!
    expect(Object.prototype.toString.call(stored.photoData)).toBe('[object ArrayBuffer]')
    expect((stored.op as { photo?: unknown }).photo).toBeUndefined()
    const [back] = await b.list('u1')
    expect(back.op.photo).toBeInstanceOf(Blob)
    expect(back.op.photo!.type).toBe('image/webp')
    expect([...new Uint8Array(await back.op.photo!.arrayBuffer())]).toEqual([1, 2, 3, 4, 5])
    const got = await b.get('u1', 'a')
    expect(got?.op.photo?.size).toBe(5)
  })
})
