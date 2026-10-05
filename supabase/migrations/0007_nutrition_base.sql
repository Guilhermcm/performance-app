-- Phase 2a, base: nutrition profile columns, pillar periods and server-only event kinds.

-- Profile -------------------------------------------------------------------------------------

alter table public.profiles
  add column activity_level text check (activity_level in
    ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  add column nutrition_pace text not null default 'standard'
    check (nutrition_pace in ('gentle', 'standard')),
  add column nutrition_enabled boolean not null default false,
  add column nutrition_days_per_week smallint not null default 5
    check (nutrition_days_per_week between 3 and 7);

-- Periods -------------------------------------------------------------------------------------
-- A day is only judged when it falls inside a period. A period with ended_on = started_on - 1
-- (turned on and off the same day) covers no day.

create table public.nutrition_periods (
  user_id    uuid not null references auth.users on delete cascade,
  started_on date not null,
  ended_on   date check (ended_on is null or ended_on >= started_on - 1),
  primary key (user_id, started_on)
);

alter table public.nutrition_periods enable row level security;
create policy nutrition_periods_select_own on public.nutrition_periods
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.nutrition_periods from anon, authenticated;
revoke select on public.nutrition_periods from anon;

create or replace function public.profiles_nutrition_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.local_today(new.id);
begin
  if new.nutrition_enabled then
    if tg_op = 'UPDATE' and old.nutrition_enabled then return null; end if;
    -- Turned back on the day it was turned off: the same period continues.
    update public.nutrition_periods set ended_on = null
     where user_id = new.id and ended_on = v_today - 1;
    if not found then
      insert into public.nutrition_periods (user_id, started_on) values (new.id, v_today)
      on conflict (user_id, started_on) do update set ended_on = null;
    end if;
  else
    update public.nutrition_periods set ended_on = v_today - 1
     where user_id = new.id and ended_on is null;
  end if;
  return null;
end $$;

create trigger profiles_nutrition_period after insert or update of nutrition_enabled on public.profiles
  for each row execute function public.profiles_nutrition_period();

create or replace function public.nutrition_active_on(p_user uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.nutrition_periods
     where user_id = p_user and started_on <= p_day and (ended_on is null or ended_on >= p_day))
$$;

revoke all on function public.profiles_nutrition_period(), public.nutrition_active_on(uuid, date)
  from public, anon, authenticated;

-- Server-only event kinds ---------------------------------------------------------------------
-- Clients write as authenticated and go through RLS; security definer functions write as the
-- owner and do not. The insert policy keeps clients from writing a server_only kind.

alter table public.event_kinds add column server_only boolean not null default false;
insert into public.event_kinds (pillar, kind, server_only) values
  ('nutrition', 'day_logged', true),
  ('nutrition', 'day_on_target', true),
  ('nutrition', 'macros_balanced', true);

drop policy activity_events_insert_own on public.activity_events;
create policy activity_events_insert_own on public.activity_events for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.event_kinds k
       where k.pillar = activity_events.pillar and k.kind = activity_events.kind and k.server_only)
  );

-- A closing that runs late must not break: server-only kinds skip the 14-day window.
create or replace function public.validate_activity_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz          text;
  v_today       date;
  v_server_only boolean;
begin
  select k.server_only into v_server_only
    from public.event_kinds k where k.pillar = new.pillar and k.kind = new.kind;
  if not found then
    raise exception 'unknown_kind' using errcode = '22023';
  end if;
  if octet_length(new.payload::text) > 4096 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;
  if v_server_only then return new; end if;
  select timezone into v_tz from public.profiles where id = new.user_id;
  v_today := (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date;
  if new.occurred_on > v_today or new.occurred_on < v_today - 14 then
    raise exception 'out_of_window' using errcode = '22023';
  end if;
  return new;
end $$;
