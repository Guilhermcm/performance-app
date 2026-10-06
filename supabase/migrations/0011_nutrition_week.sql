-- Phase 2a, the nutrition week: the nutrition_week streak (spec 4.3, 6.4) with shields and neutral
-- weeks (spec 3.4), the private nutrition badges and their metrics, the day history RPC and the
-- daily safety net that 0013 schedules.

-- Weekly streak ---------------------------------------------------------------------------------
-- Its own function: close_weeks (strength) does not change. A week is judged once its seven days
-- have closed (week_start + 6 <= local_today - 2) and closed days never reopen, so a verdict is
-- final and nothing is ever replayed.
--   goal met                        -> +1 (and a shield every 4, at most 2)
--   a day outside a period, missed  -> neutral: nothing changes (the activation week included)
--   missed with a streak and shield -> the shield goes, the streak stays
--   otherwise                       -> 0

create function public.close_nutrition_weeks(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last   date;
  v_s      public.streaks%rowtype;
  v_week   date;
  v_judged integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  -- The last week whose seven days have all closed.
  v_last := public.local_today(p_user) - 8;
  insert into public.streaks (user_id, kind) values (p_user, 'nutrition_week') on conflict do nothing;
  select * into v_s from public.streaks where user_id = p_user and kind = 'nutrition_week' for update;

  if v_s.last_period is null then
    select public.week_start_of(min(started_on)) into v_week
      from public.nutrition_periods where user_id = p_user;
  else
    v_week := v_s.last_period + 7;
  end if;

  while v_week is not null and v_week <= v_last loop
    if exists (select 1 from public.xp_ledger
                where user_id = p_user and reason = 'nutrition_week_target' and week_start = v_week) then
      v_s.current := v_s.current + 1;
      v_s.best := greatest(v_s.best, v_s.current);
      if v_s.current % 4 = 0 then v_s.shields := least(2, v_s.shields + 1); end if;
    elsif exists (select 1 from generate_series(v_week, v_week + 6, interval '1 day') d
                   where not public.nutrition_active_on(p_user, d::date)) then
      null;   -- neutral week
    elsif v_s.current > 0 and v_s.shields > 0 then
      v_s.shields := v_s.shields - 1;
    else
      v_s.current := 0;
    end if;
    v_s.last_period := v_week;
    v_week := v_week + 7;
    v_judged := v_judged + 1;
  end loop;

  if v_judged > 0 then
    update public.streaks
       set current = v_s.current, best = v_s.best, shields = v_s.shields, last_period = v_s.last_period
     where user_id = p_user and kind = 'nutrition_week';
    -- Streak badges for people who only meet the cron.
    perform public.evaluate_achievements(p_user);
  end if;
end $$;

revoke all on function public.close_nutrition_weeks(uuid) from public, anon, authenticated;

-- Closing days ----------------------------------------------------------------------------------
-- Same as 0010 with two changes: the scan starts the day after the last closed day (a day skipped
-- once, outside a period or without a target, can never become judgeable later, so it is safe and
-- keeps every call short), and the weeks are judged at the end.

create or replace function public.close_nutrition_days(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_first  date;
  v_last   date;
  v_day    date;
  v_t      public.nutrition_targets;
  v_target jsonb;
  v_kcal   numeric;
  v_prot   numeric;
  v_carbs  numeric;
  v_fat    numeric;
  v_meals  integer;
  v_class  jsonb;
  v_ref    text;
  n        integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  select min(started_on) into v_first from public.nutrition_periods where user_id = p_user;
  if v_first is null then return 0; end if;
  -- Imported days (2b) are history and do not mark how far closing went.
  select greatest(v_first, max(day) + 1) into v_first
    from public.nutrition_days where user_id = p_user and not imported;
  v_last := public.local_today(p_user) - 2;

  for v_day in
    select d::date from generate_series(v_first, v_last, interval '1 day') d
     where not exists (select 1 from public.nutrition_days x where x.user_id = p_user and x.day = d::date)
     order by 1
  loop
    continue when not public.nutrition_active_on(p_user, v_day);
    select * into v_t from public.target_on(p_user, v_day);
    continue when v_t.valid_from is null;
    v_target := jsonb_build_object('kcal', v_t.kcal, 'protein_g', v_t.protein_g,
                                   'carbs_g', v_t.carbs_g, 'fat_g', v_t.fat_g);

    select coalesce(sum(kcal), 0), coalesce(sum(protein_g), 0), coalesce(sum(carbs_g), 0),
           coalesce(sum(fat_g), 0), count(distinct meal)
      into v_kcal, v_prot, v_carbs, v_fat, v_meals
      from public.food_logs where user_id = p_user and day = v_day;
    v_class := public.classify_nutrition_day(v_kcal, v_prot, v_carbs, v_fat, v_meals, v_target);

    insert into public.nutrition_days
      (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, target, logged, on_target, balanced)
    values (p_user, v_day, v_kcal, v_prot, v_carbs, v_fat, v_meals, v_target,
            (v_class ->> 'logged')::boolean, (v_class ->> 'on_target')::boolean,
            (v_class ->> 'balanced')::boolean);

    v_ref := 'nutrition:' || to_char(v_day, 'YYYY-MM-DD');
    if (v_class ->> 'logged')::boolean then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'nutrition', 'day_logged', v_day, v_ref) on conflict do nothing;
    end if;
    if (v_class ->> 'on_target')::boolean then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'nutrition', 'day_on_target', v_day, v_ref) on conflict do nothing;
    end if;
    if (v_class ->> 'balanced')::boolean then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'nutrition', 'macros_balanced', v_day, v_ref) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;

  perform public.close_nutrition_weeks(p_user);
  return n;
end $$;

revoke all on function public.close_nutrition_days(uuid) from public, anon, authenticated;

-- Daily safety net (0013 schedules it) ------------------------------------------------------------
-- Everyone with an open period, or with a closed period whose last week is not judged yet (its
-- days may still be pending too). Returns how many people it went through.

create function public.close_all_nutrition_days() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct p.user_id from public.nutrition_periods p
      left join public.streaks s on s.user_id = p.user_id and s.kind = 'nutrition_week'
     where p.ended_on is null or p.ended_on >= coalesce(s.last_period + 7, p.started_on)
  loop
    perform public.close_nutrition_days(r.user_id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.close_all_nutrition_days() from public, anon, authenticated;

-- Badges ------------------------------------------------------------------------------------------
-- Private badges are never shown to friends (progress_card leaves them out from 0012 on).
-- Mirrored by src/features/gamification/achievements.ts (gamification-catalog.test.ts).

alter table public.achievement_catalog add column private boolean not null default false;
alter table public.achievement_catalog drop constraint achievement_catalog_metric_check;
alter table public.achievement_catalog add constraint achievement_catalog_metric_check check (metric in (
  'workouts', 'prs', 'week_targets', 'best_streak', 'weigh_in_run', 'level', 'early_workouts', 'friends',
  'challenges_won', 'nutrition_logged_days', 'nutrition_on_target_days', 'nutrition_week_targets',
  'nutrition_best_streak', 'protein_best_run'));

insert into public.achievement_catalog (code, metric, threshold, xp, sort, private) values
  ('nutrition_first_day',     'nutrition_logged_days',      1,   50, 300, true),
  ('nutrition_days_10',       'nutrition_on_target_days',  10,  100, 310, true),
  ('nutrition_days_50',       'nutrition_on_target_days',  50,  200, 320, true),
  ('nutrition_days_100',      'nutrition_on_target_days', 100,  300, 330, true),
  ('nutrition_days_250',      'nutrition_on_target_days', 250,  500, 340, true),
  ('nutrition_week_target_1', 'nutrition_week_targets',     1,   75, 350, true),
  ('nutrition_streak_4',      'nutrition_best_streak',      4,  150, 360, true),
  ('nutrition_streak_12',     'nutrition_best_streak',     12,  400, 370, true),
  ('nutrition_streak_26',     'nutrition_best_streak',     26,  800, 380, true),
  ('protein_7',               'protein_best_run',           7,  100, 390, true);

-- Achievement metrics: 0004's, plus the nutrition ones. Imported days (2b) never count.

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events where user_id = p_user and kind = 'workout_completed'),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger where user_id = p_user and reason = 'week_target'),
    'best_streak', coalesce((select best from public.streaks where user_id = p_user and kind = 'training_week'), 0),
    -- Longest run of consecutive weigh-in days (gaps and islands).
    'weigh_in_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select d - (row_number() over (order by d))::int as grp
            from (select distinct occurred_on as d from public.activity_events
                   where user_id = p_user and kind = 'weight_logged') days
        ) runs group by grp
      ) lengths), 0),
    -- Live sessions only: the app sends the local start hour for those, never for backfills.
    'early_workouts', (select count(*) from public.activity_events
                        where user_id = p_user and kind = 'workout_completed'
                          and jsonb_typeof(payload -> 'hour') = 'number' and (payload ->> 'hour')::numeric < 7),
    'friends', (select count(*) from public.friendships where p_user in (user_a, user_b)),
    'challenges_won', (select count(*) from public.challenge_members where user_id = p_user and won),
    'nutrition_logged_days', (select count(*) from public.nutrition_days
                               where user_id = p_user and not imported and logged),
    'nutrition_on_target_days', (select count(*) from public.nutrition_days
                                  where user_id = p_user and not imported and on_target),
    'nutrition_week_targets', (select count(*) from public.xp_ledger
                                where user_id = p_user and reason = 'nutrition_week_target'),
    'nutrition_best_streak', coalesce((select best from public.streaks
                                        where user_id = p_user and kind = 'nutrition_week'), 0),
    -- Longest run of consecutive closed days with protein at or above the target in force.
    'protein_best_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select day - (row_number() over (order by day))::int as grp
            from public.nutrition_days
           where user_id = p_user and not imported
             and protein_g >= (target ->> 'protein_g')::numeric
        ) runs group by grp
      ) lengths), 0)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;

-- Day history -------------------------------------------------------------------------------------
-- The closed days of a range (at most 62 days) and the target in force today. Closes the pending
-- days first, so it is volatile.

create function public.get_nutrition_days(p_from date, p_to date) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.nutrition_targets;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 62 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  perform public.close_nutrition_days(v_uid);
  select * into v_t from public.target_on(v_uid, public.local_today(v_uid));
  return jsonb_build_object(
    'target', case when v_t.valid_from is null then null else jsonb_build_object(
      'valid_from', v_t.valid_from, 'mode', v_t.mode, 'kcal', v_t.kcal, 'protein_g', v_t.protein_g,
      'carbs_g', v_t.carbs_g, 'fat_g', v_t.fat_g) end,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'kcal', d.kcal, 'protein_g', d.protein_g, 'carbs_g', d.carbs_g,
               'fat_g', d.fat_g, 'meals', d.meals, 'target', d.target, 'logged', d.logged,
               'on_target', d.on_target, 'balanced', d.balanced, 'imported', d.imported) order by d.day)
        from public.nutrition_days d
       where d.user_id = v_uid and d.day between p_from and p_to), '[]'::jsonb));
end $$;

revoke all on function public.get_nutrition_days(date, date) from public, anon;
grant execute on function public.get_nutrition_days(date, date) to authenticated;
