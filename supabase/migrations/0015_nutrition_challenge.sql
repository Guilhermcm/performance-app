-- Phase 2b, nutrition challenge: nutrition_days_on_target counts the closed days each participant
-- spent on target in the period (spec 5 and 6.2). Team adds them up, solo needs each person to
-- reach the goal. Creating or joining asks for the pillar on and for the opt-in that shows the
-- other participants that count (and nothing else). A day closes at the start of D+2, so these
-- challenges close when the challenge's own today is past ends_on + 2, after the participants'
-- pending days are closed.
--
-- The functions below are the latest bodies (0004, 0006) with only the nutrition parts added.
-- create_challenge and join_challenge gain p_share_nutrition (last, default false): the old
-- signatures are dropped and the grants made again.

-- Tables -------------------------------------------------------------------------------------------

alter table public.challenges drop constraint challenges_template_check;
alter table public.challenges add constraint challenges_template_check
  check (template in ('workouts_count', 'weeks_on_target', 'volume_total', 'nutrition_days_on_target'));

alter table public.challenge_members add column share_nutrition boolean not null default false;

-- Progress -----------------------------------------------------------------------------------------
-- nutrition_days_on_target: closed days on target, not imported, inside the period and inside one
-- of the person's pillar periods.

create or replace function public.challenge_progress(p_challenge uuid, p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges%rowtype;
  v numeric;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return null; end if;
  if c.template = 'workouts_count' then
    select count(*) into v from public.activity_events
     where user_id = p_user and kind = 'workout_completed' and occurred_on between c.starts_on and c.ends_on;
  elsif c.template = 'weeks_on_target' then
    select count(*) into v from public.xp_ledger
     where user_id = p_user and reason = 'week_target'
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

-- Creating and joining -----------------------------------------------------------------------------

drop function public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean);

create function public.create_challenge(
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
     or p_template not in ('workouts_count', 'weeks_on_target', 'volume_total', 'nutrition_days_on_target')
     or p_mode is null or p_mode not in ('team', 'solo')
     or (p_template = 'weeks_on_target' and p_mode <> 'solo')
     or char_length(v_title) not between 1 and 60
     or p_starts_on is null or p_ends_on is null
     or p_ends_on - p_starts_on not between 6 and 91
     or p_starts_on < v_today or p_starts_on > v_today + 30
     or p_target is null or p_target <> trunc(p_target) or p_target < 1
     or (p_template = 'workouts_count' and p_target > 500)
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

drop function public.join_challenge(uuid, boolean);

create function public.join_challenge(
  p_id uuid, p_share_volume boolean default false, p_share_nutrition boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c  public.challenges%rowtype;
  v_m  public.challenge_members%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into v_m from public.challenge_members where challenge_id = p_id and user_id = v_me for update;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  select * into v_c from public.challenges where id = p_id;
  if v_c.status <> 'active' or public.challenge_today(v_c.created_by, v_c.timezone) > v_c.ends_on then
    raise exception 'challenge_closed' using errcode = 'P0001';
  end if;
  if v_m.joined_at is not null then return; end if;
  if v_c.template = 'volume_total' and not coalesce(p_share_volume, false) then
    raise exception 'volume_opt_in_required' using errcode = 'P0001';
  end if;
  if v_c.template = 'nutrition_days_on_target' then
    if not coalesce((select nutrition_enabled from public.profiles where id = v_me), false) then
      raise exception 'nutrition_off' using errcode = 'P0001';
    end if;
    if not coalesce(p_share_nutrition, false) then
      raise exception 'nutrition_opt_in_required' using errcode = 'P0001';
    end if;
  end if;
  update public.challenge_members
     set joined_at = public.app_now(), share_volume = (v_c.template = 'volume_total'),
         share_nutrition = (v_c.template = 'nutrition_days_on_target')
   where challenge_id = p_id and user_id = v_me;
end $$;

revoke all on function
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean),
  public.join_challenge(uuid, boolean, boolean)
  from public, anon;
grant execute on function
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean, boolean),
  public.join_challenge(uuid, boolean, boolean)
  to authenticated;

-- Closing ------------------------------------------------------------------------------------------
-- How many days past ends_on a challenge waits before it closes: the last two days of a nutrition
-- challenge are judged only at the start of D+2.

create or replace function public.challenge_grace(p_template text) returns integer
language sql immutable security definer set search_path = public as $$
  select case when p_template = 'nutrition_days_on_target' then 2 else 0 end
$$;
revoke all on function public.challenge_grace(text) from public, anon, authenticated;

-- As 0006, with the grace above and, for nutrition, every participant's pending days closed after
-- their XP locks are taken (close_nutrition_days takes the same lock again) and before final.
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

create or replace function public.close_due_challenges(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id from public.challenges c
      join public.challenge_members m on m.challenge_id = c.id and m.user_id = p_user
     where c.status = 'active'
       and c.ends_on + public.challenge_grace(c.template) < public.challenge_today(c.created_by, c.timezone)
     order by c.id
  loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function public.close_all_challenges() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.challenges
            where status = 'active'
              and ends_on + public.challenge_grace(template) < public.challenge_today(created_by, timezone)
            order by id loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;
