-- Phase 3, night closing: night D closes at the start of D+2 local (spec 4.4), its snapshot goes to
-- sleep_nights and the server-only events it earns pay sleep XP through award_xp (spec 5.1, 5.2, 6.3).

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
  return n;
end $$;

revoke all on function public.classify_sleep_night(time, int, int, jsonb),
  public.close_sleep_nights(uuid) from public, anon, authenticated;

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
