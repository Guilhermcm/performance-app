import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHIM } from './helpers/db'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../release/0007-0016_nutrition.sql', import.meta.url))
const CHECKIN_BUNDLE = fileURLToPath(new URL('../release/0017-0020_checkin.sql', import.meta.url))
const SLEEP_BUNDLE = fileURLToPath(new URL('../release/0021-0025_sleep.sql', import.meta.url))
const HABITS_BUNDLE = fileURLToPath(new URL('../release/0026-0030_habits.sql', import.meta.url))
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

// Second release: production already has 0001 to 0016 (the nutrition bundle ran), with people,
// workouts and challenges in it. The check-in bundle goes in whole, once, in the SQL Editor.
describe('release bundle 0017-0020', () => {
  it('applies in one run on a database that has 0001 to 0016 and existing rows', async () => {
    const db = new PGlite()
    await db.exec(SHIM)
    for (const file of readdirSync(MIGRATIONS).filter(f => /^000[1-6]_.*\.sql$/.test(f)).sort()) {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    }
    await db.exec(readFileSync(BUNDLE, 'utf8'))
    await db.query('insert into auth.users (id, email) values ($1, $2)', [U, 'old@test.dev'])
    await db.query(`insert into public.profiles (id, display_name) values ($1, 'Old user')`, [U])
    await db.query(
      `insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
       values ($1, 'strength', 'workout_completed', current_date - 3, 'old-workout')`, [U])
    await db.query(
      `insert into public.challenges (template, title, mode, target, starts_on, ends_on, created_by)
       values ('workouts_count', 'Old challenge', 'team', 12, current_date - 3, current_date + 10, $1)`, [U])

    await db.exec(readFileSync(CHECKIN_BUNDLE, 'utf8'))

    const fn = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname = 'get_checkin_feed'`)
    expect(fn.rows[0].n).toBe(1)
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'checkins'`)
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const bucket = await db.query<{ id: string; public: boolean }>(
      `select id, public from storage.buckets where id = 'checkins'`)
    expect(bucket.rows).toEqual([{ id: 'checkins', public: false }])
    const since = await db.query<{ value: string }>(
      `select value #>> '{}' as value from public.app_settings where key = 'training_checkin_since'`)
    expect(since.rows).toHaveLength(1)
    const kept = await db.query<{ n: number }>(
      `select (select count(*) from public.activity_events where user_id = $1)::int
            + (select count(*) from public.challenges where created_by = $1)::int as n`, [U])
    expect(kept.rows[0].n).toBe(2)
    // An existing profile starts its check-ins on Friends and keeps its old sharing choice as it was.
    const profile = await db.query<{ checkin_visibility: string; share_activity: boolean }>(
      'select checkin_visibility, share_activity from public.profiles where id = $1', [U])
    expect(profile.rows).toEqual([{ checkin_visibility: 'friends', share_activity: false }])
    await db.close()
  })
})

// Third release: production already has 0001 to 0020 (nutrition and check-in bundles ran), with a
// nutrition period, check-ins with their photos in Storage and a checkin_days challenge going on.
// The sleep bundle goes in whole, once, in the SQL Editor.
describe('release bundle 0021-0025', () => {
  it('applies in one run on a database that has 0001 to 0020 and existing rows', async () => {
    const db = new PGlite()
    await db.exec(SHIM)
    for (const file of readdirSync(MIGRATIONS).filter(f => /^000[1-6]_.*\.sql$/.test(f)).sort()) {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    }
    await db.exec(readFileSync(BUNDLE, 'utf8'))
    await db.exec(readFileSync(CHECKIN_BUNDLE, 'utf8'))
    // The check-in release went out a week before this one.
    await db.exec(
      `update public.app_settings set value = to_jsonb(current_date - 7) where key = 'training_checkin_since'`)
    await db.query('insert into auth.users (id, email) values ($1, $2)', [U, 'old@test.dev'])
    await db.query(`insert into public.profiles (id, display_name) values ($1, 'Old user')`, [U])
    await db.query(`update public.profiles set nutrition_enabled = true where id = $1`, [U])
    await db.query(
      `insert into public.nutrition_periods (user_id, started_on) values ($1, current_date - 5)`, [U])
    // Yesterday's check-in, its photo in the owner's folder of the bucket.
    const checkin = '00000000-0000-4000-8000-0000000000c1'
    const photo = `${U}/${checkin}.jpg`
    await db.query(
      `insert into public.checkins (id, user_id, day, activity, title, visibility, photo_path)
       values ($1, $2, public.local_today($2) - 1, 'strength', 'Treino', 'friends', $3)`, [checkin, U, photo])
    await db.query(
      `insert into storage.objects (bucket_id, name, owner) values ('checkins', $1, $2)`, [photo, U])
    const challenge = await db.query<{ id: string }>(
      `insert into public.challenges (template, title, mode, target, starts_on, ends_on, created_by)
       values ('checkin_days', 'Old challenge', 'team', 5, current_date - 3, current_date + 10, $1)
       returning id`, [U])
    const id = challenge.rows[0].id
    await db.query(
      `insert into public.challenge_members (challenge_id, user_id, joined_at) values ($1, $2, now())`, [id, U])

    await db.exec(readFileSync(SLEEP_BUNDLE, 'utf8'))

    const fns = await db.query<{ proname: string; n: number }>(
      `select proname, count(*)::int as n from pg_proc
        where proname in ('create_challenge', 'join_challenge') group by proname order by proname`)
    expect(fns.rows).toEqual([{ proname: 'create_challenge', n: 1 }, { proname: 'join_challenge', n: 1 }])
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('sleep_logs', 'sleep_nights', 'sleep_periods', 'sleep_targets') and relkind = 'r'
        order by relname`)
    expect(rls.rows).toEqual([
      { relname: 'sleep_logs', relrowsecurity: true },
      { relname: 'sleep_nights', relrowsecurity: true },
      { relname: 'sleep_periods', relrowsecurity: true },
      { relname: 'sleep_targets', relrowsecurity: true },
    ])
    // An existing profile starts with Sleep off and the default of five nights a week.
    const profile = await db.query<{ sleep_enabled: boolean; sleep_nights_per_week: number }>(
      'select sleep_enabled, sleep_nights_per_week from public.profiles where id = $1', [U])
    expect(profile.rows).toEqual([{ sleep_enabled: false, sleep_nights_per_week: 5 }])
    // The checkin_days challenge still counts yesterday's training day once it closes (two days on).
    const progress = async () => (await db.query<{ v: string }>(
      'select public.challenge_progress($1, $2)::text as v', [id, U])).rows[0].v
    expect(await progress()).toBe('0')
    await db.query(`select set_config('app.now', (now() + interval '2 days')::text, false)`)
    const closed = await db.query<{ n: number }>('select public.close_all_training_days() as n')
    expect(closed.rows[0].n).toBe(1)
    expect(await progress()).toBe('1')
    await db.close()
  })
})

// Fourth release: production already has 0001 to 0025 (the Sleep bundle ran), with a profile that
// has Sleep on, a night logged and a sleep_nights_on_target challenge going on. The habits bundle
// goes in whole, once, in the SQL Editor.
describe('release bundle 0026-0030', () => {
  it('applies in one run on a database that has 0001 to 0025 and existing rows', async () => {
    const db = new PGlite()
    await db.exec(SHIM)
    for (const file of readdirSync(MIGRATIONS).filter(f => /^000[1-6]_.*\.sql$/.test(f)).sort()) {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    }
    await db.exec(readFileSync(BUNDLE, 'utf8'))
    await db.exec(readFileSync(CHECKIN_BUNDLE, 'utf8'))
    await db.exec(readFileSync(SLEEP_BUNDLE, 'utf8'))
    await db.query('insert into auth.users (id, email) values ($1, $2)', [U, 'old@test.dev'])
    await db.query(`insert into public.profiles (id, display_name) values ($1, 'Old user')`, [U])
    // Sleep on for ten days, a night three days ago logged and still to be closed.
    await db.query(`update public.profiles set sleep_enabled = true where id = $1`, [U])
    await db.query(
      `update public.sleep_periods set started_on = public.local_today($1) - 10 where user_id = $1`, [U])
    await db.query(
      `insert into public.sleep_targets (user_id, valid_from, goal_min, bed_target)
       values ($1, public.local_today($1) - 10, 480, '23:00')`, [U])
    await db.query(
      `insert into public.sleep_logs (user_id, night, bed_time, wake_time)
       values ($1, public.local_today($1) - 3, '23:00', '07:00')`, [U])
    const challenge = await db.query<{ id: string }>(
      `insert into public.challenges (template, title, mode, target, starts_on, ends_on, created_by)
       values ('sleep_nights_on_target', 'Old challenge', 'team', 5, current_date - 5, current_date + 10, $1)
       returning id`, [U])
    const id = challenge.rows[0].id
    await db.query(
      `insert into public.challenge_members (challenge_id, user_id, joined_at, share_sleep)
       values ($1, $2, now(), true)`, [id, U])

    await db.exec(readFileSync(HABITS_BUNDLE, 'utf8'))

    const fns = await db.query<{ proname: string; n: number }>(
      `select proname, count(*)::int as n from pg_proc
        where proname in ('create_challenge', 'join_challenge') group by proname order by proname`)
    expect(fns.rows).toEqual([{ proname: 'create_challenge', n: 1 }, { proname: 'join_challenge', n: 1 }])
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('habits', 'habit_checks', 'habit_targets', 'habit_periods', 'habit_days')
          and relkind = 'r' order by relname`)
    expect(rls.rows).toEqual([
      { relname: 'habit_checks', relrowsecurity: true },
      { relname: 'habit_days', relrowsecurity: true },
      { relname: 'habit_periods', relrowsecurity: true },
      { relname: 'habit_targets', relrowsecurity: true },
      { relname: 'habits', relrowsecurity: true },
    ])
    // An existing profile starts with Habits off and keeps Sleep on.
    const profile = await db.query<{ habits_enabled: boolean; sleep_enabled: boolean }>(
      'select habits_enabled, sleep_enabled from public.profiles where id = $1', [U])
    expect(profile.rows).toEqual([{ habits_enabled: false, sleep_enabled: true }])
    // The sleep challenge still counts the night once it closes (two days on), with the new bodies.
    const progress = async () => (await db.query<{ v: string }>(
      'select public.challenge_progress($1, $2)::text as v', [id, U])).rows[0].v
    expect(await progress()).toBe('0')
    const closed = await db.query<{ n: number }>('select public.close_all_sleep_nights() as n')
    expect(closed.rows[0].n).toBe(1)
    expect(await progress()).toBe('1')
    await db.close()
  })
})
