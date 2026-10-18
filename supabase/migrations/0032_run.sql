-- Phase 1e-b, running check-ins (spec 7.1 to 7.3; plan decisions 1, 2, 4 and 5). A run check-in
-- may carry detail.run: the planned workout it was linked to, the distance, the effort, the blocks
-- run and how it went against the plan.
--
--   valid_run_items      new: a workout's items in the plan's format (spec 5.2).
--   valid_run_detail     new: the rules of detail.run, on a run check-in only.
--   checkins_guard       refuses an invalid detail.run from a client, on insert and update.
--   close_training_days  a run with a distance or an effort makes the day detailed, like strength
--                        entries; award_xp does not change (30 a day, 3 a week, 960 a week).
--   checkin_feed_item    gains run_type and distance_km, null off a run. Never the effort, the
--                        blocks or the plan. Serves get_checkin_feed and get_challenge_feed.
--   get_checkin          gains the same two keys; the owner still gets the whole detail.
--
-- Every redefined body is its latest one (checkins_guard, checkin_feed_item: 0020;
-- close_training_days: 0019; get_checkin: 0018) with only the parts above changed. No signature
-- changes.

-- detail.run --------------------------------------------------------------------------------------
-- A workout is 1 to 12 items; an item is a block { zone, min } (min a whole 1 to 300) or a repeat
-- { repeat: 2..20, blocks } of 1 to 4 blocks. Unknown keys refuse. Each type is checked before its
-- value is cast, one statement at a time, so a string never reaches a numeric cast.

create function public.valid_run_items(p_items jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  v_item   jsonb;
  v_block  jsonb;
  v_blocks jsonb;
  v_n      numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_items) not between 1 and 12 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then return false; end if;
    if v_item ? 'repeat' then
      if (select array_agg(k order by k) from jsonb_object_keys(v_item) k) <> array['blocks', 'repeat'] then
        return false;
      end if;
      if jsonb_typeof(v_item -> 'repeat') <> 'number' then return false; end if;
      v_n := (v_item -> 'repeat')::numeric;
      if v_n <> trunc(v_n) or v_n not between 2 and 20 then return false; end if;
      if jsonb_typeof(v_item -> 'blocks') <> 'array' then return false; end if;
      if jsonb_array_length(v_item -> 'blocks') not between 1 and 4 then return false; end if;
      v_blocks := v_item -> 'blocks';
    else
      v_blocks := jsonb_build_array(v_item);
    end if;
    for v_block in select value from jsonb_array_elements(v_blocks) loop
      if jsonb_typeof(v_block) <> 'object' then return false; end if;
      if (select array_agg(k order by k) from jsonb_object_keys(v_block) k) <> array['min', 'zone'] then
        return false;
      end if;
      if jsonb_typeof(v_block -> 'zone') <> 'string' then return false; end if;
      if v_block ->> 'zone' not in ('easy', 'moderate', 'hard', 'walk') then return false; end if;
      if jsonb_typeof(v_block -> 'min') <> 'number' then return false; end if;
      v_n := (v_block -> 'min')::numeric;
      if v_n <> trunc(v_n) or v_n not between 1 and 300 then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

-- { planned?: { week, session, type, blocks }, distance_km?, rpe?, blocks?, status }, on a run only.
--   distance_km  0.1 to 100, two decimals at most
--   rpe          a whole 1 to 10
--   status       unplanned without planned; as_planned with planned and without blocks; adjusted
--                with planned and blocks
--   planned      week a whole 1 to 64, session w<n>-s<k> (16 characters at most), type one of the
--                plan's workout types, blocks the workout as planned
-- Always true or false, never null: the guard negates it.

create function public.valid_run_detail(p_run jsonb, p_activity text) returns boolean
language plpgsql immutable set search_path = public as $$
declare
  v_planned jsonb;
  v_status  text;
  v_n       numeric;
begin
  if p_activity is distinct from 'run' then return false; end if;
  if jsonb_typeof(p_run) is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p_run) k
              where k not in ('planned', 'distance_km', 'rpe', 'blocks', 'status')) then
    return false;
  end if;

  if jsonb_typeof(p_run -> 'status') is distinct from 'string' then return false; end if;
  v_status := p_run ->> 'status';
  if v_status not in ('as_planned', 'adjusted', 'unplanned') then return false; end if;
  if (v_status = 'unplanned') = (p_run ? 'planned') then return false; end if;
  if v_status = 'as_planned' and p_run ? 'blocks' then return false; end if;
  if v_status = 'adjusted' and not p_run ? 'blocks' then return false; end if;

  if p_run ? 'distance_km' then
    if jsonb_typeof(p_run -> 'distance_km') <> 'number' then return false; end if;
    v_n := (p_run -> 'distance_km')::numeric;
    if v_n <> round(v_n, 2) or v_n not between 0.1 and 100 then return false; end if;
  end if;

  if p_run ? 'rpe' then
    if jsonb_typeof(p_run -> 'rpe') <> 'number' then return false; end if;
    v_n := (p_run -> 'rpe')::numeric;
    if v_n <> trunc(v_n) or v_n not between 1 and 10 then return false; end if;
  end if;

  if p_run ? 'blocks' and not public.valid_run_items(p_run -> 'blocks') then return false; end if;

  if p_run ? 'planned' then
    v_planned := p_run -> 'planned';
    if jsonb_typeof(v_planned) <> 'object' then return false; end if;
    if (select array_agg(k order by k) from jsonb_object_keys(v_planned) k)
       <> array['blocks', 'session', 'type', 'week'] then
      return false;
    end if;
    if jsonb_typeof(v_planned -> 'week') <> 'number' then return false; end if;
    v_n := (v_planned -> 'week')::numeric;
    if v_n <> trunc(v_n) or v_n not between 1 and 64 then return false; end if;
    if jsonb_typeof(v_planned -> 'session') <> 'string' then return false; end if;
    if char_length(v_planned ->> 'session') > 16
       or v_planned ->> 'session' !~ '^w[1-9][0-9]*-s[1-9][0-9]*$' then
      return false;
    end if;
    if jsonb_typeof(v_planned -> 'type') <> 'string' then return false; end if;
    if v_planned ->> 'type' not in ('runwalk', 'easy', 'long', 'tempo', 'intervals') then return false; end if;
    if not public.valid_run_items(v_planned -> 'blocks') then return false; end if;
  end if;

  return true;
end $$;

-- checkins_guard is security invoker and runs as the client, so authenticated keeps execute. Both
-- read only their arguments.
revoke all on function public.valid_run_items(jsonb), public.valid_run_detail(jsonb, text)
  from public, anon;
grant execute on function public.valid_run_items(jsonb), public.valid_run_detail(jsonb, text)
  to authenticated;

-- Check-in guard -------------------------------------------------------------------------------------
-- 0020's, refusing an invalid detail.run from a client on insert and update. The owner passes, as
-- with the other rules.

create or replace function public.checkins_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_today date;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- The run part of the detail, on a run check-in only (spec 7.2).
  if new.detail ? 'run' and not public.valid_run_detail(new.detail -> 'run', new.activity) then
    raise exception 'invalid_run_detail' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    v_today := public.my_local_today();
    if new.day not in (v_today - 1, v_today) then
      raise exception 'day_closed' using errcode = 'P0001';
    end if;
    -- A day already closed (yesterday after the time zone moved west, say) would never count it.
    if exists (select 1 from public.training_days where user_id = new.user_id and day = new.day) then
      raise exception 'day_closed' using errcode = 'P0001';
    end if;
    -- Two posts at once must not both pass the count.
    perform pg_advisory_xact_lock(
      hashtextextended('checkin-day:' || new.user_id::text || ':' || to_char(new.day, 'YYYY-MM-DD'), 0));
    if (select count(*) from public.checkins
         where user_id = new.user_id and day = new.day and id <> new.id) >= 10 then
      raise exception 'too_many_checkins' using errcode = 'P0001';
    end if;
    -- A post made offline keeps its earlier time; none is dated in the future to stay on top.
    new.created_at := least(coalesce(new.created_at, now()), now());
  else
    if new.id <> old.id or new.user_id <> old.user_id or new.day <> old.day
       or new.activity <> old.activity or new.photo_path <> old.photo_path then
      raise exception 'item_immutable' using errcode = 'P0001';
    end if;
    new.created_at := old.created_at;
  end if;

  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

revoke all on function public.checkins_guard() from public, anon, authenticated;

-- Closing days ---------------------------------------------------------------------------------------
-- 0019's, with a run that has a distance or an effort counting as a detailed day (spec 7.2).

create or replace function public.close_training_days(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cut      date;
  v_first    date;
  v_last     date;
  v_day      date;
  v_checked  boolean;
  v_detailed boolean;
  v_legacy   boolean;
  v_ref      text;
  n          integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  v_cut := public.training_checkin_since();
  v_last := public.local_today(p_user) - 2;
  select least(
    (select min(day) from public.checkins where user_id = p_user),
    (select min(occurred_on) from public.activity_events
      where user_id = p_user and kind = 'workout_completed' and occurred_on < v_cut)
  ) into v_first;
  if v_first is null or v_first > v_last then return 0; end if;

  for v_day in
    select d::date from generate_series(v_first, v_last, interval '1 day') d
     where not exists (select 1 from public.training_days x where x.user_id = p_user and x.day = d::date)
     order by 1
  loop
    select count(*) > 0,
           coalesce(bool_or((jsonb_typeof(detail -> 'entries') = 'array'
                             and jsonb_array_length(detail -> 'entries') > 0)
                            or jsonb_typeof(detail -> 'run' -> 'distance_km') = 'number'
                            or jsonb_typeof(detail -> 'run' -> 'rpe') = 'number'), false)
      into v_checked, v_detailed
      from public.checkins where user_id = p_user and day = v_day;
    v_legacy := v_day < v_cut and exists (
      select 1 from public.activity_events
       where user_id = p_user and kind = 'workout_completed' and occurred_on = v_day);

    insert into public.training_days (user_id, day, checked, detailed, legacy)
    values (p_user, v_day, v_checked or v_legacy, v_detailed, v_legacy);

    if v_checked and not v_legacy then
      v_ref := 'training:' || to_char(v_day, 'YYYY-MM-DD');
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'strength', 'training_day', v_day, v_ref) on conflict do nothing;
      if v_detailed then
        insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
        values (p_user, 'strength', 'training_detailed', v_day, v_ref) on conflict do nothing;
      end if;
    end if;
    n := n + 1;
  end loop;

  perform public.close_weeks(p_user);
  return n;
end $$;

revoke all on function public.close_training_days(uuid) from public, anon, authenticated;

-- Feed items -----------------------------------------------------------------------------------------
-- 0020's, plus run_type (the planned workout's type) and distance_km of a run check-in, null on any
-- other activity. Still never note, detail, routine, the effort, the blocks or the plan.

create or replace function public.checkin_feed_item(p_id uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'type', 'checkin',
    'key', 'checkin:' || c.id::text,
    'at', c.created_at,
    'day', c.day,
    'user', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
               from public.profiles p where p.id = c.user_id),
    'activity', c.activity,
    'title', c.title,
    'caption', c.caption,
    'duration_min', c.duration_min,
    'run_type', case when c.activity = 'run' then c.detail -> 'run' -> 'planned' ->> 'type' end,
    'distance_km', case when c.activity = 'run' then c.detail -> 'run' -> 'distance_km' end,
    'visibility', c.visibility,
    'photo_path', c.photo_path,
    'context', jsonb_build_object(
      'week_count', (
        select count(distinct d) from (
          select k.day as d from public.checkins k
           where k.user_id = c.user_id and k.day between public.week_start_of(c.day) and c.day
          union all
          select e.occurred_on from public.activity_events e
           where e.user_id = c.user_id and e.kind = 'workout_completed'
             and e.occurred_on < public.training_checkin_since()
             and e.occurred_on between public.week_start_of(c.day) and c.day) x),
      'streak', coalesce((select s.current from public.streaks s
                           where s.user_id = c.user_id and s.kind = 'training_week'), 0)),
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'mine', g.mine)
                       order by g.n desc, g.first_at, g.emoji)
        from (select r.emoji, count(*)::int as n, bool_or(r.user_id = p_me) as mine, min(r.created_at) as first_at
                from public.checkin_reactions r
               where r.checkin_id = c.id
               group by r.emoji) g), '[]'::jsonb),
    'comments_count', (select count(*)::int from public.checkin_comments m where m.checkin_id = c.id))
  from public.checkins c
  where c.id = p_id
$$;

revoke all on function public.checkin_feed_item(uuid, uuid) from public, anon, authenticated;

-- One post -------------------------------------------------------------------------------------------
-- 0018's, plus run_type and distance_km as in the feed item. note and detail are still added only
-- when the caller owns the post.

create or replace function public.get_checkin(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_c   public.checkins%rowtype;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not public.can_see_checkin(p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_c from public.checkins where id = p_id;

  v_out := jsonb_build_object(
    'id', v_c.id,
    'user', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
               from public.profiles p where p.id = v_c.user_id),
    'day', v_c.day,
    'activity', v_c.activity,
    'routine_name', v_c.routine_name,
    'title', v_c.title,
    'caption', v_c.caption,
    'duration_min', v_c.duration_min,
    'run_type', case when v_c.activity = 'run' then v_c.detail -> 'run' -> 'planned' ->> 'type' end,
    'distance_km', case when v_c.activity = 'run' then v_c.detail -> 'run' -> 'distance_km' end,
    'visibility', v_c.visibility,
    -- can_see_checkin passed, so the caller may see the photo.
    'photo_path', v_c.photo_path,
    'created_at', v_c.created_at,
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'mine', g.mine, 'users', g.users)
                       order by g.n desc, g.first_at, g.emoji)
        from (select r.emoji, count(*)::int as n, bool_or(r.user_id = v_me) as mine,
                     min(r.created_at) as first_at,
                     jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
                               order by r.created_at, r.user_id) as users
                from public.checkin_reactions r
                join public.profiles p on p.id = r.user_id
               where r.checkin_id = p_id
               group by r.emoji) g), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'user', jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url),
               'body', m.body,
               'created_at', m.created_at,
               'can_delete', m.user_id = v_me or v_c.user_id = v_me)
             order by m.id)
        from public.checkin_comments m
        join public.profiles p on p.id = m.user_id
       where m.checkin_id = p_id), '[]'::jsonb));

  if v_c.user_id = v_me then
    v_out := v_out || jsonb_build_object('note', v_c.note, 'detail', v_c.detail);
  end if;
  return v_out;
end $$;

revoke all on function public.get_checkin(uuid) from public, anon;
grant execute on function public.get_checkin(uuid) to authenticated;
