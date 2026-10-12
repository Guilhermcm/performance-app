-- Phase 3, night closing: night D closes at the start of D+2 local (spec 4.4), its snapshot goes to
-- sleep_nights and the server-only events it earns pay sleep XP through award_xp (spec 5.1, 5.2, 6.3).
-- Then the sleep_week streak, the daily safety net and the private sleep badges (spec 5.3, 5.4).

-- Closed nights ---------------------------------------------------------------------------------
-- A snapshot of the log and of the target in force, so metrics and history never read sleep_logs.

create table public.sleep_nights (
  user_id      uuid not null references auth.users on delete cascade,
  night        date not null,
  target       jsonb,              -- {goal_min, bed_target}; null without a target in force
  logged       boolean not null,
  duration_min smallint,           -- snapshot of the log, null without one
  bed_diff_min smallint,
  quality      smallint,
  on_target    boolean not null,
  rested       boolean not null,
  closed_at    timestamptz not null default now(),
  primary key (user_id, night)
);

alter table public.sleep_nights enable row level security;
create policy sleep_nights_select_own on public.sleep_nights
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.sleep_nights from anon, authenticated;
revoke select on public.sleep_nights from anon;

-- Classification (spec 4.2) ---------------------------------------------------------------------
-- bed_diff_min is the circular distance to the bedtime target, from 0 to 720. Limits are inclusive.
-- A null p_bed is a night without a log; a null p_target is a night without a target in force.

create function public.classify_sleep_night(p_bed time, p_duration int, p_quality int, p_target jsonb)
returns jsonb
language plpgsql immutable security definer set search_path = public as $$
declare
  v_logged boolean := p_bed is not null;
  v_d      int;
  v_diff   int;
  v_on     boolean := false;
  v_rested boolean := false;
begin
  if v_logged and p_target is not null then
    v_d := abs(extract(epoch from (p_bed - (p_target ->> 'bed_target')::time))::int / 60);
    v_diff := least(v_d, 1440 - v_d);
    v_on := coalesce(p_duration >= (p_target ->> 'goal_min')::int - 15 and v_diff <= 45, false);
    v_rested := v_on and coalesce(p_quality >= 4, false);
  end if;
  return jsonb_build_object('logged', v_logged, 'on_target', v_on, 'rested', v_rested, 'bed_diff_min', v_diff);
end $$;

-- Weekly streak (spec 5.3) ---------------------------------------------------------------------
-- In the mould of close_nutrition_weeks (0011). A week is judged once its seven nights have closed
-- (week_start + 6 <= local_today - 2, Tuesday morning) and closed nights never reopen, so a verdict
-- is final and nothing is ever replayed.
--   goal met                          -> +1 (and a shield every 4, at most 2)
--   a night outside a period, missed  -> neutral: nothing changes (the activation week included)
--   missed with a streak and shield   -> the shield goes, the streak stays
--   otherwise                         -> 0
-- It ends looking at the badges, so every close does (spec 4.4, step 4).

create function public.close_sleep_weeks(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last   date;
  v_s      public.streaks%rowtype;
  v_week   date;
  v_judged integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  -- The last week whose seven nights have all closed.
  v_last := public.local_today(p_user) - 8;
  insert into public.streaks (user_id, kind) values (p_user, 'sleep_week') on conflict do nothing;
  select * into v_s from public.streaks where user_id = p_user and kind = 'sleep_week' for update;

  if v_s.last_period is null then
    select public.week_start_of(min(started_on)) into v_week
      from public.sleep_periods where user_id = p_user;
  else
    v_week := v_s.last_period + 7;
  end if;

  while v_week is not null and v_week <= v_last loop
    if exists (select 1 from public.xp_ledger
                where user_id = p_user and reason = 'sleep_week_target' and week_start = v_week) then
      v_s.current := v_s.current + 1;
      v_s.best := greatest(v_s.best, v_s.current);
      if v_s.current % 4 = 0 then v_s.shields := least(2, v_s.shields + 1); end if;
    elsif exists (select 1 from generate_series(v_week, v_week + 6, interval '1 day') d
                   where not public.sleep_active_on(p_user, d::date)) then
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
     where user_id = p_user and kind = 'sleep_week';
  end if;
  perform public.evaluate_achievements(p_user);
end $$;

revoke all on function public.close_sleep_weeks(uuid) from public, anon, authenticated;

-- Closing ---------------------------------------------------------------------------------------
-- Every pending night from the day after the last closed one (or the first period) up to
-- local_today - 2, skipping nights outside a period. A night without a target in force still gets
-- its row but is not judged and pays nothing (plan decision 5). Runs as the owner: the server-only
-- events pass RLS and the 14-day window, and award_xp pays them.

create function public.close_sleep_nights(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_first  date;
  v_last   date;
  v_night  date;
  v_t      public.sleep_targets;
  v_target jsonb;
  v_log    public.sleep_logs;
  v_class  jsonb;
  v_ref    text;
  n        integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  select min(started_on) into v_first from public.sleep_periods where user_id = p_user;
  if v_first is null then return 0; end if;
  select greatest(v_first, max(night) + 1) into v_first from public.sleep_nights where user_id = p_user;
  v_last := public.local_today(p_user) - 2;

  for v_night in
    select d::date from generate_series(v_first, v_last, interval '1 day') d
     where not exists (select 1 from public.sleep_nights x where x.user_id = p_user and x.night = d::date)
     order by 1
  loop
    continue when not public.sleep_active_on(p_user, v_night);
    select * into v_t from public.sleep_target_on(p_user, v_night);
    v_target := case when v_t.valid_from is null then null
                     else jsonb_build_object('goal_min', v_t.goal_min,
                                             'bed_target', to_char(v_t.bed_target, 'HH24:MI')) end;
    select * into v_log from public.sleep_logs where user_id = p_user and night = v_night;
    v_class := public.classify_sleep_night(v_log.bed_time, v_log.duration_min, v_log.quality, v_target);

    insert into public.sleep_nights
      (user_id, night, target, logged, duration_min, bed_diff_min, quality, on_target, rested)
    values (p_user, v_night, v_target, (v_class ->> 'logged')::boolean, v_log.duration_min,
            (v_class ->> 'bed_diff_min')::smallint, v_log.quality,
            (v_class ->> 'on_target')::boolean, (v_class ->> 'rested')::boolean);

    if v_target is not null then
      v_ref := 'sleep:' || to_char(v_night, 'YYYY-MM-DD');
      if (v_class ->> 'logged')::boolean then
        insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
        values (p_user, 'sleep', 'night_logged', v_night, v_ref) on conflict do nothing;
      end if;
      if (v_class ->> 'on_target')::boolean then
        insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
        values (p_user, 'sleep', 'night_on_target', v_night, v_ref) on conflict do nothing;
      end if;
      if (v_class ->> 'rested')::boolean then
        insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
        values (p_user, 'sleep', 'night_rested', v_night, v_ref) on conflict do nothing;
      end if;
    end if;
    n := n + 1;
  end loop;

  -- Even when no night closed: a week may be due, and the badges are looked at on every close.
  perform public.close_sleep_weeks(p_user);
  return n;
end $$;

revoke all on function public.classify_sleep_night(time, int, int, jsonb),
  public.close_sleep_nights(uuid) from public, anon, authenticated;

-- Daily safety net (0025 schedules it) ----------------------------------------------------------
-- Visits everyone with an open period, or with a closed period whose last week is not judged yet
-- (its nights may still be pending too, and that week still has to be judged). Returns how many of
-- them had nights pending, so a second run the same day returns 0.

create function public.close_all_sleep_nights() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct p.user_id from public.sleep_periods p
      left join public.streaks s on s.user_id = p.user_id and s.kind = 'sleep_week'
     where p.ended_on is null or p.ended_on >= coalesce(s.last_period + 7, p.started_on)
  loop
    if public.close_sleep_nights(r.user_id) > 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function public.close_all_sleep_nights() from public, anon, authenticated;

-- XP per event: the sleep branch (spec 5.1, 5.2) ------------------------------------------------
-- 0020's body with the sleep branch added, in the mould of the nutrition one. Sleep has its own
-- reasons, so nothing of Treino or Nutrition ever counts them. Weekly max 960.

create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_week   date := public.week_start_of(new.occurred_on);
  v_target smallint;
  v_count  integer;
begin
  -- One award at a time per user: the counts below decide the amount.
  perform pg_advisory_xact_lock(hashtextextended('xp:' || new.user_id::text, 0));

  if new.pillar = 'nutrition' then
    if new.kind = 'day_on_target' then
      v_target := public.week_target_for(new.user_id, v_week, 'nutrition');
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'nutrition_day';
      if v_count < v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'nutrition', public.session_xp(v_target, v_count + 1), 'nutrition_day', new.id, v_week);
        if v_count + 1 = v_target then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'nutrition', 150, 'nutrition_week_target', new.id, v_week);
        end if;
      else
        select count(*) into v_count from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason = 'nutrition_day_extra';
        if v_count < 2 then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'nutrition', 25, 'nutrition_day_extra', new.id, v_week);
        end if;
      end if;
    elsif new.kind = 'macros_balanced' then
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'nutrition_balanced';
      if v_count < 3 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'nutrition', 30, 'nutrition_balanced', new.id, v_week);
      end if;
    elsif new.kind = 'day_logged' then
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'nutrition_logged' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'nutrition', 10, 'nutrition_logged', new.id, v_week);
      end if;
    end if;
    perform public.evaluate_achievements(new.user_id);
    return null;
  end if;

  if new.pillar = 'sleep' then
    if new.kind = 'night_on_target' then
      v_target := public.week_target_for(new.user_id, v_week, 'sleep');
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'sleep_night';
      if v_count < v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'sleep', public.session_xp(v_target, v_count + 1), 'sleep_night', new.id, v_week);
        if v_count + 1 = v_target then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'sleep', 150, 'sleep_week_target', new.id, v_week);
        end if;
      else
        select count(*) into v_count from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason = 'sleep_night_extra';
        if v_count < 2 then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'sleep', 25, 'sleep_night_extra', new.id, v_week);
        end if;
      end if;
    elsif new.kind = 'night_rested' then
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'sleep_rested';
      if v_count < 3 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'sleep', 30, 'sleep_rested', new.id, v_week);
      end if;
    elsif new.kind = 'night_logged' then
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'sleep_logged' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'sleep', 10, 'sleep_logged', new.id, v_week);
      end if;
    end if;
    perform public.evaluate_achievements(new.user_id);
    return null;
  end if;

  if new.pillar <> 'strength' then return null; end if;

  if new.kind in ('workout_completed', 'training_day') then
    if new.kind = 'workout_completed' then
      -- From the cutover on, the day is paid by its check-in when it closes.
      if new.occurred_on >= public.training_checkin_since() then
        perform public.evaluate_achievements(new.user_id);
        return null;
      end if;
      -- A day before the cutover already paid by its check-in pays nothing again.
      if exists (select 1 from public.training_days
                  where user_id = new.user_id and day = new.occurred_on and checked and not legacy) then
        perform public.evaluate_achievements(new.user_id);
        return null;
      end if;
      update public.training_days set checked = true, legacy = true
       where user_id = new.user_id and day = new.occurred_on;
    else
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'training_logged' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 10, 'training_logged', new.id, v_week);
      end if;
    end if;

    v_target := public.week_target_for(new.user_id, v_week, 'strength');
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason in ('workout', 'training_day');
    if v_count < v_target then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', public.session_xp(v_target, v_count + 1),
              case when new.kind = 'training_day' then 'training_day' else 'workout' end, new.id, v_week);
      if v_count + 1 = v_target and not exists (
        select 1 from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason in ('week_target', 'training_week_target')
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150,
                case when new.kind = 'training_day' then 'training_week_target' else 'week_target' end,
                new.id, v_week);
        -- A goal met in a week already judged changes that week's verdict: replay the streak.
        if exists (select 1 from public.streaks
                    where user_id = new.user_id and kind = 'training_week' and last_period >= v_week) then
          perform public.close_weeks(new.user_id, true);
        end if;
      end if;
    else
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason in ('workout_extra', 'training_day_extra');
      if v_count < 2 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 25,
                case when new.kind = 'training_day' then 'training_day_extra' else 'workout_extra' end,
                new.id, v_week);
      end if;
    end if;
  elsif new.kind = 'training_detailed' then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'training_detailed';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'training_detailed', new.id, v_week);
    end if;
  elsif new.kind = 'pr' and new.occurred_on < public.training_checkin_since() then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'pr';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'pr', new.id, v_week);
    end if;
  elsif new.kind = 'weight_logged' and new.occurred_on < public.training_checkin_since() then
    if not exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = new.user_id and l.reason = 'weight' and e.occurred_on = new.occurred_on
    ) then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 10, 'weight', new.id, v_week);
    end if;
  end if;
  perform public.evaluate_achievements(new.user_id);
  return null;
end $$;

revoke all on function public.award_xp() from public, anon, authenticated;

-- Badges (spec 5.4) -----------------------------------------------------------------------------
-- All private: never shown to friends. Mirrored by src/features/gamification/achievements.ts
-- (gamification-catalog.test.ts). The metric check is 0011's with the five sleep metrics.

alter table public.achievement_catalog drop constraint achievement_catalog_metric_check;
alter table public.achievement_catalog add constraint achievement_catalog_metric_check check (metric in (
  'workouts', 'prs', 'week_targets', 'best_streak', 'weigh_in_run', 'level', 'early_workouts', 'friends',
  'challenges_won', 'nutrition_logged_days', 'nutrition_on_target_days', 'nutrition_week_targets',
  'nutrition_best_streak', 'protein_best_run', 'sleep_logged_nights', 'sleep_on_target_nights',
  'sleep_week_targets', 'sleep_best_streak', 'sleep_clock_best_run'));

insert into public.achievement_catalog (code, metric, threshold, xp, sort, private) values
  ('sleep_first_night',   'sleep_logged_nights',      1,   50, 400, true),
  ('sleep_nights_10',     'sleep_on_target_nights',  10,  100, 410, true),
  ('sleep_nights_50',     'sleep_on_target_nights',  50,  200, 420, true),
  ('sleep_nights_100',    'sleep_on_target_nights', 100,  300, 430, true),
  ('sleep_nights_250',    'sleep_on_target_nights', 250,  500, 440, true),
  ('sleep_week_target_1', 'sleep_week_targets',       1,   75, 450, true),
  ('sleep_streak_4',      'sleep_best_streak',        4,  150, 460, true),
  ('sleep_streak_12',     'sleep_best_streak',       12,  400, 470, true),
  ('sleep_streak_26',     'sleep_best_streak',       26,  800, 480, true),
  ('sleep_clock_7',       'sleep_clock_best_run',     7,  100, 490, true);

-- Achievement metrics ---------------------------------------------------------------------------
-- 0020's, with the sleep ones. They read only the closed nights (sleep_nights) and the ledger.

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events e
                  where e.user_id = p_user and e.kind = 'workout_completed'
                    and e.occurred_on < public.training_checkin_since()
                    and not exists (select 1 from public.training_days t
                                     where t.user_id = p_user and t.day = e.occurred_on
                                       and t.checked and not t.legacy))
              + (select count(*) from public.training_days where user_id = p_user and checked and not legacy),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger
                      where user_id = p_user and reason in ('week_target', 'training_week_target')),
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
      ) lengths), 0),
    'sleep_logged_nights', (select count(*) from public.sleep_nights where user_id = p_user and logged),
    'sleep_on_target_nights', (select count(*) from public.sleep_nights where user_id = p_user and on_target),
    'sleep_week_targets', (select count(*) from public.xp_ledger
                            where user_id = p_user and reason = 'sleep_week_target'),
    'sleep_best_streak', coalesce((select best from public.streaks
                                    where user_id = p_user and kind = 'sleep_week'), 0),
    -- Longest run of consecutive closed nights, all logged, in bed within 30 minutes of the target.
    -- A night without a log, without a target or outside a period breaks it.
    'sleep_clock_best_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select night - (row_number() over (order by night))::int as grp
            from public.sleep_nights
           where user_id = p_user and logged and bed_diff_min <= 30
        ) runs group by grp
      ) lengths), 0)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;
