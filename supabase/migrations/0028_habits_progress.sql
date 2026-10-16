-- Phase 4a, progress: the public card, the owner's habits block, the radar's habits axis and the
-- habit history (spec 5.5, 5.6, 6.4, 11; plan decisions 12 and 15). Bodies copied from their latest
-- versions (0023); only the habits parts are new and no signature changes.

-- Whether a week touched a habits period. A period turned on and off the same day
-- (ended_on = started_on - 1) covers no day and touches nothing.
create function public.habits_week_active(p_user uuid, p_week date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.habit_periods
     where user_id = p_user and started_on <= p_week + 6
       and (ended_on is null or (ended_on >= p_week and ended_on >= started_on)))
$$;

revoke all on function public.habits_week_active(uuid, date) from public, anon, authenticated;

-- Pillar radar ----------------------------------------------------------------------------------
-- 0023's, with the habits branch: closed and active weeks exactly like sleep's (a week is closed
-- once its Sunday closed at D+2, week_start + 6 <= local_today - 2).

create or replace function public.pillar_consistency(p_user uuid, p_pillar public.pillar, p_offset int) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_last  date;
  v_first date;
  v_weeks date[];
  v_xp    bigint;
begin
  if p_pillar = 'strength' then
    v_last := public.week_start_of(public.local_today(p_user) - 8);
    select least(
      (select public.week_start_of(min(occurred_on)) from public.activity_events where user_id = p_user),
      (select public.week_start_of((created_at at time zone coalesce(timezone, 'America/Sao_Paulo'))::date)
         from public.profiles where id = p_user)
    ) into v_first;
  elsif p_pillar = 'nutrition' then
    v_last := public.week_start_of(public.local_today(p_user) - 8);
  elsif p_pillar = 'sleep' then
    v_last := public.week_start_of(public.local_today(p_user) - 8);
  elsif p_pillar = 'habits' then
    v_last := public.week_start_of(public.local_today(p_user) - 8);
  else
    return null;
  end if;
  v_last := v_last - 28 * p_offset;

  select array_agg(w::date) into v_weeks
    from generate_series(v_last - 21, v_last, interval '7 days') w
   where case when p_pillar = 'strength' then w::date >= v_first
              when p_pillar = 'nutrition' then public.nutrition_week_active(p_user, w::date)
              when p_pillar = 'sleep' then public.sleep_week_active(p_user, w::date)
              else public.habits_week_active(p_user, w::date) end;
  if v_weeks is null then return null; end if;

  select coalesce(sum(amount), 0) into v_xp from public.xp_ledger
   where user_id = p_user and pillar = p_pillar and week_start = any(v_weeks);
  return least(1, round(v_xp::numeric / (960 * cardinality(v_weeks)), 4));
end $$;

revoke all on function public.pillar_consistency(uuid, public.pillar, int) from public, anon, authenticated;

-- Public card -----------------------------------------------------------------------------------
-- 0023's, with habits: week.pillars.habits and 960 more in week.max when the week touched a habits
-- period. The pillar's level and XP come with the others; no habit, icon, check or target.

create or replace function public.progress_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_week   date := public.local_week_start(p_user);
  v_total  bigint := public.total_xp(p_user);
  v_target smallint;
  v_streak public.streaks%rowtype;
  v_count  jsonb;
  v_split  jsonb;
begin
  v_target := coalesce(
    (select target from public.weekly_targets where user_id = p_user and pillar = 'strength' and week_start = v_week),
    (select days_per_week from public.profiles where id = p_user), 3);
  select * into v_streak from public.streaks where user_id = p_user and kind = 'training_week';
  select jsonb_build_object(
           'workouts', count(*) filter (where reason in ('workout', 'training_day')),
           'extras', count(*) filter (where reason in ('workout_extra', 'training_day_extra')),
           'prs', count(*) filter (where reason = 'pr'),
           'target_hit', count(*) filter (where reason in ('week_target', 'training_week_target')) > 0),
         jsonb_build_object(
           'strength', coalesce(sum(amount) filter (where pillar = 'strength'), 0),
           'nutrition', coalesce(sum(amount) filter (where pillar = 'nutrition'), 0),
           'sleep', coalesce(sum(amount) filter (where pillar = 'sleep'), 0),
           'habits', coalesce(sum(amount) filter (where pillar = 'habits'), 0),
           'bonus', coalesce(sum(amount) filter (where pillar is null), 0))
    into v_count, v_split
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
    'week', jsonb_build_object(
              'start', v_week, 'xp', public.week_xp(p_user, v_week),
              'max', 960 * (1 + public.nutrition_week_active(p_user, v_week)::int
                                + public.sleep_week_active(p_user, v_week)::int
                                + public.habits_week_active(p_user, v_week)::int),
              'target', v_target, 'pillars', v_split) || v_count,
    'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                 'shields', coalesce(v_streak.shields, 0)),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', u.code, 'unlocked_at', u.unlocked_at) order by u.unlocked_at, u.code)
        from public.user_achievements u join public.achievement_catalog c on c.code = u.code
       where u.user_id = p_user and not c.private), '[]'::jsonb)
  );
end $$;

revoke all on function public.progress_card(uuid) from public, anon, authenticated;

-- The owner's extras ----------------------------------------------------------------------------
-- 0023's, plus the radar's habits axis and the habits block once the pillar was ever turned on:
--   habits.week       q: Q of the running week (its frozen targets); c: its valid checks on closed
--                     days (plan decision 12: the client shows C over every check of the week);
--                     xp: the habits XP the week paid so far
--   habits.streak     the habits_week streak
--   habits.last_week  the last week whose seven days closed, whether its goal was met and the XP its
--                     habit_week_target paid (0 without it, plan decision 15); null before the first
--                     period

create or replace function public.my_progress_extras(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today  date := public.local_today(p_user);
  v_week   date := public.week_start_of(v_today);
  v_lw     date := public.week_start_of(v_today - 8);
  v_first  date;
  v_streak public.streaks%rowtype;
  v_day    public.nutrition_days%rowtype;
  v_tday   public.training_days%rowtype;
  v_nut    jsonb;
  v_train  jsonb;
  v_sfirst date;
  v_sstrk  public.streaks%rowtype;
  v_night  public.sleep_nights%rowtype;
  v_sleep  jsonb;
  v_hfirst date;
  v_hstrk  public.streaks%rowtype;
  v_habits jsonb;
begin
  select public.week_start_of(min(started_on)) into v_first
    from public.nutrition_periods where user_id = p_user;
  if v_first is not null then
    select * into v_streak from public.streaks where user_id = p_user and kind = 'nutrition_week';
    select * into v_day from public.nutrition_days
     where user_id = p_user and not imported order by day desc limit 1;
    v_nut := jsonb_build_object(
      'target', coalesce(
        (select target from public.weekly_targets where user_id = p_user and pillar = 'nutrition' and week_start = v_week),
        (select nutrition_days_per_week from public.profiles where id = p_user), 5),
      'on_target', (select count(*) from public.nutrition_days
                     where user_id = p_user and not imported and on_target and day between v_week and v_week + 6),
      'logged', (select count(*) from public.nutrition_days
                  where user_id = p_user and not imported and logged and day between v_week and v_week + 6),
      'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                   'shields', coalesce(v_streak.shields, 0)),
      'confirms_on', v_today + 2,
      'last_closed', case when v_day.day is null then null else jsonb_build_object(
        'day', v_day.day, 'logged', v_day.logged, 'on_target', v_day.on_target, 'balanced', v_day.balanced,
        'xp', coalesce((
          select sum(l.amount) from public.xp_ledger l join public.activity_events e on e.id = l.event_id
           where l.user_id = p_user and e.user_id = p_user and e.pillar = 'nutrition'
             and e.occurred_on = v_day.day), 0)) end,
      'last_week', case when v_lw < v_first then null else jsonb_build_object(
        'start', v_lw,
        'target_hit', exists (select 1 from public.xp_ledger
                               where user_id = p_user and reason = 'nutrition_week_target' and week_start = v_lw)) end);
  end if;

  if exists (select 1 from public.checkins where user_id = p_user) then
    select * into v_tday from public.training_days
     where user_id = p_user and checked and not legacy order by day desc limit 1;
    v_train := jsonb_build_object(
      'confirms_on', v_today + 2,
      'last_closed', case when v_tday.day is null then null else jsonb_build_object(
        'day', v_tday.day, 'detailed', v_tday.detailed,
        'xp', coalesce((
          select sum(l.amount) from public.xp_ledger l join public.activity_events e on e.id = l.event_id
           where l.user_id = p_user and e.user_id = p_user
             and e.kind in ('training_day', 'training_detailed') and e.occurred_on = v_tday.day), 0)) end);
  end if;

  select public.week_start_of(min(started_on)) into v_sfirst
    from public.sleep_periods where user_id = p_user;
  if v_sfirst is not null then
    select * into v_sstrk from public.streaks where user_id = p_user and kind = 'sleep_week';
    select * into v_night from public.sleep_nights where user_id = p_user order by night desc limit 1;
    v_sleep := jsonb_build_object(
      'target', coalesce(
        (select target from public.weekly_targets where user_id = p_user and pillar = 'sleep' and week_start = v_week),
        (select sleep_nights_per_week from public.profiles where id = p_user), 5),
      'on_target', (select count(*) from public.sleep_nights
                     where user_id = p_user and on_target and night between v_week and v_week + 6),
      'logged', (select count(*) from public.sleep_nights
                  where user_id = p_user and logged and night between v_week and v_week + 6),
      'streak', jsonb_build_object('current', coalesce(v_sstrk.current, 0), 'best', coalesce(v_sstrk.best, 0),
                                   'shields', coalesce(v_sstrk.shields, 0)),
      'confirms_on', v_today + 2,
      'last_closed', case when v_night.night is null then null else jsonb_build_object(
        'night', v_night.night, 'logged', v_night.logged, 'on_target', v_night.on_target,
        'rested', v_night.rested,
        'xp', coalesce((
          select sum(l.amount)::int from public.xp_ledger l join public.activity_events e on e.id = l.event_id
           where l.user_id = p_user and e.user_id = p_user and e.pillar = 'sleep'
             and e.source_ref = 'sleep:' || to_char(v_night.night, 'YYYY-MM-DD')
             and l.pillar = 'sleep'), 0)) end,
      'last_week', case when v_lw < v_sfirst then null else jsonb_build_object(
        'start', v_lw,
        'target_hit', exists (select 1 from public.xp_ledger
                               where user_id = p_user and reason = 'sleep_week_target' and week_start = v_lw)) end);
  end if;

  select public.week_start_of(min(started_on)) into v_hfirst
    from public.habit_periods where user_id = p_user;
  if v_hfirst is not null then
    select * into v_hstrk from public.streaks where user_id = p_user and kind = 'habits_week';
    v_habits := jsonb_build_object(
      'week', jsonb_build_object(
        'q', public.habit_week_q(p_user, v_week),
        'c', (select count(*) from public.habit_checks
               where user_id = p_user and counted and day between v_week and v_week + 6),
        'xp', (select coalesce(sum(amount), 0) from public.xp_ledger
                where user_id = p_user and pillar = 'habits' and week_start = v_week)),
      'streak', jsonb_build_object('current', coalesce(v_hstrk.current, 0), 'best', coalesce(v_hstrk.best, 0),
                                   'shields', coalesce(v_hstrk.shields, 0)),
      'last_week', case when v_lw < v_hfirst then null else jsonb_build_object(
        'start', v_lw,
        'target_hit', exists (select 1 from public.xp_ledger
                               where user_id = p_user and reason = 'habit_week_target' and week_start = v_lw),
        'bonus', (select coalesce(sum(amount), 0) from public.xp_ledger
                   where user_id = p_user and reason = 'habit_week_target' and week_start = v_lw)) end);
  end if;

  return jsonb_build_object(
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at) order by unlocked_at, code)
        from public.user_achievements where user_id = p_user), '[]'::jsonb),
    'radar', jsonb_build_object(
      'strength', jsonb_build_object('current', public.pillar_consistency(p_user, 'strength', 0),
                                     'previous', public.pillar_consistency(p_user, 'strength', 1)),
      'nutrition', jsonb_build_object('current', public.pillar_consistency(p_user, 'nutrition', 0),
                                      'previous', public.pillar_consistency(p_user, 'nutrition', 1)),
      'sleep', jsonb_build_object('current', public.pillar_consistency(p_user, 'sleep', 0),
                                  'previous', public.pillar_consistency(p_user, 'sleep', 1)),
      'habits', jsonb_build_object('current', public.pillar_consistency(p_user, 'habits', 0),
                                   'previous', public.pillar_consistency(p_user, 'habits', 1))))
    || case when v_nut is null then '{}'::jsonb else jsonb_build_object('nutrition', v_nut) end
    || case when v_sleep is null then '{}'::jsonb else jsonb_build_object('sleep', v_sleep) end
    || case when v_habits is null then '{}'::jsonb else jsonb_build_object('habits', v_habits) end
    || case when v_train is null then '{}'::jsonb else jsonb_build_object('training', v_train) end;
end $$;

revoke all on function public.my_progress_extras(uuid) from public, anon, authenticated;

-- The owner's answer ----------------------------------------------------------------------------
-- 0023's, freezing the week's habit targets and closing pending habit days (which judges the habits
-- weeks) too.

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
  perform public.week_target_for(v_uid, public.week_start_of(v_today), 'sleep');
  perform public.freeze_habit_targets(v_uid, public.week_start_of(v_today));
  perform public.close_training_days(v_uid);
  perform public.close_weeks(v_uid);
  perform public.close_nutrition_days(v_uid);
  perform public.close_sleep_nights(v_uid);
  perform public.close_habit_days(v_uid);
  perform public.evaluate_achievements(v_uid);
  v_card := public.progress_card(v_uid);
  return v_card || public.my_progress_extras(v_uid) || jsonb_build_object(
    'today', v_today,
    'stats', public.achievement_stats(v_uid) || jsonb_build_object('level', (v_card -> 'level' ->> 'level')::int),
    'week', (v_card -> 'week') || jsonb_build_object('weighed_today', exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = v_uid and l.reason = 'weight' and e.occurred_on = v_today)));
end $$;

revoke all on function public.get_my_progress() from public, anon;
grant execute on function public.get_my_progress() to authenticated;

-- Habit history (spec 6.4) ----------------------------------------------------------------------
-- The signed-in person's habit days in [p_from, p_to] (62 days at most), after closing the pending
-- ones. In the mould of get_sleep_nights (0023).
--   days     the snapshot of each closed day: checks made, valid ones and the XP the day paid (its
--            valid checks and the +30; the week bonus is the week's)
--   checks   every check in the range; counted is null on the days still open (today, yesterday)
--   targets  the frozen targets of the Monday-start weeks the range touches
--   periods  the habits periods touching the range, so the calendar can paint "outside a period";
--            one turned on and off the same day covers no day and is left out

create function public.get_habit_history(p_from date, p_to date) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 62 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  perform public.close_habit_days(v_uid);
  return jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'checks', d.checks, 'valid', d.valid, 'xp', d.xp)
                       order by d.day)
        from public.habit_days d
       where d.user_id = v_uid and d.day between p_from and p_to), '[]'::jsonb),
    'checks', coalesce((
      select jsonb_agg(jsonb_build_object('habit_id', c.habit_id, 'day', c.day, 'counted', c.counted)
                       order by c.day, c.habit_id)
        from public.habit_checks c
       where c.user_id = v_uid and c.day between p_from and p_to), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('habit_id', t.habit_id, 'week_start', t.week_start, 'target', t.target)
                       order by t.week_start, t.habit_id)
        from public.habit_targets t
       where t.user_id = v_uid
         and t.week_start between public.week_start_of(p_from) and public.week_start_of(p_to)), '[]'::jsonb),
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object('started_on', p.started_on, 'ended_on', p.ended_on)
                       order by p.started_on)
        from public.habit_periods p
       where p.user_id = v_uid and p.started_on <= p_to
         and (p.ended_on is null or (p.ended_on >= p_from and p.ended_on >= p.started_on))), '[]'::jsonb));
end $$;

revoke all on function public.get_habit_history(date, date) from public, anon;
grant execute on function public.get_habit_history(date, date) to authenticated;
