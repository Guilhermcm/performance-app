-- Phase 1b: invites, friendships, leaderboards, challenges and the friends feed. Tables only let
-- people see (and delete) their own rows; everything friends may see goes through security definer
-- functions that check auth.uid() and the friendship first, and build the answer from the Phase 1a
-- public card (progress_card), never from profiles or app_state.

-- Invites and friendships -----------------------------------------------------------------------

create table public.friend_invites (
  code       text primary key check (code ~ '^[0-9A-Za-z]{10}$'),
  inviter_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid references auth.users on delete set null,
  used_at    timestamptz
);
create index friend_invites_inviter on public.friend_invites (inviter_id);

create table public.friendships (
  user_a     uuid not null references auth.users on delete cascade,
  user_b     uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b on public.friendships (user_b);

alter table public.friend_invites enable row level security;
alter table public.friendships enable row level security;
create policy friend_invites_select_own on public.friend_invites for select to authenticated
  using (inviter_id = auth.uid());
create policy friend_invites_delete_open on public.friend_invites for delete to authenticated
  using (inviter_id = auth.uid() and used_at is null);
create policy friendships_select_own on public.friendships for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy friendships_delete_own on public.friendships for delete to authenticated
  using (auth.uid() in (user_a, user_b));
revoke all on public.friend_invites, public.friendships from anon;
revoke insert, update, truncate on public.friend_invites, public.friendships from authenticated;
grant select, delete on public.friend_invites, public.friendships to authenticated;

-- Helpers ----------------------------------------------------------------------------------------

create or replace function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
                  where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b))
$$;

create or replace function public.friend_ids(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when user_a = p_user then user_b else user_a end
    from public.friendships where p_user in (user_a, user_b)
$$;

-- The Phase 1a XP lock of several people, always taken in uuid order, so two transactions that
-- need the same people never wait on each other in a circle.
create or replace function public.lock_users(p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
begin
  for v in select distinct u from unnest(p_users) u where u is not null order by u loop
    perform pg_advisory_xact_lock(hashtextextended('xp:' || v::text, 0));
  end loop;
end $$;

-- 10 base62 characters from the server's strong random source (gen_random_uuid), ~59.5 bits.
-- Bytes 6 and 8 carry the uuid version and variant bits and are skipped; bytes from 248 up are
-- dropped so every character is equally likely.
create or replace function public.new_invite_code() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_alpha constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_out   text := '';
  v_bytes bytea;
  v_byte  integer;
begin
  while char_length(v_out) < 10 loop
    v_bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      v_byte := get_byte(v_bytes, i);
      if v_byte < 248 and char_length(v_out) < 10 then
        v_out := v_out || substr(v_alpha, v_byte % 62 + 1, 1);
      end if;
    end loop;
  end loop;
  return v_out;
end $$;

-- Invites ------------------------------------------------------------------------------------------

create or replace function public.create_invite() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := public.app_now();
  v_code text;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  -- One at a time per person, so two quick taps cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('invite:' || v_uid::text, 0));
  if (select count(*) from public.friend_invites
       where inviter_id = v_uid and used_at is null and expires_at > v_now) >= 5 then
    raise exception 'invite_limit' using errcode = 'P0001';
  end if;
  loop
    v_code := public.new_invite_code();
    begin
      insert into public.friend_invites (code, inviter_id, created_at, expires_at)
      values (v_code, v_uid, v_now, v_now + interval '7 days');
      exit;
    exception when unique_violation then
      -- A clash among 62^10 codes is astronomically rare; draw again rather than fail.
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'expires_at', v_now + interval '7 days');
end $$;

-- Public: the invite page calls it before anyone signs in. It tells who invited and in what state
-- the invite is, nothing else. A malformed and an unknown code get the same answer.
create or replace function public.get_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_inv public.friend_invites%rowtype;
begin
  if p_code is null or p_code !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  select * into v_inv from public.friend_invites where code = p_code;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'status', case
      when v_me = v_inv.inviter_id then 'self'
      when v_me is not null and public.are_friends(v_me, v_inv.inviter_id) then 'already_friends'
      when v_inv.used_at is not null then 'used'
      when v_inv.expires_at <= public.app_now() then 'expired'
      else 'open' end,
    'expires_at', v_inv.expires_at,
    'inviter', (select jsonb_build_object('name', display_name, 'avatar_url', avatar_url)
                  from public.profiles where id = v_inv.inviter_id));
end $$;

create or replace function public.accept_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_inv public.friend_invites%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if p_code is null or p_code !~ '^[0-9A-Za-z]{10}$' then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  select * into v_inv from public.friend_invites where code = p_code for update;
  if not found then raise exception 'invite_not_found' using errcode = 'P0002'; end if;
  if v_inv.inviter_id = v_me then raise exception 'self_invite' using errcode = 'P0001'; end if;
  if public.are_friends(v_me, v_inv.inviter_id) then raise exception 'already_friends' using errcode = 'P0001'; end if;
  if v_inv.used_at is not null then raise exception 'invite_used' using errcode = 'P0001'; end if;
  if v_inv.expires_at <= public.app_now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;

  perform public.lock_users(array[v_me, v_inv.inviter_id]);
  begin
    insert into public.friendships (user_a, user_b, created_at)
    values (least(v_me, v_inv.inviter_id), greatest(v_me, v_inv.inviter_id), public.app_now());
  exception when unique_violation then
    -- Two invites between the same people accepted at the same moment.
    raise exception 'already_friends' using errcode = 'P0001';
  end;
  update public.friend_invites set used_by = v_me, used_at = public.app_now() where code = p_code;
  -- friends is an achievement metric now (achievement_stats below): first_friend for both.
  perform public.evaluate_achievements(v_me);
  perform public.evaluate_achievements(v_inv.inviter_id);
  return jsonb_build_object('friend', (
    select jsonb_build_object('id', id, 'name', display_name, 'avatar_url', avatar_url)
      from public.profiles where id = v_inv.inviter_id));
end $$;

revoke all on function public.are_friends(uuid, uuid), public.friend_ids(uuid), public.lock_users(uuid[]),
  public.new_invite_code(), public.achievement_stats(uuid) from public, anon, authenticated;
revoke all on function public.create_invite(), public.accept_invite(text) from public, anon;
grant execute on function public.create_invite(), public.accept_invite(text) to authenticated;
revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Friends ------------------------------------------------------------------------------------------

-- Friend cards: who they are and the Phase 1a public card (levels, week XP, streak, badges).
create or replace function public.get_friends() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url,
             'since', f.created_at, 'shares_activity', p.share_activity,
             'card', public.progress_card(p.id))
           order by lower(p.display_name), p.id)
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_me then f.user_b else f.user_a end
     where v_me in (f.user_a, f.user_b)), '[]'::jsonb);
end $$;

-- Feed ---------------------------------------------------------------------------------------------

-- Finished workouts of friends who share (checked now, not when the workout happened), newest
-- first, 20 at a time. The PRs of a session ride along by source_ref (<session>:<exercise>):
-- only the exercise ids. The set count is the one number shown; volume, start hour and weights
-- never leave the server.
create or replace function public.get_feed(p_before timestamptz default null, p_before_id bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_items jsonb;
  v_n     integer;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_items, v_n
    from (
      select e.id, e.created_at, jsonb_build_object(
               'id', e.id, 'at', e.created_at, 'day', e.occurred_on,
               'user', jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url),
               'sets', case when jsonb_typeof(e.payload -> 'sets') = 'number'
                            then least(greatest((e.payload ->> 'sets')::numeric, 0), 999)::int end,
               'prs', coalesce((
                 select jsonb_agg(left(pr.payload ->> 'ex', 40) order by pr.id)
                   from public.activity_events pr
                  where pr.user_id = e.user_id and pr.kind = 'pr'
                    and jsonb_typeof(pr.payload -> 'ex') = 'string'
                    and left(pr.source_ref, char_length(e.source_ref) + 1) = e.source_ref || ':'), '[]'::jsonb)
             ) as item
        from public.activity_events e
        join public.profiles p on p.id = e.user_id
       where e.kind = 'workout_completed'
         and p.share_activity
         and e.user_id in (select public.friend_ids(v_me))
         and (p_before is null
              or (e.created_at, e.id) < (p_before, coalesce(p_before_id, 9223372036854775807)))
       order by e.created_at desc, e.id desc
       limit 20
    ) x;
  return jsonb_build_object(
    'items', v_items,
    'next', case when v_n = 20 then
      jsonb_build_object('before', v_items -> 19 -> 'at', 'before_id', v_items -> 19 -> 'id') end);
end $$;

revoke all on function public.get_friends(), public.get_feed(timestamptz, bigint) from public, anon;
grant execute on function public.get_friends(), public.get_feed(timestamptz, bigint) to authenticated;

-- Challenges ---------------------------------------------------------------------------------------

create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  template   text not null check (template in ('workouts_count', 'weeks_on_target', 'volume_total')),
  title      text not null check (char_length(title) between 1 and 60),
  mode       text not null check (mode in ('team', 'solo')),
  target     numeric not null check (target > 0),
  starts_on  date not null,
  -- 7 to 92 days, both ends included.
  ends_on    date not null check (ends_on - starts_on between 6 and 91),
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  status     text not null default 'active' check (status in ('active', 'won', 'lost', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  check (template <> 'weeks_on_target' or mode = 'solo')
);
create index challenges_active on public.challenges (ends_on) where status = 'active';

create table public.challenge_members (
  challenge_id uuid not null references public.challenges on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  invited_by   uuid references auth.users on delete set null,
  joined_at    timestamptz,              -- null: invited, has not answered yet
  share_volume boolean not null default false,
  final        numeric,                  -- progress frozen when the challenge closed
  won          boolean,
  primary key (challenge_id, user_id)
);
create index challenge_members_user on public.challenge_members (user_id);

-- Used by the policies below; security definer so the policy on challenge_members does not
-- recurse into itself.
create or replace function public.is_challenge_member(p_challenge uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.challenge_members
                  where challenge_id = p_challenge and user_id = auth.uid())
$$;

alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
create policy challenges_select_members on public.challenges for select to authenticated
  using (public.is_challenge_member(id));
create policy challenge_members_select on public.challenge_members for select to authenticated
  using (public.is_challenge_member(challenge_id));
revoke all on public.challenges, public.challenge_members from anon;
revoke insert, update, delete, truncate on public.challenges, public.challenge_members from authenticated;
grant select on public.challenges, public.challenge_members to authenticated;

-- Where each template's numbers come from (Decision 11): workouts_count counts finished workouts
-- in the period; weeks_on_target counts the weeks touching the period whose goal was met (Phase 1a
-- writes one 'week_target' ledger row per such week); volume_total adds up the volume of the
-- workouts (each capped at 100 000, in the member's unit, pounds converted) in tonnes.
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

-- One challenge as its members see it: live progress while active, the frozen one after.
create or replace function public.challenge_json(p_challenge uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select * from public.challenges where id = p_challenge),
  m as (
    select cm.user_id, cm.joined_at is not null as joined, cm.won, cm.invited_by, p.display_name, p.avatar_url,
           case when cm.joined_at is null then null
                when (select status from c) = 'active' then public.challenge_progress(p_challenge, cm.user_id)
                else cm.final end as progress
      from public.challenge_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.challenge_id = p_challenge)
  select jsonb_build_object(
    'id', c.id, 'template', c.template, 'title', c.title, 'mode', c.mode, 'target', c.target,
    'starts_on', c.starts_on, 'ends_on', c.ends_on, 'status', c.status, 'created_by', c.created_by,
    'invited_by', (select pr.display_name from m join public.profiles pr on pr.id = m.invited_by where m.user_id = p_me),
    'total', coalesce((select sum(progress) from m where joined), 0),
    'me', (select jsonb_build_object('joined', joined, 'won', won) from m where user_id = p_me),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', user_id, 'name', display_name, 'avatar_url', avatar_url, 'me', user_id = p_me,
               'joined', joined, 'progress', progress, 'won', won)
             order by joined desc, progress desc nulls last, lower(display_name), user_id)
        from m), '[]'::jsonb))
  from c
$$;

create or replace function public.create_challenge(
  p_template text, p_title text, p_mode text, p_target numeric, p_starts_on date, p_ends_on date,
  p_invitees uuid[], p_share_volume boolean default false
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
  if p_template is null or p_template not in ('workouts_count', 'weeks_on_target', 'volume_total')
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
     or cardinality(v_people) not between 1 and 19 then
    raise exception 'invalid_challenge' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_people) u where not public.are_friends(v_me, u)) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;
  if p_template = 'volume_total' and not coalesce(p_share_volume, false) then
    raise exception 'volume_opt_in_required' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('challenge-create:' || v_me::text, 0));
  if (select count(*) from public.challenges where created_by = v_me and status = 'active') >= 10 then
    raise exception 'challenge_limit' using errcode = 'P0001';
  end if;

  insert into public.challenges (template, title, mode, target, starts_on, ends_on, created_by)
  values (p_template, v_title, p_mode, p_target, p_starts_on, p_ends_on, v_me)
  returning id into v_id;
  insert into public.challenge_members (challenge_id, user_id, invited_by, joined_at, share_volume)
  values (v_id, v_me, null, public.app_now(), p_template = 'volume_total');
  insert into public.challenge_members (challenge_id, user_id, invited_by)
  select v_id, u, v_me from unnest(v_people) u;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.join_challenge(p_id uuid, p_share_volume boolean default false) returns void
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
  if v_c.status <> 'active' or public.local_today(v_c.created_by) > v_c.ends_on then
    raise exception 'challenge_closed' using errcode = 'P0001';
  end if;
  if v_m.joined_at is not null then return; end if;
  if v_c.template = 'volume_total' and not coalesce(p_share_volume, false) then
    raise exception 'volume_opt_in_required' using errcode = 'P0001';
  end if;
  update public.challenge_members
     set joined_at = public.app_now(), share_volume = (v_c.template = 'volume_total')
   where challenge_id = p_id and user_id = v_me;
end $$;

-- An invited person who leaves declines; a participant who leaves is out. A challenge nobody is
-- in any more goes away.
create or replace function public.leave_challenge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_c  public.challenges%rowtype;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.challenge_members where challenge_id = p_id and user_id = v_me) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  select * into v_c from public.challenges where id = p_id for update;
  if v_c.status <> 'active' or public.local_today(v_c.created_by) > v_c.ends_on then
    raise exception 'challenge_closed' using errcode = 'P0001';
  end if;
  delete from public.challenge_members where challenge_id = p_id and user_id = v_me;
  if not exists (select 1 from public.challenge_members where challenge_id = p_id and joined_at is not null) then
    delete from public.challenges where id = p_id;
  end if;
end $$;

-- Active first (invitations on top, then by end date), then the ones closed in the last 60 days.
create or replace function public.get_challenges() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform public.close_due_challenges(v_me);
  return coalesce((
    select jsonb_agg(public.challenge_json(c.id, v_me)
             order by (c.status = 'active') desc, (m.joined_at is null) desc,
                      case when c.status = 'active' then c.ends_on end, c.closed_at desc nulls last, c.id)
      from public.challenges c
      join public.challenge_members m on m.challenge_id = c.id and m.user_id = v_me
     where c.status = 'active' or c.closed_at > public.app_now() - interval '60 days'), '[]'::jsonb);
end $$;

revoke all on function public.challenge_progress(uuid, uuid), public.challenge_json(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.is_challenge_member(uuid),
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean),
  public.join_challenge(uuid, boolean), public.leave_challenge(uuid), public.get_challenges()
  from public, anon;
grant execute on function public.is_challenge_member(uuid),
  public.create_challenge(text, text, text, numeric, date, date, uuid[], boolean),
  public.join_challenge(uuid, boolean), public.leave_challenge(uuid), public.get_challenges()
  to authenticated;

-- Closing ------------------------------------------------------------------------------------------

-- Closes one challenge once the creator's local day is past ends_on (Decision 12). Unanswered
-- invitations go; fewer than two participants cancel it; otherwise progress is frozen, team wins
-- together and solo wins one by one, and each winner gets +300 once ('challenge:<id>') plus the
-- badges that unlocks. The global closing lock comes before any per-user lock (Decision 6).
create or replace function public.close_challenge(p_challenge uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  c         public.challenges%rowtype;
  v_members uuid[];
  v_won     boolean;
  r         record;
begin
  perform pg_advisory_xact_lock(hashtextextended('challenge-close', 0));
  select * into c from public.challenges where id = p_challenge for update;
  if not found or c.status <> 'active' or public.local_today(c.created_by) <= c.ends_on then
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

-- The lazy path: what one person is in. Takes no lock when nothing is due.
create or replace function public.close_due_challenges(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id from public.challenges c
      join public.challenge_members m on m.challenge_id = c.id and m.user_id = p_user
     where c.status = 'active' and c.ends_on < public.local_today(c.created_by)
     order by c.id
  loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- The daily safety net (0005 schedules it).
create or replace function public.close_all_challenges() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.challenges
            where status = 'active' and ends_on < public.local_today(created_by) order by id loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Leaderboards -------------------------------------------------------------------------------------

-- Me and my friends. 'week': XP of each person's own current local week, compared with their
-- previous week. 'all': total XP, compared with the total before the current week. Ties share a
-- position; gap is what is missing to reach the next score above (null for the leader).
create or replace function public.leaderboard_json(p_me uuid, p_kind text) returns jsonb
language sql stable security definer set search_path = public as $$
  with people as (
    select p.id, p.display_name, p.avatar_url,
           public.local_week_start(p.id) as wk, public.total_xp(p.id) as total
      from public.profiles p
     where p.id = p_me or p.id in (select public.friend_ids(p_me))),
  scored as (
    select x.*,
           case when p_kind = 'week' then public.week_xp(x.id, x.wk)::bigint else x.total end as score,
           case when p_kind = 'week' then public.week_xp(x.id, x.wk - 7)::bigint
                else x.total - public.week_xp(x.id, x.wk) end as before
      from people x),
  ranked as (
    select s.*, rank() over (order by s.score desc) as pos, rank() over (order by s.before desc) as prev_pos
      from scored s)
  select jsonb_build_object(
    'week_start', public.local_week_start(p_me),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
              'id', r.id, 'name', r.display_name, 'avatar_url', r.avatar_url, 'me', r.id = p_me,
              'xp', r.score, 'level', (public.level_for(r.total)).level,
              'pos', r.pos, 'prev_pos', r.prev_pos,
              'gap', (select min(o.score) from ranked o where o.score > r.score) - r.score)
            order by r.pos, lower(r.display_name), r.id), '[]'::jsonb))
  from ranked r
$$;

create or replace function public.get_weekly_leaderboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform public.close_due_challenges(v_me);
  return public.leaderboard_json(v_me, 'week');
end $$;

create or replace function public.get_alltime_leaderboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform public.close_due_challenges(v_me);
  return public.leaderboard_json(v_me, 'all');
end $$;

revoke all on function public.close_challenge(uuid), public.close_due_challenges(uuid),
  public.close_all_challenges(), public.leaderboard_json(uuid, text) from public, anon, authenticated;
revoke all on function public.get_weekly_leaderboard(), public.get_alltime_leaderboard() from public, anon;
grant execute on function public.get_weekly_leaderboard(), public.get_alltime_leaderboard() to authenticated;

-- Achievement metrics: Phase 1a's, plus the social ones it left for this phase -------------------

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
    'challenges_won', (select count(*) from public.challenge_members where user_id = p_user and won)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;
