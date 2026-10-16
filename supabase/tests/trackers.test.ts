import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { freshDb, asUser } from './helpers/db'
import { A, B, makeUser, setClock, sql } from './helpers/game'
import { rows } from './helpers/social'

let db: PGlite

type Opt = { id: string; text: string }
type TrackerOver = {
  id?: string
  name?: string
  icon?: string
  kind?: 'number' | 'duration' | 'label'
  unit?: string | null
  decimals?: number | null
  aggregate?: 'sum' | 'avg' | null
  options?: Opt[] | unknown | null
  sort?: number
  archived?: boolean
  updatedAt?: string
}

const OPTS: Opt[] = [{ id: 'a1', text: 'Bom' }, { id: 'b2', text: 'Ruim' }]

// Defaults per kind, the way the client sends them: a number tracker in liters with 1 decimal.
function trackerRow(over: TrackerOver) {
  const kind = over.kind ?? 'number'
  const has = (k: keyof TrackerOver) => Object.prototype.hasOwnProperty.call(over, k)
  return [
    over.id ?? randomUUID(),
    over.name ?? 'Água',
    over.icon ?? 'droplet',
    kind,
    has('unit') ? over.unit : kind === 'number' ? 'L' : null,
    has('decimals') ? over.decimals : kind === 'number' ? 1 : null,
    has('aggregate') ? over.aggregate : kind === 'label' ? null : 'sum',
    has('options') ? (over.options == null ? null : JSON.stringify(over.options)) : kind === 'label' ? JSON.stringify(OPTS) : null,
    over.sort ?? 0,
    over.archived ?? false,
    over.updatedAt ?? new Date().toISOString(),
  ]
}

// Creates (or re-sends) a tracker as the signed-in person, as the same upsert by id the queue does.
async function putTracker(uid: string, over: TrackerOver = {}): Promise<string> {
  const params = trackerRow(over)
  await asUser(db, uid, () => db.query(
    `insert into public.trackers (id, name, icon, kind, unit, decimals, aggregate, options, sort, archived_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, case when $10 then now() end, $11)
     on conflict (id) do update set name = excluded.name, icon = excluded.icon, kind = excluded.kind,
       unit = excluded.unit, decimals = excluded.decimals, aggregate = excluded.aggregate,
       options = excluded.options, sort = excluded.sort, archived_at = excluded.archived_at,
       updated_at = excluded.updated_at`, params))
  return params[0] as string
}

type EntryOver = {
  id?: string
  day?: string
  at?: string
  value?: number | null
  minutes?: number | null
  option?: string | null
  note?: string | null
  updatedAt?: string
}

// Writes an entry as the signed-in person, as an upsert by id of every column (create and edit are
// the same call, as PostgREST sends it).
async function putEntry(uid: string, trackerId: string, over: EntryOver = {}): Promise<string> {
  const id = over.id ?? randomUUID()
  await asUser(db, uid, () => db.query(
    `insert into public.tracker_entries (id, tracker_id, day, at, value, minutes, option, note, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set tracker_id = excluded.tracker_id, day = excluded.day, at = excluded.at, value = excluded.value,
       minutes = excluded.minutes, option = excluded.option, note = excluded.note,
       updated_at = excluded.updated_at`,
    [id, trackerId, over.day ?? TODAY, over.at ?? '08:30', over.value ?? null, over.minutes ?? null,
      over.option ?? null, over.note ?? null, over.updatedAt ?? new Date().toISOString()]))
  return id
}

const asA = (q: string, p: unknown[] = []) => asUser(db, A, () => db.query(q, p))
const tracker = async (id: string) =>
  (await sql(db, `select name, kind, options, archived_at is not null as archived, user_id
                    from public.trackers where id = $1`, [id]))[0]
const entry = async (id: string) =>
  (await sql(db, 'select tracker_id, user_id, value::float8 as value, minutes, option, note from public.tracker_entries where id = $1', [id]))[0]
const activeCount = async (uid: string) =>
  (await sql<{ n: number }>(db,
    'select count(*)::int as n from public.trackers where user_id = $1 and archived_at is null', [uid]))[0].n

const TODAY = '2026-10-07'

beforeEach(async () => {
  db = await freshDb()
  await setClock(db, '2026-10-07T15:00:00Z')   // Wednesday, 12:00 in Sao Paulo
  await makeUser(db, A)
  await makeUser(db, B)
})

describe('trackers', () => {
  it('creates one of each kind and checks the columns', async () => {
    const n = await putTracker(A, { kind: 'number' })
    const d = await putTracker(A, { kind: 'duration', name: 'Leitura', icon: 'book', aggregate: 'avg' })
    const l = await putTracker(A, { kind: 'label', name: 'Humor', icon: 'smile' })
    expect(await tracker(n)).toMatchObject({ kind: 'number', archived: false, user_id: A })
    expect(await tracker(d)).toMatchObject({ kind: 'duration' })
    expect(await tracker(l)).toMatchObject({ kind: 'label', options: OPTS })
    await putTracker(A, { kind: 'number', unit: null, decimals: 0, aggregate: 'avg', icon: 'piggy-bank', name: 'x'.repeat(40) })

    await expect(putTracker(A, { kind: 'label', options: null })).rejects.toThrow(/check/)
    await expect(putTracker(A, { kind: 'number', aggregate: null })).rejects.toThrow(/check/)
    await expect(putTracker(A, { kind: 'duration', unit: 'min' })).rejects.toThrow(/check/)
    await expect(putTracker(A, { kind: 'duration', decimals: 1 })).rejects.toThrow(/check/)
    await expect(putTracker(A, { kind: 'number', decimals: 3 })).rejects.toThrow(/check/)
    await expect(putTracker(A, { kind: 'number', unit: 'x'.repeat(13) })).rejects.toThrow(/check/)
    await expect(putTracker(A, { kind: 'number', options: OPTS })).rejects.toThrow(/invalid_options/)
    await expect(putTracker(A, { kind: 'duration', options: OPTS })).rejects.toThrow(/invalid_options/)
    await expect(putTracker(A, { kind: 'label', aggregate: 'sum' })).rejects.toThrow(/check/)
    for (const name of [' Água', 'Água ', '', 'x'.repeat(41)]) {
      await expect(putTracker(A, { name })).rejects.toThrow(/check/)
    }
    for (const icon of ['Bad', '1drop', 'drop_let', '']) {
      await expect(putTracker(A, { icon })).rejects.toThrow(/check/)
    }
    expect(await activeCount(A)).toBe(4)
  })

  it('checks the label options', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, text: `Opção ${i}` }))
    await putTracker(A, { kind: 'label', options: eight })
    await putTracker(A, { kind: 'label', options: [{ id: 'abcdefgh12345678', text: 'x'.repeat(24) }, { id: 'z', text: 'Á' }] })

    const bad: unknown[] = [
      [{ id: 'a1', text: 'Só' }],
      [...eight, { id: 'o8', text: 'Nona' }],
      [{ id: 'a1', text: 'Bom' }, { id: 'a1', text: 'Ruim' }],
      [{ id: 'a1', text: 'x'.repeat(25) }, { id: 'b2', text: 'Ruim' }],
      [{ id: 'A!', text: 'Bom' }, { id: 'b2', text: 'Ruim' }],
      [{ id: 'a1', text: '' }, { id: 'b2', text: 'Ruim' }],
      [{ id: 'a1', text: ' Bom' }, { id: 'b2', text: 'Ruim' }],
      [{ id: 'abcdefgh123456789', text: 'Bom' }, { id: 'b2', text: 'Ruim' }],
      [{ id: 'a1' }, { id: 'b2', text: 'Ruim' }],
      [{ id: 1, text: 'Bom' }, { id: 'b2', text: 'Ruim' }],
      [{ id: 'a1', text: 'Bom', color: 'red' }, { id: 'b2', text: 'Ruim' }],
      ['a1', 'b2'],
      { a1: 'Bom', b2: 'Ruim' },
    ]
    for (const options of bad) {
      await expect(putTracker(A, { kind: 'label', options })).rejects.toThrow(/invalid_options/)
    }
    expect(await activeCount(A)).toBe(2)
  })

  it('refuses the 31st active tracker', async () => {
    const ids: string[] = []
    for (let i = 0; i < 30; i++) ids.push(await putTracker(A, { name: `T${i}`, sort: i }))
    await expect(putTracker(A, { name: 'T30' })).rejects.toThrow(/too_many_trackers/)
    // Re-sending the 30th, already active, is not a 31st.
    await putTracker(A, { id: ids[29], name: 'T29 bis', sort: 29 })
    expect((await tracker(ids[29])).name).toBe('T29 bis')
    // An archived one may still be written, and another person has their own 30.
    const old = await putTracker(A, { name: 'Old', archived: true })
    await putTracker(B)
    // Reactivating with 30 active is refused; after archiving another it works.
    await expect(putTracker(A, { id: old, name: 'Old', archived: false })).rejects.toThrow(/too_many_trackers/)
    await asA('update public.trackers set archived_at = now() where id = $1', [ids[0]])
    await asA('update public.trackers set archived_at = null where id = $1', [old])
    expect(await activeCount(A)).toBe(30)
    await expect(asA('update public.trackers set archived_at = null where id = $1', [ids[0]]))
      .rejects.toThrow(/too_many_trackers/)
  })

  it('never changes the kind or the owner, and never deletes', async () => {
    const t = await putTracker(A)
    await expect(asA(`update public.trackers set kind = 'duration', unit = null, decimals = null where id = $1`, [t]))
      .rejects.toThrow(/item_immutable/)
    await expect(putTracker(A, { id: t, kind: 'duration' })).rejects.toThrow(/item_immutable/)
    await expect(asA('update public.trackers set user_id = $1 where id = $2', [B, t])).rejects.toThrow(/item_immutable/)
    await expect(sql(db, 'update public.trackers set user_id = $1 where id = $2', [B, t])).rejects.toThrow(/item_immutable/)
    await expect(asA('delete from public.trackers where id = $1', [t])).rejects.toThrow(/permission denied/)
    expect(await tracker(t)).toMatchObject({ kind: 'number', user_id: A })
  })

  it('lets options be renamed, reordered and removed only while unused', async () => {
    const opts = [{ id: 'a1', text: 'Bom' }, { id: 'b2', text: 'Ruim' }, { id: 'c3', text: 'Ok' }]
    const t = await putTracker(A, { kind: 'label', options: opts })
    await putEntry(A, t, { option: 'a1' })

    const renamed = [{ id: 'c3', text: 'Normal' }, { id: 'b2', text: 'Ruim' }, { id: 'a1', text: 'Ótimo' }, { id: 'd4', text: 'Novo' }]
    await putTracker(A, { id: t, kind: 'label', options: renamed })
    expect((await tracker(t)).options).toEqual(renamed)

    await expect(putTracker(A, { id: t, kind: 'label', options: [{ id: 'b2', text: 'Ruim' }, { id: 'c3', text: 'Ok' }] }))
      .rejects.toThrow(/option_in_use/)
    const without = [{ id: 'a1', text: 'Ótimo' }, { id: 'd4', text: 'Novo' }]
    await putTracker(A, { id: t, kind: 'label', options: without })
    expect((await tracker(t)).options).toEqual(without)
  })

  it('keeps the newest write and the first created_at', async () => {
    const t = await putTracker(A)
    const createdAt = async () =>
      (await sql(db, 'select created_at::text as c from public.trackers where id = $1', [t]))[0].c
    const first = await createdAt()
    await putTracker(A, { id: t, name: 'Velho', updatedAt: '2000-01-01T00:00:00Z' })
    expect((await tracker(t)).name).toBe('Água')
    await putTracker(A, { id: t, name: 'Novo', updatedAt: new Date(Date.now() + 86_400_000 * 30).toISOString() })
    expect((await tracker(t)).name).toBe('Novo')
    const [r] = await sql(db, 'select updated_at <= now() as ok from public.trackers where id = $1', [t])
    expect(r.ok).toBe(true)
    await asA(`update public.trackers set created_at = '2001-01-01T00:00:00Z' where id = $1`, [t])
    expect(await createdAt()).toBe(first)

    // A client cannot date a tracker in the future.
    const future = randomUUID()
    await asA(`insert into public.trackers (id, name, icon, kind, aggregate, created_at)
               values ($1, 'Sono', 'bed', 'duration', 'avg', '2027-01-01T00:00:00Z')`, [future])
    const [f] = await sql(db, `select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as c
                                 from public.trackers where id = $1`, [future])
    expect(f.c).toBe('2026-10-07 15:00')
  })
})

describe('tracker entries', () => {
  it('checks the value against the kind', async () => {
    const n = await putTracker(A, { kind: 'number', decimals: 1 })
    const z = await putTracker(A, { kind: 'number', decimals: 0, unit: null, name: 'Passos' })
    const d = await putTracker(A, { kind: 'duration', name: 'Leitura' })
    const l = await putTracker(A, { kind: 'label', name: 'Humor' })

    const e1 = await putEntry(A, n, { value: 1.8, note: 'x'.repeat(140) })
    expect(await entry(e1)).toMatchObject({ tracker_id: n, user_id: A, value: 1.8 })
    await putEntry(A, n, { value: -3.5 })
    await putEntry(A, z, { value: 8000 })
    await putEntry(A, d, { minutes: 1 })
    await putEntry(A, d, { minutes: 1440 })
    await putEntry(A, l, { option: 'b2' })

    await expect(putEntry(A, d, { value: 30 })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, n, { minutes: 30 })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, l, { value: 1 })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, n, { value: 1.5, minutes: 30 })).rejects.toThrow(/check/)
    await expect(putEntry(A, l, { option: 'zz' })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, n, { value: 1.25 })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, z, { value: 72.5 })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, d, { minutes: 0 })).rejects.toThrow(/check/)
    await expect(putEntry(A, d, { minutes: 1441 })).rejects.toThrow(/check/)
    await expect(putEntry(A, n, { value: 1, at: '08:30:15' })).rejects.toThrow(/check/)
    await expect(putEntry(A, n, { value: 1, note: 'x'.repeat(141) })).rejects.toThrow(/check/)
  })

  it('keeps a stored value with more decimals than the tracker has now, until it changes', async () => {
    const n = await putTracker(A, { kind: 'number', decimals: 2 })
    const e = await putEntry(A, n, { value: 1.85 })
    await putTracker(A, { id: n, kind: 'number', decimals: 1 })
    // An edit that leaves the value alone (a new note) goes through, by upsert or by update.
    await putEntry(A, n, { id: e, value: 1.85, note: 'depois do treino' })
    expect(await entry(e)).toMatchObject({ value: 1.85, note: 'depois do treino' })
    await asA(`update public.tracker_entries set note = 'de novo' where id = $1`, [e])
    expect(await entry(e)).toMatchObject({ value: 1.85, note: 'de novo' })
    // A new value, or a new entry, follows the tracker's decimals.
    await expect(putEntry(A, n, { id: e, value: 1.84 })).rejects.toThrow(/invalid_value/)
    await expect(putEntry(A, n, { value: 1.85 })).rejects.toThrow(/invalid_value/)
    await putEntry(A, n, { id: e, value: 1.9 })
    expect(await entry(e)).toMatchObject({ value: 1.9 })
  })

  it('accepts any day up to today in the profile time zone', async () => {
    const t = await putTracker(A)
    await putEntry(A, t, { value: 1, day: '2025-01-01' })
    await putEntry(A, t, { value: 1, day: TODAY })
    await expect(putEntry(A, t, { value: 1, day: '2026-10-08' })).rejects.toThrow(/future_day/)

    // 15:30 UTC is 00:30 of the next day in Tokyo.
    await sql(db, `update public.profiles set timezone = 'Asia/Tokyo' where id = $1`, [A])
    await setClock(db, '2026-10-07T15:30:00Z')
    await putEntry(A, t, { value: 1, day: '2026-10-08' })
    await expect(putEntry(A, t, { value: 1, day: '2026-10-09' })).rejects.toThrow(/future_day/)
    // Moving an existing entry into the future is refused too.
    const e = await putEntry(A, t, { value: 2, day: '2026-10-08' })
    await expect(putEntry(A, t, { id: e, value: 2, day: '2026-10-09' })).rejects.toThrow(/future_day/)
  })

  it('needs a tracker of the same person that is not archived for a new entry', async () => {
    const theirs = await putTracker(B)
    await expect(putEntry(A, theirs, { value: 1 })).rejects.toThrow(/tracker_not_found/)
    await expect(putEntry(A, randomUUID(), { value: 1 })).rejects.toThrow(/tracker_not_found/)

    const t = await putTracker(A)
    const e = await putEntry(A, t, { value: 1 })
    await asA('update public.trackers set archived_at = now() where id = $1', [t])
    await expect(putEntry(A, t, { value: 2 })).rejects.toThrow(/tracker_archived/)
    // An id that exists on another tracker is not an edit of this archived one.
    const live = await putTracker(A, { name: 'Peso' })
    const elsewhere = await putEntry(A, live, { value: 1 })
    await expect(putEntry(A, t, { id: elsewhere, value: 2 })).rejects.toThrow(/tracker_archived/)
    // The existing one can still be edited (also by the queue's upsert) and deleted.
    await putEntry(A, t, { id: e, value: 3, note: 'editado' })
    expect(await entry(e)).toMatchObject({ value: 3, note: 'editado' })
    await asA(`update public.tracker_entries set note = 'de novo' where id = $1`, [e])
    expect(await entry(e)).toMatchObject({ note: 'de novo' })
    await asA('delete from public.tracker_entries where id = $1', [e])
    expect(await entry(e)).toBeUndefined()
  })

  it('never moves an entry to another tracker or person', async () => {
    const t = await putTracker(A)
    const other = await putTracker(A, { name: 'Peso' })
    const e = await putEntry(A, t, { value: 1 })
    await expect(asA('update public.tracker_entries set tracker_id = $1 where id = $2', [other, e]))
      .rejects.toThrow(/item_immutable/)
    await expect(asA('update public.tracker_entries set user_id = $1 where id = $2', [B, e]))
      .rejects.toThrow(/item_immutable/)
    await expect(sql(db, 'update public.tracker_entries set user_id = $1 where id = $2', [B, e]))
      .rejects.toThrow(/item_immutable/)
    await expect(putEntry(A, other, { id: e, value: 1 })).rejects.toThrow(/item_immutable/)
    expect(await entry(e)).toMatchObject({ tracker_id: t, user_id: A })
  })

  it('keeps the newest write and the first created_at', async () => {
    const t = await putTracker(A)
    const e = await putEntry(A, t, { value: 1 })
    const createdAt = async () =>
      (await sql(db, 'select created_at::text as c from public.tracker_entries where id = $1', [e]))[0].c
    const first = await createdAt()
    await putEntry(A, t, { id: e, value: 2, updatedAt: '2000-01-01T00:00:00Z' })
    expect((await entry(e)).value).toBe(1)
    await putEntry(A, t, { id: e, value: 3, updatedAt: new Date(Date.now() + 86_400_000).toISOString() })
    expect((await entry(e)).value).toBe(3)
    const [r] = await sql(db, 'select updated_at <= now() as ok from public.tracker_entries where id = $1', [e])
    expect(r.ok).toBe(true)
    await asA(`update public.tracker_entries set created_at = '2001-01-01T00:00:00Z' where id = $1`, [e])
    expect(await createdAt()).toBe(first)
  })
})

describe('privacy', () => {
  it('has the 7 policies the SETUP check counts', async () => {
    const policies = await sql<{ tablename: string; cmd: string }>(db,
      `select tablename, cmd from pg_policies where tablename in ('trackers', 'tracker_entries') order by tablename, cmd`)
    expect(policies.map(p => `${p.tablename} ${p.cmd}`)).toEqual([
      'tracker_entries DELETE', 'tracker_entries INSERT', 'tracker_entries SELECT', 'tracker_entries UPDATE',
      'trackers INSERT', 'trackers SELECT', 'trackers UPDATE',
    ])
  })

  it('keeps trackers and entries to their owner', async () => {
    const t = await putTracker(A)
    const e = await putEntry(A, t, { value: 1 })

    expect(await rows(db, B, 'select * from public.trackers')).toEqual([])
    expect(await rows(db, B, 'select * from public.tracker_entries')).toEqual([])
    expect(await rows(db, B, `update public.trackers set name = 'Meu' where id = $1 returning 1`, [t])).toEqual([])
    expect(await rows(db, B, 'update public.tracker_entries set note = $1 where id = $2 returning 1', ['meu', e])).toEqual([])
    expect(await rows(db, B, 'delete from public.tracker_entries where id = $1 returning 1', [e])).toEqual([])
    await expect(rows(db, B, `insert into public.trackers (id, user_id, name, icon, kind, aggregate)
                              values (gen_random_uuid(), $1, 'Teu', 'book', 'duration', 'sum')`, [A]))
      .rejects.toThrow(/row-level security/)
    await expect(rows(db, null, 'select * from public.trackers')).rejects.toThrow(/permission denied/)
    await expect(rows(db, null, 'select * from public.tracker_entries')).rejects.toThrow(/permission denied/)

    expect(await rows(db, A, 'select id from public.trackers')).toEqual([{ id: t }])
    expect(await rows(db, A, 'select id from public.tracker_entries')).toEqual([{ id: e }])
    expect(await tracker(t)).toMatchObject({ name: 'Água' })
    expect(await entry(e)).toMatchObject({ note: null })
  })

  it('removes everything with the account', async () => {
    const t = await putTracker(A)
    await putEntry(A, t, { value: 1 })
    const l = await putTracker(A, { kind: 'label', name: 'Humor' })
    await putEntry(A, l, { option: 'a1' })
    const theirs = await putTracker(B)
    await putEntry(B, theirs, { value: 1 })

    await sql(db, 'delete from auth.users where id = $1', [A])
    expect(await sql(db, 'select user_id from public.trackers')).toEqual([{ user_id: B }])
    expect(await sql(db, 'select user_id from public.tracker_entries')).toEqual([{ user_id: B }])
  })
})
