-- Phase 3, base: sleep profile columns, pillar periods, targets, night logs and server-only event
-- kinds (spec 6.1 and 6.2).

-- Profile ---------------------------------------------------------------------------------------

alter table public.profiles
  add column sleep_enabled boolean not null default false,
  add column sleep_nights_per_week smallint not null default 5
    check (sleep_nights_per_week between 3 and 7);

-- Periods ---------------------------------------------------------------------------------------
-- A night is only judged when it falls inside a period. A period with ended_on = started_on - 1
-- (turned on and off the same day) covers no night.

create table public.sleep_periods (
  user_id    uuid not null references auth.users on delete cascade,
  started_on date not null,
  ended_on   date check (ended_on is null or ended_on >= started_on - 1),
  primary key (user_id, started_on)
);

alter table public.sleep_periods enable row level security;
create policy sleep_periods_select_own on public.sleep_periods
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.sleep_periods from anon, authenticated;
revoke select on public.sleep_periods from anon;

create function public.profiles_sleep_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.local_today(new.id);
begin
  if new.sleep_enabled then
    if tg_op = 'UPDATE' and old.sleep_enabled then return null; end if;
    -- Turned back on the day it was turned off: the same period continues.
    update public.sleep_periods set ended_on = null
     where user_id = new.id and ended_on = v_today - 1;
    if not found then
      insert into public.sleep_periods (user_id, started_on) values (new.id, v_today)
      on conflict (user_id, started_on) do update set ended_on = null;
    end if;
  else
    update public.sleep_periods set ended_on = v_today - 1
     where user_id = new.id and ended_on is null;
  end if;
  return null;
end $$;

create trigger profiles_sleep_period after insert or update of sleep_enabled on public.profiles
  for each row execute function public.profiles_sleep_period();

create function public.sleep_active_on(p_user uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sleep_periods
     where user_id = p_user and started_on <= p_day and (ended_on is null or ended_on >= p_day))
$$;

-- Targets ---------------------------------------------------------------------------------------

create table public.sleep_targets (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  valid_from date not null,
  goal_min   smallint not null check (goal_min between 360 and 600 and goal_min % 15 = 0),
  bed_target time not null check (extract(second from bed_target) = 0),
  created_at timestamptz not null default now(),
  primary key (user_id, valid_from)
);

alter table public.sleep_targets enable row level security;
revoke all on public.sleep_targets from anon;
revoke truncate, delete on public.sleep_targets from authenticated;

-- The first target may start today; every later one starts tomorrow at the earliest, and only
-- targets still in the future can change.
create policy sleep_targets_select_own on public.sleep_targets
  for select to authenticated using (user_id = auth.uid());
create policy sleep_targets_insert_own on public.sleep_targets
  for insert to authenticated with check (
    user_id = auth.uid()
    and (valid_from > public.my_local_today()
         or (valid_from = public.my_local_today()
             and not exists (select 1 from public.sleep_targets t where t.user_id = auth.uid()))));
create policy sleep_targets_update_own on public.sleep_targets
  for update to authenticated
  using (user_id = auth.uid() and valid_from > public.my_local_today())
  with check (user_id = auth.uid() and valid_from > public.my_local_today());

-- The target in force on a night: the row with the greatest valid_from <= night.
create function public.sleep_target_on(p_user uuid, p_night date) returns public.sleep_targets
language sql stable security definer set search_path = public as $$
  select t from public.sleep_targets t
   where t.user_id = p_user and t.valid_from <= p_night
   order by t.valid_from desc limit 1
$$;

-- Night logs ------------------------------------------------------------------------------------
-- night is the local date the person woke up on. The duration wraps around midnight.

create table public.sleep_logs (
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  night        date not null,
  bed_time     time not null check (extract(second from bed_time) = 0),
  wake_time    time not null check (extract(second from wake_time) = 0),
  duration_min smallint generated always as (
    ((extract(epoch from (wake_time - bed_time))::int / 60) + 1440) % 1440
  ) stored,
  quality      smallint check (quality between 1 and 5),
  note         text check (char_length(note) <= 140),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, night),
  check (duration_min between 60 and 960)
);

alter table public.sleep_logs enable row level security;
revoke all on public.sleep_logs from anon;
revoke truncate on public.sleep_logs from authenticated;

create policy sleep_logs_select_own on public.sleep_logs
  for select to authenticated using (user_id = auth.uid());
create policy sleep_logs_insert_own on public.sleep_logs
  for insert to authenticated with check (user_id = auth.uid());
create policy sleep_logs_update_own on public.sleep_logs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sleep_logs_delete_own on public.sleep_logs
  for delete to authenticated using (user_id = auth.uid());

-- Security invoker: the rules apply only to client roles. Security definer functions (the closing,
-- delete_my_account) and the cascade from auth.users run as the owner and pass untouched. RLS keeps
-- a client on its own rows, so the signed-in person's today is the row owner's today.
create function public.sleep_logs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_today date;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  v_today := public.my_local_today();
  if (tg_op <> 'DELETE' and new.night not in (v_today - 1, v_today))
     or (tg_op <> 'INSERT' and old.night not in (v_today - 1, v_today)) then
    raise exception 'night_closed' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;

  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.night <> old.night) then
    raise exception 'item_immutable' using errcode = 'P0001';
  end if;

  -- Last write wins: the client's updated_at, capped at now(); an older write is dropped.
  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

create trigger sleep_logs_guard before insert or update or delete on public.sleep_logs
  for each row execute function public.sleep_logs_guard();

revoke all on function public.profiles_sleep_period(), public.sleep_active_on(uuid, date),
  public.sleep_target_on(uuid, date), public.sleep_logs_guard() from public, anon, authenticated;

-- Server-only event kinds -----------------------------------------------------------------------
-- The closing writes them; the insert policy of activity_events (0007) keeps clients out.

insert into public.event_kinds (pillar, kind, server_only) values
  ('sleep', 'night_logged', true),
  ('sleep', 'night_on_target', true),
  ('sleep', 'night_rested', true);

-- Weekly target -------------------------------------------------------------------------------
-- Bodies from 0008_weekly_targets_pillar.sql; only the sleep branch is new.

create or replace function public.week_target_for(p_user uuid, p_week date, p_pillar public.pillar default 'strength')
returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v smallint;
begin
  select target into v from public.weekly_targets
   where user_id = p_user and pillar = p_pillar and week_start = p_week;
  if found then return v; end if;
  -- A week nothing touched while it ran: the value in force then is the one frozen for the next
  -- touched week after it or, failing that, the profile's.
  select target into v from public.weekly_targets
   where user_id = p_user and pillar = p_pillar and week_start > p_week order by week_start limit 1;
  if v is null then
    if p_pillar = 'nutrition' then
      select nutrition_days_per_week into v from public.profiles where id = p_user;
    elsif p_pillar = 'sleep' then
      select sleep_nights_per_week into v from public.profiles where id = p_user;
    else
      select days_per_week into v from public.profiles where id = p_user;
    end if;
  end if;
  insert into public.weekly_targets (user_id, pillar, week_start, target)
  values (p_user, p_pillar, p_week, coalesce(v, case when p_pillar in ('nutrition', 'sleep') then 5 else 3 end))
  on conflict do nothing;
  select target into v from public.weekly_targets
   where user_id = p_user and pillar = p_pillar and week_start = p_week;
  return v;
end $$;

-- Changing a pillar's days per week freezes the running week with the old value first.
create or replace function public.freeze_week_target() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.days_per_week is distinct from old.days_per_week then
    insert into public.weekly_targets (user_id, pillar, week_start, target)
    values (old.id, 'strength', public.local_week_start(old.id), old.days_per_week)
    on conflict do nothing;
  end if;
  if new.nutrition_days_per_week is distinct from old.nutrition_days_per_week then
    insert into public.weekly_targets (user_id, pillar, week_start, target)
    values (old.id, 'nutrition', public.local_week_start(old.id), old.nutrition_days_per_week)
    on conflict do nothing;
  end if;
  if new.sleep_nights_per_week is distinct from old.sleep_nights_per_week then
    insert into public.weekly_targets (user_id, pillar, week_start, target)
    values (old.id, 'sleep', public.local_week_start(old.id), old.sleep_nights_per_week)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger profiles_freeze_target on public.profiles;
create trigger profiles_freeze_target
  before update of days_per_week, nutrition_days_per_week, sleep_nights_per_week on public.profiles
  for each row execute function public.freeze_week_target();
