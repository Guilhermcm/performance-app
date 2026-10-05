-- Phase 0: profile, synced app state, and the activity event stream gamification reads.

create type public.pillar as enum ('strength', 'nutrition', 'sleep', 'habits');

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Profiles ------------------------------------------------------------------------------------

create table public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  display_name   text not null check (char_length(display_name) between 1 and 60),
  avatar_url     text,
  birth_date     date,
  sex            text check (sex in ('male', 'female', 'other')),
  height_cm      numeric(5,1) check (height_cm between 50 and 260),
  weight_kg      numeric(5,1) check (weight_kg between 20 and 400),
  goal           text check (goal in ('hypertrophy', 'strength', 'fat_loss', 'conditioning')),
  level          text check (level in ('beginner', 'intermediate', 'advanced')),
  days_per_week  smallint not null default 3 check (days_per_week between 1 and 7),
  equipment      text[] not null default '{}',
  unit           text not null default 'kg' check (unit in ('kg', 'lb')),
  locale         text not null default 'pt-BR' check (locale in ('pt-BR', 'en')),
  timezone       text not null default 'America/Sao_Paulo',
  share_activity boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select, insert, update on public.profiles to authenticated;

-- App state (mirror of the openGym /api/data document) ----------------------------------------

create table public.app_state (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null,
  rev        integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
create policy app_state_select_own on public.app_state for select to authenticated using (user_id = auth.uid());
grant select on public.app_state to authenticated;

-- Keeps only JSON objects in an array, in order (openGym's records()).
create or replace function public.only_objects(arr jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
  from jsonb_array_elements(arr) with ordinality as t(e, i)
  where jsonb_typeof(e) = 'object'
$$;

create or replace function public.push_state(p_data jsonb, p_base_rev integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_cur     public.app_state%rowtype;
  v_has     boolean;
  v_cur_rev integer := 0;
  v_state   jsonb := p_data;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_object_keys(p_data) k where k not in ('_rev', '_ts')) then
    raise exception 'state_required' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_data -> 'workouts'), 'null') not in ('array', 'null')
     or coalesce(jsonb_typeof(p_data -> 'routines'), 'null') not in ('array', 'null') then
    raise exception 'invalid_state' using errcode = '22023';
  end if;
  if octet_length(p_data::text) > 2 * 1024 * 1024 then
    raise exception 'state_too_large' using errcode = '54000';
  end if;

  select * into v_cur from public.app_state where user_id = v_uid for update;
  v_has := found;
  if v_has then v_cur_rev := v_cur.rev; end if;

  if p_base_rev is not null and p_base_rev <> v_cur_rev then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'rev', v_cur_rev,
                              'state', case when v_has then v_cur.data else null end);
  end if;

  v_state := v_state - 'active';
  if jsonb_typeof(v_state -> 'workouts') = 'array' then
    v_state := jsonb_set(v_state, '{workouts}', public.only_objects(v_state -> 'workouts'));
  end if;
  if jsonb_typeof(v_state -> 'routines') = 'array' then
    v_state := jsonb_set(v_state, '{routines}', public.only_objects(v_state -> 'routines'));
  end if;

  if v_has and coalesce((v_cur.data ->> 'resetAt')::numeric, 0) > coalesce((v_state ->> 'resetAt')::numeric, 0) then
    v_state := jsonb_set(v_state, '{resetAt}', v_cur.data -> 'resetAt');
    if jsonb_typeof(v_cur.data -> 'resetIds') = 'object' then
      v_state := jsonb_set(v_state, '{resetIds}', v_cur.data -> 'resetIds');
    else
      v_state := v_state - 'resetIds';
    end if;
  end if;

  v_state := jsonb_set(v_state, '{_rev}', to_jsonb(v_cur_rev + 1));

  insert into public.app_state (user_id, data, rev, updated_at)
  values (v_uid, v_state, v_cur_rev + 1, now())
  on conflict (user_id) do update
    set data = excluded.data, rev = excluded.rev, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'rev', v_cur_rev + 1, 'ts', v_state -> '_ts');
end $$;

revoke all on function public.push_state(jsonb, integer) from public, anon;
grant execute on function public.push_state(jsonb, integer) to authenticated;

-- Activity events (contract with gamification) -------------------------------------------------

create table public.event_kinds (
  pillar public.pillar not null,
  kind   text not null,
  primary key (pillar, kind)
);
insert into public.event_kinds (pillar, kind) values
  ('strength', 'workout_completed'),
  ('strength', 'pr'),
  ('strength', 'weight_logged');
alter table public.event_kinds enable row level security;
create policy event_kinds_select on public.event_kinds for select to authenticated using (true);
grant select on public.event_kinds to authenticated;

create table public.activity_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  pillar      public.pillar not null,
  kind        text not null,
  occurred_on date not null,
  payload     jsonb not null default '{}',
  source_ref  text not null check (char_length(source_ref) between 1 and 200),
  created_at  timestamptz not null default now(),
  unique (user_id, kind, source_ref)
);
create index activity_events_user_day on public.activity_events (user_id, occurred_on);

create or replace function public.validate_activity_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_today date;
begin
  if not exists (select 1 from public.event_kinds where pillar = new.pillar and kind = new.kind) then
    raise exception 'unknown_kind' using errcode = '22023';
  end if;
  if octet_length(new.payload::text) > 4096 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;
  select timezone into v_tz from public.profiles where id = new.user_id;
  v_today := (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date;
  if new.occurred_on > v_today or new.occurred_on < v_today - 14 then
    raise exception 'out_of_window' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger activity_events_validate before insert on public.activity_events
  for each row execute function public.validate_activity_event();

alter table public.activity_events enable row level security;
create policy activity_events_select_own on public.activity_events for select to authenticated using (user_id = auth.uid());
create policy activity_events_insert_own on public.activity_events for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.activity_events to authenticated;
