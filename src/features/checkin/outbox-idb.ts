/* The browser's backend for the check-in outbox: IndexedDB database 'perf-checkin-outbox', object
 * store 'ops', one record per queued op keyed by [userId, id], with an index on userId.
 *
 * IndexedDB because a queued check-in carries a photo: localStorage cannot hold it. The photo is
 * stored as its bytes (an ArrayBuffer) and its type, and given back as a Blob: older WebKit loses
 * Blobs kept in IndexedDB, and bytes it keeps. Opening can fail (some private windows block it)
 * and then open() answers false and the outbox falls back to memory.
 */
import type { OutboxBackend, StoredOp } from './outbox'

export const CHECKIN_DB = 'perf-checkin-outbox'
export const CHECKIN_STORE = 'ops'

type Row = Omit<StoredOp, 'op'> & { op: Omit<StoredOp['op'], 'photo'>; photoData?: ArrayBuffer; photoType?: string }

const req = <T,>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error || new Error('aborted'))
})

async function toRow(rec: StoredOp): Promise<Row> {
  const { photo, ...op } = rec.op
  const row: Row = { ...rec, op }
  if (photo) { row.photoData = await photo.arrayBuffer(); row.photoType = photo.type }
  return row
}
const fromRow = (row: Row): StoredOp => {
  const { photoData, photoType, ...rec } = row
  const op = photoData ? { ...rec.op, photo: new Blob([photoData], { type: photoType || '' }) } : rec.op
  return { ...rec, op } as StoredOp
}

export function idbOutboxBackend({ idb = globalThis.indexedDB }: { idb?: IDBFactory } = {}): OutboxBackend {
  let db: IDBDatabase | null = null
  const store = (mode: IDBTransactionMode) => {
    const tx = db!.transaction(CHECKIN_STORE, mode)
    return { tx, os: tx.objectStore(CHECKIN_STORE) }
  }
  return {
    async open() {
      if (!idb) return false
      try {
        db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = idb.open(CHECKIN_DB, 1)
          r.onupgradeneeded = () => {
            if (!r.result.objectStoreNames.contains(CHECKIN_STORE)) {
              r.result.createObjectStore(CHECKIN_STORE, { keyPath: ['userId', 'id'] }).createIndex('byUser', 'userId')
            }
          }
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
          r.onblocked = () => reject(new Error('blocked'))
        })
        // Another tab upgrading a later version asks this one to let go.
        db.onversionchange = () => { try { db?.close() } catch { /* already closed */ } }
        return true
      } catch {
        try { db?.close() } catch { /* nothing to close */ }
        db = null
        return false
      }
    },
    async list(userId) {
      const rows = (await req(store('readonly').os.index('byUser').getAll(userId))) as Row[]
      return rows.map(fromRow).sort((a, b) => a.seq - b.seq)
    },
    async get(userId, id) {
      const row = (await req(store('readonly').os.get([userId, id]))) as Row | undefined
      return row ? fromRow(row) : undefined
    },
    async put(rec) {
      const row = await toRow(rec)
      const { tx, os } = store('readwrite')
      os.put(row)
      await done(tx)
    },
    async delete(userId, id) {
      const { tx, os } = store('readwrite')
      os.delete([userId, id])
      await done(tx)
    },
    async clear(userId) {
      const rows = (await req(store('readonly').os.index('byUser').getAll(userId))) as Row[]
      const { tx, os } = store('readwrite')
      for (const r of rows) os.delete([r.userId, r.id])
      await done(tx)
    }
  }
}
