-- Account deletion: the person removes their own account and everything the server keeps about
-- them, from Perfil > Excluir minha conta. The auth.users row goes, and every table that points at
-- it follows through its foreign key:
--
--   profiles.id, app_state.user_id, activity_events.user_id, weekly_targets.user_id,
--   xp_ledger.user_id (and xp_ledger.event_id through activity_events), streaks.user_id,
--   user_achievements.user_id, friend_invites.inviter_id, friendships.user_a / user_b,
--   challenge_members.user_id                                                  on delete cascade
--   friend_invites.used_by, challenge_members.invited_by                       on delete set null
--   challenges.created_by        was cascade; set null from here on (below)
--
-- A group challenge belongs to everyone in it, so it stays when its creator leaves. Its days were
-- counted in the creator's time zone (Decision 12); that zone is copied onto the challenge first
-- and keeps counting them.

-- Challenges outlive their creator -----------------------------------------------------------------

alter table public.challenges add column timezone text;
alter table public.challenges alter column created_by drop not null;
alter table public.challenges drop constraint challenges_created_by_fkey;
alter table public.challenges add constraint challenges_created_by_fkey
  foreign key (created_by) references auth.users on delete set null;

-- The challenge's own today: the creator's local day while the creator is here, then the zone kept
-- on the challenge.
create or replace function public.challenge_today(p_created_by uuid, p_timezone text) returns date
language sql stable security definer set search_path = public as $$
  select (public.app_now() at time zone coalesce(
    (select timezone from public.profiles where id = p_created_by), p_timezone, 'America/Sao_Paulo'))::date
$$;
revoke all on function public.challenge_today(uuid, text) from public, anon, authenticated;

-- Same functions as 0004, reading the day through challenge_today.

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
  if v_c.status <> 'active' or public.challenge_today(v_c.created_by, v_c.timezone) > v_c.ends_on then
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
  if v_c.status <> 'active' or public.challenge_today(v_c.created_by, v_c.timezone) > v_c.ends_on then
    raise exception 'challenge_closed' using errcode = 'P0001';
  end if;
  delete from public.challenge_members where challenge_id = p_id and user_id = v_me;
  if not exists (select 1 from public.challenge_members where challenge_id = p_id and joined_at is not null) then
    delete from public.challenges where id = p_id;
  end if;
end $$;

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
  if not found or c.status <> 'active' or public.challenge_today(c.created_by, c.timezone) <= c.ends_on then
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

create or replace function public.close_due_challenges(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id from public.challenges c
      join public.challenge_members m on m.challenge_id = c.id and m.user_id = p_user
     where c.status = 'active' and c.ends_on < public.challenge_today(c.created_by, c.timezone)
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
            where status = 'active' and ends_on < public.challenge_today(created_by, timezone) order by id loop
    if public.close_challenge(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Deleting one's own account ------------------------------------------------------------------------

-- Takes the challenge-closing lock and then the person's XP lock, the order every closing takes
-- them in (Decision 6), so no challenge is paid out or frozen half way through the deletion. A
-- challenge nobody else ever joined goes with the account, as leave_challenge does; the others
-- stay with the people still in them, and one left with fewer than two participants is cancelled
-- when it closes.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('challenge-close', 0));
  perform public.lock_users(array[v_me]);

  update public.challenges
     set timezone = coalesce((select timezone from public.profiles where id = v_me), timezone, 'America/Sao_Paulo')
   where created_by = v_me;
  delete from public.challenges c
   where exists (select 1 from public.challenge_members m where m.challenge_id = c.id and m.user_id = v_me)
     and not exists (select 1 from public.challenge_members m
                      where m.challenge_id = c.id and m.user_id <> v_me and m.joined_at is not null);

  delete from auth.users where id = v_me;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
