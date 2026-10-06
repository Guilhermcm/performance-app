import { PGlite } from '@electric-sql/pglite'
import { vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url))

// The minimum of Supabase that the migrations lean on: the auth schema, auth.uid() read from the
// JWT claim PostgREST sets, and the two client roles. Supabase also grants the client roles every
// privilege on new objects in public by default, so RLS (not missing grants) is what keeps users
// apart; the shim does the same so the tests exercise the policies.
export const SHIM = `
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

-- A skeleton of Supabase Storage: just enough for a migration to create a bucket and policies on
-- storage.objects, and for the tests to run those policies. As in Supabase, both tables have RLS on
-- and the client roles hold every privilege, so the policies alone decide. foldername() is
-- Supabase's: the path split on '/', without the file name.
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets,
  name text,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated;
grant all on storage.buckets, storage.objects to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
`

// Every SQL test file loads this helper. Booting PGlite and running the migrations takes about
// 2 s alone and far longer when the whole suite runs in parallel, which broke the default 10 s
// hook timeout on the first test of a file. The generous limit applies to the hooks and tests
// these files register (vitest reads the default when a hook is declared, after this import).
vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 })

// The migrated cluster is built once per test file and dumped; each fresh database boots from that
// dump (about 4x faster than replaying the migrations), so tests stay fully isolated.
let template: Promise<Blob> | undefined

async function migratedDump(): Promise<Blob> {
  const db = new PGlite()
  await db.exec(SHIM)
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  const dump = await db.dumpDataDir('none')
  await db.close()
  return dump
}

export async function freshDb(): Promise<PGlite> {
  template ??= migratedDump()
  return PGlite.create({ loadDataDir: await template })
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
