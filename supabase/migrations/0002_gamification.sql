-- Phase 1a: XP ledger, weekly targets, streaks and achievements. The server is the authority:
-- clients only insert activity_events; everything below is written by security definer functions.

-- Clock and calendar ----------------------------------------------------------------------------

-- now(), except in the SQL tests: a superuser session may pin it with
-- set_config('app.now', '<timestamptz>', false). PostgREST connects as a role that is not a
-- superuser, so no client can move it.
create or replace function public.app_now() returns timestamptz
language sql stable as $$
  select case
    when coalesce(current_setting('app.now', true), '') <> ''
     and coalesce((select rolsuper from pg_roles where rolname = session_user), false)
    then current_setting('app.now', true)::timestamptz
    else now()
  end
$$;

-- Monday of the week a local date belongs to.
create or replace function public.week_start_of(d date) returns date
language sql immutable as $$
  select d - (extract(isodow from d)::int - 1)
$$;

create or replace function public.local_today(p_user uuid) returns date
language sql stable security definer set search_path = public as $$
  select (public.app_now() at time zone coalesce(
    (select timezone from public.profiles where id = p_user), 'America/Sao_Paulo'))::date
$$;

create or replace function public.local_week_start(p_user uuid) returns date
language sql stable security definer set search_path = public as $$
  select public.week_start_of(public.local_today(p_user))
$$;

-- Levels: level n needs 100 + 50·(n − 1) XP to reach n + 1 ------------------------------------

create or replace function public.level_for(p_xp bigint, out level integer, out into_level integer, out need integer)
language plpgsql immutable as $$
declare
  v_left bigint := greatest(coalesce(p_xp, 0), 0);
begin
  level := 1;
  need := 100;
  while v_left >= need loop
    v_left := v_left - need;
    level := level + 1;
    need := 100 + 50 * (level - 1);
  end loop;
  into_level := v_left;
end $$;

create or replace function public.level_json(p_xp bigint) returns jsonb
language sql immutable as $$
  select jsonb_build_object('level', l.level, 'into', l.into_level, 'need', l.need)
  from public.level_for(p_xp) l
$$;

-- What the index-th planned session of a week with target T pays. The T-th takes the remainder,
-- so the planned sessions of any week add up to exactly 600 (T = 7: six of 86 and one of 84).
create or replace function public.session_xp(p_target integer, p_index integer) returns integer
language sql immutable as $$
  select case when p_index < p_target then round(600.0 / p_target)::int
              else 600 - round(600.0 / p_target)::int * (p_target - 1) end
$$;

-- Tables -----------------------------------------------------------------------------------------

-- days_per_week as it stood when each week began; a change made mid-week applies next week.
create table public.weekly_targets (
  user_id    uuid not null references auth.users on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  target     smallint not null check (target between 1 and 7),
  primary key (user_id, week_start)
);

create table public.xp_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  pillar     public.pillar,              -- null = general bonus (achievement, challenge)
  amount     integer not null check (amount > 0),
  reason     text not null check (char_length(reason) between 1 and 80),
  event_id   bigint references public.activity_events on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  created_at timestamptz not null default now()
);
create index xp_ledger_user_week on public.xp_ledger (user_id, week_start);
create index xp_ledger_event on public.xp_ledger (event_id);
-- A bonus without an event (an achievement, a challenge won) is paid once per reason.
create unique index xp_ledger_bonus_once on public.xp_ledger (user_id, reason) where event_id is null;

create table public.streaks (
  user_id     uuid not null references auth.users on delete cascade,
  kind        text not null,
  current     integer not null default 0,
  best        integer not null default 0,
  shields     smallint not null default 0 check (shields between 0 and 2),
  last_period date,
  primary key (user_id, kind)
);

alter table public.weekly_targets enable row level security;
alter table public.xp_ledger enable row level security;
alter table public.streaks enable row level security;
create policy weekly_targets_select_own on public.weekly_targets for select to authenticated using (user_id = auth.uid());
create policy xp_ledger_select_own on public.xp_ledger for select to authenticated using (user_id = auth.uid());
create policy streaks_select_own on public.streaks for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.weekly_targets, public.xp_ledger, public.streaks from anon, authenticated;
grant select on public.weekly_targets, public.xp_ledger, public.streaks to authenticated;

-- Weekly target -----------------------------------------------------------------------------------

create or replace function public.week_target_for(p_user uuid, p_week date) returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v smallint;
begin
  select target into v from public.weekly_targets where user_id = p_user and week_start = p_week;
  if found then return v; end if;
  -- A week nothing touched while it ran: the value in force then is the one frozen for the next
  -- touched week after it or, failing that, the profile's.
  select target into v from public.weekly_targets
   where user_id = p_user and week_start > p_week order by week_start limit 1;
  if v is null then select days_per_week into v from public.profiles where id = p_user; end if;
  insert into public.weekly_targets (user_id, week_start, target)
  values (p_user, p_week, coalesce(v, 3))
  on conflict do nothing;
  select target into v from public.weekly_targets where user_id = p_user and week_start = p_week;
  return v;
end $$;

-- Changing days_per_week freezes the running week with the old value first.
create or replace function public.freeze_week_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.days_per_week is distinct from old.days_per_week then
    insert into public.weekly_targets (user_id, week_start, target)
    values (old.id, public.local_week_start(old.id), old.days_per_week)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger profiles_freeze_target before update of days_per_week on public.profiles
  for each row execute function public.freeze_week_target();

revoke all on function public.local_today(uuid), public.local_week_start(uuid),
  public.week_target_for(uuid, date), public.freeze_week_target() from public, anon, authenticated;
