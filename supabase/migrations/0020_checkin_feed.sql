-- Phase 1c, the check-in feed and the training days challenge (spec 4.1, 4.5, 6.2), plus the fixes
-- from the review of Tasks 1 to 3. 0017 to 0020 ship together.
--
--   get_checkin_feed     friends' posts for friends and all of one's own, newest first, 20 a page;
--                        workouts from before the cutover stay as the old items. get_feed (0004)
--                        stays as it was for the client still in use while this deploys.
--   get_challenge_feed   the members' posts in the challenge period; a post the caller may not see
--                        is a bare "private check-in" (it still counts on the board).
--   checkin_days         new template: closed days with a check-in. workouts_count now counts the
--                        same days (legacy workout days included).
--   challenge_grace      2 for every template paid by closed training days, and close_challenge
--                        closes the members' pending training days first (review, Important 1).
--   award_xp             from the cutover pr and weight_logged pay no XP, so the Treino week stays
--                        at 960 (spec 5.1; review, Minor 1). The events and the badges stay.
--   achievement_stats    a legacy workout on a day its check-in paid is not counted again (Minor 2).
--   checkins_guard       refuses a closed day and locks per person and day (Minor 4 and 5).
--   notify_checkin_social  no new reaction notice while one from the same person is unread (Minor 6).
--
-- Every redefined body is its latest one (challenge_progress, award_xp, achievement_stats: 0019;
-- create_challenge, close_challenge: 0015; checkins_guard: 0017; notify_checkin_social: 0018) with
-- only the parts above changed. No signature changes.

-- Training days challenge ------------------------------------------------------------------------

alter table public.challenges drop constraint challenges_template_check;
alter table public.challenges add constraint challenges_template_check
  check (template in ('workouts_count', 'weeks_on_target', 'volume_total', 'nutrition_days_on_target',
                      'checkin_days'));

-- checkin_days and workouts_count: closed days with a check-in in the period (a legacy day, before
-- the cutover with a workout, is checked too). Several posts on a day are one day.

create or replace function public.challenge_progress(p_challenge uuid, p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges%rowtype;
  v numeric;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return null; end if;
  if c.template in ('workouts_count', 'checkin_days') then
    select count(*) into v from public.training_days
     where user_id = p_user and checked and day between c.starts_on and c.ends_on;
  elsif c.template = 'weeks_on_target' then
    select count(*) into v from public.xp_ledger
     where user_id = p_user and reason in ('week_target', 'training_week_target')
       and week_start between public.week_start_of(c.starts_on) and c.ends_on;
  elsif c.template = 'nutrition_days_on_target' then
    select count(*) into v from public.nutrition_days
     where user_id = p_user and on_target and not imported and day between c.starts_on and c.ends_on
       and public.nutrition_active_on(p_user, day);
  else
    select coalesce(sum(least(greatest((payload ->> 'vol')::numeric, 0), 100000)), 0) into v
      from public.activity_events
     where user_id = p_user and kind = 'workout_completed' and occurred_on between c.starts_on and c.ends_on
       and jsonb_typeof(payload -> 'vol') = 'number';
    v := round(v * (case when (select unit from public.profiles where id = p_user) = 'lb'
                         then 0.45359237 else 1 end) / 1000, 1);
  end if;
  return v;
end $$;

revoke all on function public.challenge_progress(uuid, uuid) from public, anon, authenticated;

-- checkin_days takes the rules of workouts_count: team or solo, 1 to 500 days
-- (supabase/tests/challenge-rules-parity.test.ts holds it to the client's workouts_count rules).
-- workouts_count is still accepted for clients that offer it.

create or replace function public.create_challenge(
  p_template text, p_title text, p_mode text, p_target numeric, p_starts_on date, p_ends_on date,
  p_invitees uuid[], p_share_volume boolean default false, p_share_nutrition boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_title  text := btrim(coalesce(p_title, ''));
  v_today  date;
  v_people uuid[];
  v_id     uuid;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  v_today := public.local_today(v_me);
  select coalesce(array_agg(distinct u), '{}') into v_people
    from unnest(coalesce(p_invitees, '{}'::uuid[])) u where u is not null and u <> v_me;

  -- Same rules as checkChallenge in src/features/social/templates.ts.
  if p_template is null
     or p_template not in ('workouts_count', 'weeks_on_target', 'volume_total', 'nutrition_days_on_target',
                           'checkin_days')
     or p_mode is null or p_mode not in ('team', 'solo')
     or (p_template = 'weeks_on_target' and p_mode <> 'solo')
     or char_length(v_title) not between 1 and 60
     or p_starts_on is null or p_ends_on is null
     or p_ends_on - p_starts_on not between 6 and 91
     or p_starts_on < v_today or p_starts_on > v_today + 30
     or p_target is null or p_target <> trunc(p_target) or p_target < 1
     or (p_template in ('workouts_count', 'checkin_days') and p_target > 500)
     or (p_template = 'volume_total' and p_target > 5000)
     or (p_template = 'weeks_on_target'
         and p_target > (public.week_start_of(p_ends_on) - public.week_start_of(p_starts_on)) / 7 + 1)
     or (p_template = 'nutrition_days_on_target'
         and p_target > (p_ends_on - p_starts_on + 1)
                        * (case when p_mode = 'team' then 1 + cardinality(v_people) else 1 end))
     or cardinality(v_people) not between 1 and 19 then
    raise exception 'invalid_challenge' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_people) u where not public.are_friends(v_me, u)) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;
  if p_template = 'volume_total' and not coalesce(p_share_volume, false) then
    raise exception 'volume_opt_in_required' using errcode = 'P0001';
  end if;
  if p_template = 'nutrition_days_on_target' then
    if not (select nutrition_enabled from public.profiles where id = v_me) then
      raise exception 'nutrition_off' using errcode = 'P0001';
    end if;
    if not coalesce(p_share_nutrition, false) then
      raise exception 'nutrition_opt_in_required' using errcode = 'P0001';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('challenge-create:' || v_me::text, 0));
  if (select count(*) from public.challenges where created_by = v_me and status = 'active') >= 10 then
    raise exception 'challenge_limit' using errcode = 'P0001';
  end if;

  insert into public.challenges (template, title, mode, target, starts_on, ends_on, created_by)
  values (p_template, v_title, p_mode, p_target, p_starts_on, p_ends_on, v_me)
  returning id into v_id;
  insert into public.challenge_members (challenge_id, user_id, invited_by, joined_at, share_volume, share_nutrition)
  values (v_id, v_me, null, public.app_now(), p_template = 'volume_total', p_template = 'nutrition_days_on_target');
  insert into public.challenge_members (challenge_id, user_id, invited_by)
  select v_id, u, v_me from unnest(v_people) u;
  return jsonb_build_object('id', v_id);
end $$;

revoke all on function
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean)
  from public, anon;
grant execute on function
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean)
  to authenticated;

-- A training day closes at the start of D+2, like a nutrition day, so every template it pays
-- waits two days past ends_on.

create or replace function public.challenge_grace(p_template text) returns integer
language sql immutable security definer set search_path = public as $$
  select case when p_template in ('nutrition_days_on_target', 'weeks_on_target', 'workouts_count', 'checkin_days')
              then 2 else 0 end
$$;
revoke all on function public.challenge_grace(text) from public, anon, authenticated;

-- As 0015, and for the training templates every participant's pending training days are closed
-- after the XP locks are taken (close_training_days takes the same lock again) and before final.

create or replace function public.close_challenge(p_challenge uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c         public.challenges%rowtype;
  v_members uuid[];
  v_won     boolean;
  v_user    uuid;
  r         record;
begin
  perform pg_advisory_xact_lock(hashtextextended('challenge-close', 0));
  select * into c from public.challenges where id = p_challenge for update;
  if not found or c.status <> 'active'
     or public.challenge_today(c.created_by, c.timezone) <= c.ends_on + public.challenge_grace(c.template) then
    return false;
  end if;
  delete from public.challenge_members where challenge_id = p_challenge and joined_at is null;
  select coalesce(array_agg(user_id order by user_id), '{}') into v_members
    from public.challenge_members where challenge_id = p_challenge;
  if cardinality(v_members) < 2 then
    update public.challenges set status = 'cancelled', closed_at = public.app_now() where id = p_challenge;
    return true;
  end if;
  perform public.lock_users(v_members);
  if c.template = 'nutrition_days_on_target' then
    foreach v_user in array v_members loop
      perform public.close_nutrition_days(v_user);
    end loop;
  end if;
  if c.template in ('weeks_on_target', 'workouts_count', 'checkin_days') then
    foreach v_user in array v_members loop
      perform public.close_training_days(v_user);
    end loop;
  end if;
  update public.challenge_members
     set final = coalesce(public.challenge_progress(p_challenge, user_id), 0)
   where challenge_id = p_challenge;
  if c.mode = 'team' then
    select sum(final) >= c.target into v_won from public.challenge_members where challenge_id = p_challenge;
    update public.challenge_members set won = v_won where challenge_id = p_challenge;
  else
    update public.challenge_members set won = (final >= c.target) where challenge_id = p_challenge;
    select bool_or(won) into v_won from public.challenge_members where challenge_id = p_challenge;
  end if;
  update public.challenges
     set status = case when v_won then 'won' else 'lost' end, closed_at = public.app_now()
   where id = p_challenge;
  for r in select user_id from public.challenge_members
            where challenge_id = p_challenge and won order by user_id loop
    perform public.award_bonus_xp(r.user_id, 300, 'challenge:' || p_challenge::text);
    perform public.evaluate_achievements(r.user_id);
  end loop;
  return true;
end $$;

revoke all on function public.close_challenge(uuid) from public, anon, authenticated;

-- XP per event -------------------------------------------------------------------------------------
-- 0019's, with pr and weight_logged paying only before the cutover. From it on the events are
-- still kept (PR badges, the weigh-in run) and the week of the pillar is the 960 of spec 5.1:
-- 600 days + 150 target + 50 extras + 90 detail + 70 photo days.

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

-- Achievement metrics -------------------------------------------------------------------------------
-- 0019's, with a workout from before the cutover counted only on a day its check-in did not pay.

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
      ) lengths), 0)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;

-- Check-in guard -------------------------------------------------------------------------------------
-- 0017's, refusing a day that already has its training_days row, and holding a lock per person and
-- day while counting the ten of the day.

create or replace function public.checkins_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_today date;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
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

-- Reaction notices -------------------------------------------------------------------------------------
-- 0018's, with one unread reaction notice per person and post at most. Comments notify every time.

create or replace function public.notify_checkin_social() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.checkins where id = new.checkin_id;
  if v_owner is not null and v_owner <> new.user_id then
    -- Reacting again (another emoji, or off and on) while the last notice is unread adds nothing.
    if tg_table_name = 'checkin_reactions' and exists (
      select 1 from public.social_notices
       where user_id = v_owner and actor_id = new.user_id and kind = 'reaction'
         and checkin_id = new.checkin_id and read_at is null) then
      return null;
    end if;
    insert into public.social_notices (user_id, actor_id, kind, checkin_id)
    values (v_owner, new.user_id,
            case when tg_table_name = 'checkin_reactions' then 'reaction' else 'comment' end,
            new.checkin_id);
  end if;
  return null;
end $$;

revoke all on function public.notify_checkin_social() from public, anon, authenticated;

-- Feed items -----------------------------------------------------------------------------------------
-- Built only for posts the caller may see. Never note, detail, routine or anything of the workout
-- beyond what is listed here.
--   key       'checkin:<id>' or 'workout:<id>'; with the time it orders the feed (byte order)
--   context   week_count: which training day of its week the post's day is (days with a check-in,
--             or a workout before the cutover, from Monday up to that day); streak: the owner's
--             current training_week streak

create function public.checkin_feed_item(p_id uuid, p_me uuid) returns jsonb
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

-- A workout from before the cutover, as get_feed shows it: the set count and the PR exercise ids.
create function public.workout_feed_item(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'type', 'workout',
    'key', 'workout:' || e.id::text,
    'at', e.created_at,
    'day', e.occurred_on,
    'user', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
               from public.profiles p where p.id = e.user_id),
    'sets', case when jsonb_typeof(e.payload -> 'sets') = 'number'
                 then least(greatest((e.payload ->> 'sets')::numeric, 0), 999)::int end,
    'prs', coalesce((
      select jsonb_agg(left(pr.payload ->> 'ex', 40) order by pr.id)
        from public.activity_events pr
       where pr.user_id = e.user_id and pr.kind = 'pr'
         and jsonb_typeof(pr.payload -> 'ex') = 'string'
         and left(pr.source_ref, char_length(e.source_ref) + 1) = e.source_ref || ':'), '[]'::jsonb))
  from public.activity_events e
  where e.id = p_id
$$;

revoke all on function public.checkin_feed_item(uuid, uuid), public.workout_feed_item(bigint)
  from public, anon, authenticated;

-- The feed -------------------------------------------------------------------------------------------
-- Newest first by (at, key); a page ends at the 20th item and next carries its at and key, so a
-- post that arrives meanwhile never repeats or hides one. Without a key, p_before alone means
-- strictly earlier. Hidden posts are left out for whoever hid them. Opening the feed closes the
-- caller's pending training days (spec 5.2), as get_my_progress does.

create function public.get_checkin_feed(p_before timestamptz default null, p_before_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_cut   date;
  v_items jsonb;
  v_n     integer;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  perform public.close_training_days(v_me);
  v_cut := public.training_checkin_since();

  with page as (
    select * from (
      (select ('checkin:' || c.id::text) collate "C" as key, c.created_at as at, c.id as checkin_id,
              null::bigint as event_id
         from public.checkins c
        where (c.user_id = v_me
               or (c.visibility = 'friends' and c.user_id in (select public.friend_ids(v_me))))
          and not exists (select 1 from public.hidden_checkins h where h.user_id = v_me and h.checkin_id = c.id)
          and (p_before is null or c.created_at < p_before
               or (c.created_at = p_before
                   and ('checkin:' || c.id::text) collate "C" < coalesce(p_before_key, '') collate "C"))
        order by c.created_at desc, ('checkin:' || c.id::text) collate "C" desc
        limit 20)
      union all
      (select ('workout:' || e.id::text) collate "C", e.created_at, null::uuid, e.id
         from public.activity_events e
         join public.profiles p on p.id = e.user_id
        where e.kind = 'workout_completed'
          and e.occurred_on < v_cut
          and p.share_activity
          and e.user_id in (select public.friend_ids(v_me))
          and (p_before is null or e.created_at < p_before
               or (e.created_at = p_before
                   and ('workout:' || e.id::text) collate "C" < coalesce(p_before_key, '') collate "C"))
        order by e.created_at desc, ('workout:' || e.id::text) collate "C" desc
        limit 20)
    ) u
    order by u.at desc, u.key collate "C" desc
    limit 20
  )
  select coalesce(jsonb_agg(case when checkin_id is not null then public.checkin_feed_item(checkin_id, v_me)
                                 else public.workout_feed_item(event_id) end
                            order by at desc, key collate "C" desc), '[]'::jsonb),
         count(*)
    into v_items, v_n
    from page;

  return jsonb_build_object(
    'items', v_items,
    'next', case when v_n = 20 then
      jsonb_build_object('before', v_items -> 19 -> 'at', 'before_key', v_items -> 19 ->> 'key') end);
end $$;

-- A challenge's feed: posts of the people who joined, on the days of the period, newest first,
-- paged like the feed. One the caller may see (their own, or a friend's for friends) comes whole
-- with private: false; any other one only as { type, key, at, day, user, private: true }: no photo,
-- title, caption or activity. Members only (invited ones included); anyone else gets
-- challenge_not_found.

create function public.get_challenge_feed(p_id uuid, p_before timestamptz default null,
                                          p_before_key text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_c     public.challenges%rowtype;
  v_items jsonb;
  v_n     integer;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.challenge_members where challenge_id = p_id and user_id = v_me) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  select * into v_c from public.challenges where id = p_id;

  with page as (
    select c.id, c.user_id, c.day, c.created_at as at, ('checkin:' || c.id::text) collate "C" as key
      from public.checkins c
      join public.challenge_members m
        on m.challenge_id = p_id and m.user_id = c.user_id and m.joined_at is not null
     where c.day between v_c.starts_on and v_c.ends_on
       and not exists (select 1 from public.hidden_checkins h where h.user_id = v_me and h.checkin_id = c.id)
       and (p_before is null or c.created_at < p_before
            or (c.created_at = p_before
                and ('checkin:' || c.id::text) collate "C" < coalesce(p_before_key, '') collate "C"))
     order by c.created_at desc, ('checkin:' || c.id::text) collate "C" desc
     limit 20
  )
  select coalesce(jsonb_agg(
           case when public.can_see_checkin(id)
                then public.checkin_feed_item(id, v_me) || jsonb_build_object('private', false)
                else jsonb_build_object(
                       'type', 'checkin', 'key', key, 'at', at, 'day', day, 'private', true,
                       'user', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
                                  from public.profiles p where p.id = page.user_id)) end
           order by at desc, key collate "C" desc), '[]'::jsonb),
         count(*)
    into v_items, v_n
    from page;

  return jsonb_build_object(
    'items', v_items,
    'next', case when v_n = 20 then
      jsonb_build_object('before', v_items -> 19 -> 'at', 'before_key', v_items -> 19 ->> 'key') end);
end $$;

revoke all on function public.get_checkin_feed(timestamptz, text),
  public.get_challenge_feed(uuid, timestamptz, text) from public, anon;
grant execute on function public.get_checkin_feed(timestamptz, text),
  public.get_challenge_feed(uuid, timestamptz, text) to authenticated;
