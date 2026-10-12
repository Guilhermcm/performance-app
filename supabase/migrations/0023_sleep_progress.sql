-- Phase 3, progress: the public card, the owner's sleep block, the radar's sleep axis and the night
-- history (spec 5.5, 6.4, 6.5, 9). Bodies copied from their latest versions (0019, 0020); only the
-- sleep parts are new and no signature changes.

-- Whether a week touched a sleep period. A period turned on and off the same day
-- (ended_on = started_on - 1) covers no night and touches nothing.
create function public.sleep_week_active(p_user uuid, p_week date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sleep_periods
     where user_id = p_user and started_on <= p_week + 6
       and (ended_on is null or (ended_on >= p_week and ended_on >= started_on)))
$$;

revoke all on function public.sleep_week_active(uuid, date) from public, anon, authenticated;

-- Pillar radar ----------------------------------------------------------------------------------
-- 0020's, with the sleep branch: closed and active weeks exactly like nutrition's (a week is closed
-- once its Sunday night closed at D+2, week_start + 6 <= local_today - 2).

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
  else
    return null;
  end if;
  v_last := v_last - 28 * p_offset;

  select array_agg(w::date) into v_weeks
    from generate_series(v_last - 21, v_last, interval '7 days') w
   where case when p_pillar = 'strength' then w::date >= v_first
              when p_pillar = 'nutrition' then public.nutrition_week_active(p_user, w::date)
              else public.sleep_week_active(p_user, w::date) end;
  if v_weeks is null then return null; end if;

  select coalesce(sum(amount), 0) into v_xp from public.xp_ledger
   where user_id = p_user and pillar = p_pillar and week_start = any(v_weeks);
  return least(1, round(v_xp::numeric / (960 * cardinality(v_weeks)), 4));
end $$;

revoke all on function public.pillar_consistency(uuid, public.pillar, int) from public, anon, authenticated;

-- Public card -----------------------------------------------------------------------------------
-- 0019's, with sleep: week.pillars.sleep and 960 more in week.max when the week touched a sleep
-- period. The pillar's level and XP come with the others; no time, duration, quality or note.

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
                                + public.sleep_week_active(p_user, v_week)::int),
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
-- 0019's, plus the radar's sleep axis and the sleep block once the pillar was ever turned on:
--   sleep.target       T of the running week
--   sleep.on_target    closed nights of the running week on target, and logged
--   sleep.streak       the sleep_week streak
--   sleep.confirms_on  the day tonight closes (today + 2)
--   sleep.last_closed  the last closed night and the XP its events paid (the +150 of the night that
--                      met the weekly goal included)
--   sleep.last_week    the last week whose seven nights closed; null before the first period

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
          select sum(l.amount) from public.xp_ledger l join public.activity_events e on e.id = l.event_id
           where l.user_id = p_user and e.user_id = p_user and e.pillar = 'sleep'
             and e.occurred_on = v_night.night), 0)) end,
      'last_week', case when v_lw < v_sfirst then null else jsonb_build_object(
        'start', v_lw,
        'target_hit', exists (select 1 from public.xp_ledger
                               where user_id = p_user and reason = 'sleep_week_target' and week_start = v_lw)) end);
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
                                  'previous', public.pillar_consistency(p_user, 'sleep', 1))))
    || case when v_nut is null then '{}'::jsonb else jsonb_build_object('nutrition', v_nut) end
    || case when v_sleep is null then '{}'::jsonb else jsonb_build_object('sleep', v_sleep) end
    || case when v_train is null then '{}'::jsonb else jsonb_build_object('training', v_train) end;
end $$;

revoke all on function public.my_progress_extras(uuid) from public, anon, authenticated;

-- The owner's answer ----------------------------------------------------------------------------
-- 0019's, freezing the week's sleep T and closing pending nights (which judges the sleep weeks) too.

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
  perform public.close_training_days(v_uid);
  perform public.close_weeks(v_uid);
  perform public.close_nutrition_days(v_uid);
  perform public.close_sleep_nights(v_uid);
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

-- Night history (spec 6.5) ----------------------------------------------------------------------
-- The signed-in person's closed nights in [p_from, p_to] (62 days at most), after closing the
-- pending ones. Hours as 'HH:MM', like the targets.
--   nights   the snapshot of each closed night, the XP its events paid (source_ref
--            'sleep:<night>', the +150 of the night that met the weekly goal included; bonuses
--            without an event belong to no night) and, from sleep_logs, bed_time, wake_time and
--            note (null without a log)
--   weeks    per Monday-start week touched by the range, whole weeks: start and target_hit
--   periods  the sleep periods touching the range, so the calendar can paint "outside a period";
--            one turned on and off the same day covers no night and is left out
-- Today and yesterday are still open: the client reads them from sleep_logs.

create function public.get_sleep_nights(p_from date, p_to date) returns jsonb
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
  perform public.close_sleep_nights(v_uid);
  return jsonb_build_object(
    'nights', coalesce((
      select jsonb_agg(jsonb_build_object(
               'night', n.night, 'logged', n.logged, 'on_target', n.on_target, 'rested', n.rested,
               'duration_min', n.duration_min, 'bed_diff_min', n.bed_diff_min, 'quality', n.quality,
               'target', n.target,
               'xp', coalesce((
                 select sum(l.amount)::int
                   from public.activity_events e
                   join public.xp_ledger l on l.event_id = e.id
                  where e.user_id = v_uid and e.pillar = 'sleep'
                    and e.source_ref = 'sleep:' || to_char(n.night, 'YYYY-MM-DD')
                    and l.user_id = v_uid and l.pillar = 'sleep'), 0),
               'bed_time', to_char(g.bed_time, 'HH24:MI'), 'wake_time', to_char(g.wake_time, 'HH24:MI'),
               'note', g.note) order by n.night)
        from public.sleep_nights n
        left join public.sleep_logs g on g.user_id = n.user_id and g.night = n.night
       where n.user_id = v_uid and n.night between p_from and p_to), '[]'::jsonb),
    'weeks', (
      select jsonb_agg(jsonb_build_object(
               'start', w.start,
               'target_hit', exists (select 1 from public.xp_ledger l
                                      where l.user_id = v_uid and l.reason = 'sleep_week_target'
                                        and l.week_start = w.start)) order by w.start)
        from (select g::date as start
                from generate_series(public.week_start_of(p_from), public.week_start_of(p_to),
                                     interval '7 days') g) w),
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object('started_on', p.started_on, 'ended_on', p.ended_on)
                       order by p.started_on)
        from public.sleep_periods p
       where p.user_id = v_uid and p.started_on <= p_to
         and (p.ended_on is null or (p.ended_on >= p_from and p.ended_on >= p.started_on))), '[]'::jsonb));
end $$;

revoke all on function public.get_sleep_nights(date, date) from public, anon;
grant execute on function public.get_sleep_nights(date, date) to authenticated;
