-- Phase 2a, progress: the public card learns about pillars (spec 6.5), the owner gets the
-- nutrition block, the pillar radar (spec 8.4) and the full badge list, and friends get none of
-- those. Bodies copied from 0008_weekly_targets_pillar.sql; signatures do not change.

-- Whether a week touched a nutrition period. A period turned on and off the same day
-- (ended_on = started_on - 1) covers no day and touches nothing.
create function public.nutrition_week_active(p_user uuid, p_week date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.nutrition_periods
     where user_id = p_user and started_on <= p_week + 6
       and (ended_on is null or (ended_on >= p_week and ended_on >= started_on)))
$$;

revoke all on function public.nutrition_week_active(uuid, date) from public, anon, authenticated;

-- Public card -----------------------------------------------------------------------------------
-- What friends see (get_friends) and the base of the owner's answer. Stable: it only reads, so the
-- strength target falls back to the profile when the week was not frozen yet.
--   week.max     960 per pillar active in the week (strength always, nutrition when a period
--                touched the week)
--   week.pillars the week's XP by pillar; bonus is the general XP (pillar null: badges, challenges)
--   achievements without the private ones

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
           'workouts', count(*) filter (where reason = 'workout'),
           'extras', count(*) filter (where reason = 'workout_extra'),
           'prs', count(*) filter (where reason = 'pr'),
           'target_hit', count(*) filter (where reason = 'week_target') > 0),
         jsonb_build_object(
           'strength', coalesce(sum(amount) filter (where pillar = 'strength'), 0),
           'nutrition', coalesce(sum(amount) filter (where pillar = 'nutrition'), 0),
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
              'max', 960 * (1 + public.nutrition_week_active(p_user, v_week)::int),
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

-- Pillar radar (spec 8.4) -----------------------------------------------------------------------
-- Consistency of a pillar over 4 closed weeks: its XP / (960 x active weeks), at most 1. p_offset
-- 0 is the last 4 closed weeks, 1 the 4 before them. Null without an active week in the window.
--   strength  closed: every week before the running one; active: from the first week close_weeks
--             judges (the creation week, or an earlier event's)
--   nutrition closed: week_start + 6 <= local_today - 2; active: the week touched a period,
--             counted whole
-- General bonuses (pillar null) never count.

create function public.pillar_consistency(p_user uuid, p_pillar public.pillar, p_offset int) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_last  date;
  v_first date;
  v_weeks date[];
  v_xp    bigint;
begin
  if p_pillar = 'strength' then
    v_last := public.local_week_start(p_user) - 7;
    select least(
      (select public.week_start_of(min(occurred_on)) from public.activity_events where user_id = p_user),
      (select public.week_start_of((created_at at time zone coalesce(timezone, 'America/Sao_Paulo'))::date)
         from public.profiles where id = p_user)
    ) into v_first;
  elsif p_pillar = 'nutrition' then
    v_last := public.week_start_of(public.local_today(p_user) - 8);
  else
    return null;
  end if;
  v_last := v_last - 28 * p_offset;

  select array_agg(w::date) into v_weeks
    from generate_series(v_last - 21, v_last, interval '7 days') w
   where case when p_pillar = 'strength' then w::date >= v_first
              else public.nutrition_week_active(p_user, w::date) end;
  if v_weeks is null then return null; end if;

  select coalesce(sum(amount), 0) into v_xp from public.xp_ledger
   where user_id = p_user and pillar = p_pillar and week_start = any(v_weeks);
  return least(1, round(v_xp::numeric / (960 * cardinality(v_weeks)), 4));
end $$;

revoke all on function public.pillar_consistency(uuid, public.pillar, int) from public, anon, authenticated;

-- The owner's extras ----------------------------------------------------------------------------
-- Joined by get_my_progress, never sent to friends: every badge (private included), the nutrition
-- block (only once the pillar was ever turned on) and the radar.
--   nutrition.target       T of the running week (frozen or, failing that, the profile's)
--   nutrition.on_target    closed days of the running week on target; logged likewise
--   nutrition.confirms_on  the day today closes (today + 2)
--   nutrition.last_closed  the last closed day and the XP its events paid
--   nutrition.last_week    the last week with its seven days closed, from the first period's week

create function public.my_progress_extras(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today  date := public.local_today(p_user);
  v_week   date := public.week_start_of(v_today);
  v_lw     date := public.week_start_of(v_today - 8);
  v_first  date;
  v_streak public.streaks%rowtype;
  v_day    public.nutrition_days%rowtype;
  v_nut    jsonb;
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

  return jsonb_build_object(
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at) order by unlocked_at, code)
        from public.user_achievements where user_id = p_user), '[]'::jsonb),
    'radar', jsonb_build_object(
      'strength', jsonb_build_object('current', public.pillar_consistency(p_user, 'strength', 0),
                                     'previous', public.pillar_consistency(p_user, 'strength', 1)),
      'nutrition', jsonb_build_object('current', public.pillar_consistency(p_user, 'nutrition', 0),
                                      'previous', public.pillar_consistency(p_user, 'nutrition', 1))))
    || case when v_nut is null then '{}'::jsonb else jsonb_build_object('nutrition', v_nut) end;
end $$;

revoke all on function public.my_progress_extras(uuid) from public, anon, authenticated;

-- The owner's answer ----------------------------------------------------------------------------
-- Freezes both pillars' targets, closes strength weeks and pending nutrition days (which judges
-- the nutrition weeks too), then joins the card and the extras; the extras' badge list replaces
-- the card's.

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
  perform public.close_nutrition_days(v_uid);
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
