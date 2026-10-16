-- Phase 4a, base: habits profile column, pillar periods, habits, weekly targets per habit, checks and
-- server-only event kinds (spec 3, 6.1 and 6.2; plan decisions 5, 6 and 8).

-- Profile ---------------------------------------------------------------------------------------

alter table public.profiles add column habits_enabled boolean not null default false;

-- Periods ---------------------------------------------------------------------------------------
-- A day is only judged when it falls inside a period. A period with ended_on = started_on - 1
-- (turned on and off the same day) covers no day.

create table public.habit_periods (
  user_id    uuid not null references auth.users on delete cascade,
  started_on date not null,
  ended_on   date check (ended_on is null or ended_on >= started_on - 1),
  primary key (user_id, started_on)
);

alter table public.habit_periods enable row level security;
create policy habit_periods_select_own on public.habit_periods
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.habit_periods from anon, authenticated;
revoke select on public.habit_periods from anon;

create function public.profiles_habits_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.local_today(new.id);
begin
  if new.habits_enabled then
    if tg_op = 'UPDATE' and old.habits_enabled then return null; end if;
    -- Turned back on the day it was turned off: the same period continues.
    update public.habit_periods set ended_on = null
     where user_id = new.id and ended_on = v_today - 1;
    if not found then
      insert into public.habit_periods (user_id, started_on) values (new.id, v_today)
      on conflict (user_id, started_on) do update set ended_on = null;
    end if;
  else
    update public.habit_periods set ended_on = v_today - 1
     where user_id = new.id and ended_on is null;
  end if;
  return null;
end $$;

create trigger profiles_habits_period after insert or update of habits_enabled on public.profiles
  for each row execute function public.profiles_habits_period();

create function public.habits_active_on(p_user uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.habit_periods
     where user_id = p_user and started_on <= p_day and (ended_on is null or ended_on >= p_day))
$$;

-- Habits ----------------------------------------------------------------------------------------
-- The id comes from the device (the offline queue stays idempotent). No delete: archiving is an
-- update, and the history stays.

create table public.habits (
  id          uuid primary key,
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  name        text not null check (char_length(btrim(name)) between 1 and 40 and name = btrim(name)),
  icon        text not null check (icon ~ '^[a-z][a-z0-9-]{0,31}$'),
  per_week    smallint not null check (per_week between 1 and 7),
  sort        integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.habits enable row level security;
revoke all on public.habits from anon;
revoke delete, truncate on public.habits from authenticated;

create policy habits_select_own on public.habits
  for select to authenticated using (user_id = auth.uid());
create policy habits_insert_own on public.habits
  for insert to authenticated with check (user_id = auth.uid());
create policy habits_update_own on public.habits
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Weekly targets --------------------------------------------------------------------------------
-- N is frozen per habit and week; Q of a week is the sum of its targets. Clients only read them.

create table public.habit_targets (
  habit_id   uuid not null references public.habits on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  week_start date not null,
  target     smallint not null check (target between 0 and 7),
  primary key (habit_id, week_start)
);

alter table public.habit_targets enable row level security;
create policy habit_targets_select_own on public.habit_targets
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.habit_targets from anon, authenticated;
revoke select on public.habit_targets from anon;

-- Days left in the person's week, today included: 7 on Monday, 1 on Sunday.
create function public.habit_days_left(p_user uuid) returns smallint
language sql stable security definer set search_path = public as $$
  select (8 - extract(isodow from public.local_today(p_user)))::smallint
$$;

-- The targets a week starts with: N for every active habit created (local date) by its Monday.
-- Rows already there stay; a habit created later in the week got its row from habits_targets_sync.
create function public.freeze_habit_targets(p_user uuid, p_week date) returns void
language sql security definer set search_path = public as $$
  insert into public.habit_targets (habit_id, user_id, week_start, target)
  select h.id, h.user_id, p_week, h.per_week
    from public.habits h
   where h.user_id = p_user and h.archived_at is null
     and (h.created_at at time zone coalesce(
           (select timezone from public.profiles where id = p_user), 'America/Sao_Paulo'))::date <= p_week
  on conflict (habit_id, week_start) do nothing
$$;

-- Security invoker: RLS keeps a client on its own habits, so the count is the owner's.
create function public.habits_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.id <> old.id) then
    raise exception 'item_immutable' using errcode = 'P0001';
  end if;

  -- Last write wins: the client's updated_at, capped at now(); an older write is dropped.
  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;

  -- A new active habit or a reactivated one. The id is left out of the count, so re-sending a
  -- habit that is already active (an upsert from the queue) is not a 21st.
  if new.archived_at is null and (tg_op = 'INSERT' or old.archived_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended('habits:' || new.user_id::text, 0));
    if (select count(*) from public.habits
         where user_id = new.user_id and archived_at is null and id <> new.id) >= 20 then
      raise exception 'too_many_habits' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger habits_guard before insert or update on public.habits
  for each row execute function public.habits_guard();

-- The running week of a habit (spec 3.3). Security definer: clients cannot write habit_targets.
create function public.habits_targets_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.local_today(new.user_id);
  v_week  date := public.week_start_of(v_today);
  v_left  smallint := public.habit_days_left(new.user_id);
begin
  if tg_op = 'INSERT' then
    -- Created: the days left in the week, today included.
    if new.archived_at is null then
      insert into public.habit_targets (habit_id, user_id, week_start, target)
      values (new.id, new.user_id, v_week, least(new.per_week, v_left))
      on conflict (habit_id, week_start) do nothing;
    end if;
  elsif old.archived_at is null and new.archived_at is not null then
    -- Archived: the week freezes if nothing did yet, then drops to the checks already made, so
    -- the habit cannot keep the week from 100%.
    insert into public.habit_targets (habit_id, user_id, week_start, target)
    values (new.id, new.user_id, v_week, old.per_week)
    on conflict (habit_id, week_start) do nothing;
    update public.habit_targets t
       set target = least(t.target, (select count(*) from public.habit_checks c
                                      where c.habit_id = new.id and c.day between v_week and v_today))
     where t.habit_id = new.id and t.week_start = v_week;
  elsif old.archived_at is not null and new.archived_at is null then
    -- Reactivated: as if created now, but never below a target the week already had.
    insert into public.habit_targets (habit_id, user_id, week_start, target)
    values (new.id, new.user_id, v_week, least(new.per_week, v_left))
    on conflict (habit_id, week_start) do update
      set target = greatest(habit_targets.target, excluded.target);
  elsif new.archived_at is null and new.per_week <> old.per_week then
    -- A new N counts from next week: the running week keeps the old one.
    insert into public.habit_targets (habit_id, user_id, week_start, target)
    values (new.id, new.user_id, v_week, old.per_week)
    on conflict (habit_id, week_start) do nothing;
  end if;
  return null;
end $$;

create trigger habits_targets_sync after insert or update on public.habits
  for each row execute function public.habits_targets_sync();

-- Checks ----------------------------------------------------------------------------------------

create table public.habit_checks (
  habit_id   uuid not null references public.habits on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);

alter table public.habit_checks enable row level security;
revoke all on public.habit_checks from anon;
revoke update, truncate on public.habit_checks from authenticated;

create policy habit_checks_select_own on public.habit_checks
  for select to authenticated using (user_id = auth.uid());
create policy habit_checks_insert_own on public.habit_checks
  for insert to authenticated with check (user_id = auth.uid());
create policy habit_checks_delete_own on public.habit_checks
  for delete to authenticated using (user_id = auth.uid());

-- Security invoker: the rules apply only to client roles. Security definer functions (the closing,
-- delete_my_account) and the cascade from auth.users run as the owner and pass untouched. RLS keeps
-- a client on its own rows and habits, so a habit it cannot see reads as archived, and the
-- signed-in person's today is the row owner's today.
create function public.habit_checks_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_today date;
  v_row   public.habit_checks := coalesce(new, old);
begin
  if current_user not in ('authenticated', 'anon') then
    return v_row;
  end if;

  v_today := public.my_local_today();
  if v_row.day not in (v_today - 1, v_today) then
    raise exception 'day_closed' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.habits
                  where id = v_row.habit_id and user_id = auth.uid() and archived_at is null) then
    raise exception 'habit_archived' using errcode = 'P0001';
  end if;

  -- Unchecking a day stays possible after the pillar was turned off.
  if tg_op = 'INSERT' and not exists (
       select 1 from public.habit_periods
        where user_id = auth.uid() and started_on <= new.day
          and (ended_on is null or ended_on >= new.day)) then
    raise exception 'pillar_off' using errcode = 'P0001';
  end if;

  -- Only the closing marks a check valid (habit_checks.counted, added in 0027).
  if tg_op = 'INSERT' then
    new.counted := null;
    return new;
  end if;
  return v_row;
end $$;

create trigger habit_checks_guard before insert or delete on public.habit_checks
  for each row execute function public.habit_checks_guard();

revoke all on function public.profiles_habits_period(), public.habits_active_on(uuid, date),
  public.habit_days_left(uuid), public.freeze_habit_targets(uuid, date), public.habits_guard(),
  public.habits_targets_sync(), public.habit_checks_guard() from public, anon, authenticated;

-- Server-only event kinds -----------------------------------------------------------------------
-- The closing writes them; the insert policy of activity_events (0007) keeps clients out.

insert into public.event_kinds (pillar, kind, server_only) values
  ('habits', 'habit_check', true),
  ('habits', 'habit_day', true),
  ('habits', 'habit_week_target', true);
