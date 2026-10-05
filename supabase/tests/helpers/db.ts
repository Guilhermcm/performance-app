import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url))

// The minimum of Supabase that the migrations lean on: the auth schema, auth.uid() read from the
// JWT claim PostgREST sets, and the two client roles. Supabase also grants the client roles every
// privilege on new objects in public by default, so RLS (not missing grants) is what keeps users
// apart; the shim does the same so the tests exercise the policies.
const SHIM = `
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SHIM)
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

export async function addUser(db: PGlite, uid: string, email = `${uid.slice(0, 8)}@test.dev`) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [uid, email])
}

export async function asUser<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}
