-- Weekly targets per pillar (phase 2a, spec 5.5). weekly_targets gains a pillar and every reader
-- of the table changes with it. Bodies copied from 0002_gamification.sql; only the pillar lines differ.

alter table public.weekly_targets
  add column pillar public.pillar not null default 'strength';
alter table public.weekly_targets drop constraint weekly_targets_pkey;
alter table public.weekly_targets add primary key (user_id, pillar, week_start);

-- The signature changes, so the old function goes first (a default would leave two overloads).
drop function public.week_target_for(uuid, date);

create function public.week_target_for(p_user uuid, p_week date, p_pillar public.pillar default 'strength')
returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v smallint;
begin
  select target into v from public.weekly_targets
   where user_id = p_user and pillar = p_pillar and week_start = p_week;
  if found then return v; end if;
  -- A week nothing touched while it ran: the value in force then is the one frozen for the next
  -- touched week after it or, failing that, the profile's.
  select target into v from public.weekly_targets
   where user_id = p_user and pillar = p_pillar and week_start > p_week order by week_start limit 1;
  if v is null then
    if p_pillar = 'nutrition' then
      select nutrition_days_per_week into v from public.profiles where id = p_user;
    else
      select days_per_week into v from public.profiles where id = p_user;
    end if;
  end if;
  insert into public.weekly_targets (user_id, pillar, week_start, target)
  values (p_user, p_pillar, p_week, coalesce(v, case when p_pillar = 'nutrition' then 5 else 3 end))
  on conflict do nothing;
  select target into v from public.weekly_targets
   where user_id = p_user and pillar = p_pillar and week_start = p_week;
  return v;
end $$;

-- Changing a pillar's days per week freezes the running week with the old value first.
create or replace function public.freeze_week_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.days_per_week is distinct from old.days_per_week then
    insert into public.weekly_targets (user_id, pillar, week_start, target)
    values (old.id, 'strength', public.local_week_start(old.id), old.days_per_week)
    on conflict do nothing;
  end if;
  if new.nutrition_days_per_week is distinct from old.nutrition_days_per_week then
    insert into public.weekly_targets (user_id, pillar, week_start, target)
    values (old.id, 'nutrition', public.local_week_start(old.id), old.nutrition_days_per_week)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger profiles_freeze_target on public.profiles;
create trigger profiles_freeze_target
  before update of days_per_week, nutrition_days_per_week on public.profiles
  for each row execute function public.freeze_week_target();

revoke all on function public.week_target_for(uuid, date, public.pillar) from public, anon, authenticated;

create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_week   date := public.week_start_of(new.occurred_on);
  v_target smallint;
  v_count  integer;
begin
  -- One award at a time per user: the counts below decide the amount.
  perform pg_advisory_xact_lock(hashtextextended('xp:' || new.user_id::text, 0));
  if new.pillar <> 'strength' then return null; end if;

  if new.kind = 'workout_completed' then
    v_target := public.week_target_for(new.user_id, v_week, 'strength');
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'workout';
    if v_count < v_target then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', public.session_xp(v_target, v_count + 1), 'workout', new.id, v_week);
      if v_count + 1 = v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150, 'week_target', new.id, v_week);
        -- A goal met in a week already judged (a session logged into the past) changes that
        -- week's verdict: replay the streak from the start.
        if exists (select 1 from public.streaks
                    where user_id = new.user_id and kind = 'training_week' and last_period >= v_week) then
          perform public.close_weeks(new.user_id, true);
        end if;
      end if;
    else
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'workout_extra';
      if v_count < 2 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 25, 'workout_extra', new.id, v_week);
      end if;
    end if;
  elsif new.kind = 'pr' then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'pr';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'pr', new.id, v_week);
    end if;
  elsif new.kind = 'weight_logged' then
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

create or replace function public.progress_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_week   date := public.local_week_start(p_user);
  v_total  bigint := public.total_xp(p_user);
  v_target smallint;
  v_streak public.streaks%rowtype;
  v_count  jsonb;
begin
  v_target := coalesce(
    (select target from public.weekly_targets where user_id = p_user and pillar = 'strength' and week_start = v_week),
    (select days_per_week from public.profiles where id = p_user), 3);
  select * into v_streak from public.streaks where user_id = p_user and kind = 'training_week';
  select jsonb_build_object(
           'workouts', count(*) filter (where reason = 'workout'),
           'extras', count(*) filter (where reason = 'workout_extra'),
           'prs', count(*) filter (where reason = 'pr'),
           'target_hit', count(*) filter (where reason = 'week_target') > 0)
    into v_count
    from public.xp_ledger where user_id = p_user and week_start = v_week;
  return jsonb_build_object(
    'total_xp', v_total,
    'level', public.level_json(v_total),
    'pillars', (
      select coalesce(jsonb_object_agg(p.name, public.level_json(p.xp) || jsonb_build_object('xp', p.xp)), '{}'::jsonb)
        from (select e::text as name,
                     coalesce((select sum(amount) from public.xp_ledger where user_id = p_user and pillar = e), 0)::bigint as xp
                from unnest(enum_range(null::public.pillar)) e) p
       where p.name = 'strength' or p.xp > 0),
    'week', jsonb_build_object('start', v_week, 'xp', public.week_xp(p_user, v_week), 'max', 960, 'target', v_target) || v_count,
    'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                 'shields', coalesce(v_streak.shields, 0)),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at) order by unlocked_at, code)
        from public.user_achievements where user_id = p_user), '[]'::jsonb)
  );
end $$;

create or replace function public.get_my_progress() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_today date;
  v_card  jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xp:' || v_uid::text, 0));
  v_today := public.local_today(v_uid);
  perform public.week_target_for(v_uid, public.week_start_of(v_today), 'strength');
  perform public.week_target_for(v_uid, public.week_start_of(v_today), 'nutrition');
  perform public.close_weeks(v_uid);
  perform public.evaluate_achievements(v_uid);
  v_card := public.progress_card(v_uid);
  return v_card || jsonb_build_object(
    'today', v_today,
    'stats', public.achievement_stats(v_uid) || jsonb_build_object('level', (v_card -> 'level' ->> 'level')::int),
    'week', (v_card -> 'week') || jsonb_build_object('weighed_today', exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = v_uid and l.reason = 'weight' and e.occurred_on = v_today)));
end $$;

-- Daily safety net (0003 schedules it): freezes the new week's target, closes weeks and hands out
-- streak badges for people who did not open the app.
create or replace function public.close_all_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.profiles loop
    perform public.week_target_for(r.id, public.local_week_start(r.id), 'strength');
    perform public.week_target_for(r.id, public.local_week_start(r.id), 'nutrition');
    perform public.close_weeks(r.id);
    perform public.evaluate_achievements(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
