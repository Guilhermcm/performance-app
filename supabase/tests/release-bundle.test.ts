import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHIM } from './helpers/db'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../release/0007-0016_nutrition.sql', import.meta.url))
const U = '00000000-0000-4000-8000-000000000001'

// Production already runs 0001 to 0006 with real people in it; the owner pastes the bundle once in
// the SQL Editor. This replays that: the old schema, an existing profile, then the bundle in one go.
describe('release bundle 0007-0016', () => {
  it('applies in one run on a database that has 0001 to 0006 and existing rows', async () => {
    const db = new PGlite()
    await db.exec(SHIM)
    for (const file of readdirSync(MIGRATIONS).filter(f => /^000[1-6]_.*\.sql$/.test(f)).sort()) {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    }
    await db.query('insert into auth.users (id, email) values ($1, $2)', [U, 'old@test.dev'])
    await db.query(`insert into public.profiles (id, display_name) values ($1, 'Old user')`, [U])

    await db.exec(readFileSync(BUNDLE, 'utf8'))

    const fns = await db.query<{ proname: string; n: number }>(
      `select proname, count(*)::int as n from pg_proc
        where proname in ('create_challenge', 'join_challenge') group by proname order by proname`)
    expect(fns.rows).toEqual([{ proname: 'create_challenge', n: 1 }, { proname: 'join_challenge', n: 1 }])
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'food_measures'`)
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const profile = await db.query<{ nutrition_enabled: boolean }>(
      'select nutrition_enabled from public.profiles where id = $1', [U])
    expect(profile.rows[0].nutrition_enabled).toBe(false)
    await db.close()
  })
})
