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
    'friends', (select count(*) from public.friendships where p_user in (user_a, user_b))
  )
$$;

revoke all on function public.are_friends(uuid, uuid), public.friend_ids(uuid), public.lock_users(uuid[]),
  public.new_invite_code(), public.achievement_stats(uuid) from public, anon, authenticated;
revoke all on function public.create_invite(), public.accept_invite(text) from public, anon;
grant execute on function public.create_invite(), public.accept_invite(text) to authenticated;
revoke all on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;
