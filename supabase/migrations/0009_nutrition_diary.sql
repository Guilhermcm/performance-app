-- Phase 2a, diary: nutrition targets, food diary and saved foods.

-- Tables ----------------------------------------------------------------------------------------

create table public.nutrition_targets (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  valid_from date not null,
  kcal       integer not null check (kcal between 1000 and 6000),
  protein_g  integer not null check (protein_g between 20 and 400),
  carbs_g    integer not null check (carbs_g between 0 and 900),
  fat_g      integer not null check (fat_g between 20 and 300),
  mode       text not null check (mode in ('auto', 'manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, valid_from)
);

create table public.food_logs (
  id         uuid primary key,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  day        date not null,
  meal       text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name       text not null check (char_length(name) between 1 and 120),
  brand      text check (char_length(brand) <= 80),
  source     text not null check (source in ('taco', 'off', 'custom', 'quick', 'import')),
  source_id  text check (char_length(source_id) <= 64),
  grams      numeric(6,1) check (grams > 0 and grams <= 5000),
  kcal       numeric(6,1) not null check (kcal between 0 and 5000),
  protein_g  numeric(5,1) not null default 0 check (protein_g between 0 and 500),
  carbs_g    numeric(5,1) not null default 0 check (carbs_g between 0 and 500),
  fat_g      numeric(5,1) not null default 0 check (fat_g between 0 and 500),
  fiber_g    numeric(5,1) check (fiber_g between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_logs_user_day on public.food_logs (user_id, day);

create table public.user_foods (
  id            uuid primary key,
  user_id       uuid not null references auth.users on delete cascade default auth.uid(),
  source        text not null check (source in ('taco', 'off', 'custom')),
  source_id     text check (char_length(source_id) <= 64),
  barcode       text check (barcode ~ '^[0-9]{8,14}$'),
  favorite      boolean not null default false,
  name          text not null check (char_length(name) between 1 and 120),
  brand         text check (char_length(brand) <= 80),
  kcal_100g     numeric(6,1) not null check (kcal_100g between 0 and 900),
  protein_100g  numeric(5,1) not null default 0 check (protein_100g between 0 and 100),
  carbs_100g    numeric(5,1) not null default 0 check (carbs_100g between 0 and 100),
  fat_100g      numeric(5,1) not null default 0 check (fat_100g between 0 and 100),
  serving_g     numeric(6,1) check (serving_g > 0 and serving_g <= 2000),
  serving_label text check (char_length(serving_label) <= 40),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index user_foods_barcode on public.user_foods (user_id, barcode) where barcode is not null;

-- Access ----------------------------------------------------------------------------------------

alter table public.nutrition_targets enable row level security;
alter table public.food_logs enable row level security;
alter table public.user_foods enable row level security;

revoke all on public.nutrition_targets, public.food_logs, public.user_foods from anon;
revoke truncate on public.nutrition_targets, public.food_logs, public.user_foods from authenticated;
revoke delete on public.nutrition_targets from authenticated;

create policy nutrition_targets_select_own on public.nutrition_targets
  for select to authenticated using (user_id = auth.uid());
create policy nutrition_targets_insert_own on public.nutrition_targets
  for insert to authenticated with check (
    user_id = auth.uid()
    and (valid_from > public.local_today(auth.uid())
         or (valid_from = public.local_today(auth.uid())
             and not exists (select 1 from public.nutrition_targets t where t.user_id = auth.uid()))));
create policy nutrition_targets_update_own on public.nutrition_targets
  for update to authenticated
  using (user_id = auth.uid() and valid_from > public.local_today(auth.uid()))
  with check (user_id = auth.uid() and valid_from > public.local_today(auth.uid()));

create policy food_logs_select_own on public.food_logs
  for select to authenticated using (user_id = auth.uid());
create policy food_logs_insert_own on public.food_logs
  for insert to authenticated with check (user_id = auth.uid());
create policy food_logs_update_own on public.food_logs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy food_logs_delete_own on public.food_logs
  for delete to authenticated using (user_id = auth.uid());

create policy user_foods_select_own on public.user_foods
  for select to authenticated using (user_id = auth.uid());
create policy user_foods_insert_own on public.user_foods
  for insert to authenticated with check (user_id = auth.uid());
create policy user_foods_update_own on public.user_foods
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_foods_delete_own on public.user_foods
  for delete to authenticated using (user_id = auth.uid());

-- Guards ----------------------------------------------------------------------------------------
-- Security invoker: the rules apply only to client roles. Security definer functions and the
-- cascade from auth.users run as the owner and pass untouched.

create function public.food_logs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_uid   uuid := coalesce(new.user_id, old.user_id);
  v_today date;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  v_today := public.local_today(v_uid);
  if (tg_op <> 'DELETE' and new.day not in (v_today - 1, v_today))
     or (tg_op <> 'INSERT' and old.day not in (v_today - 1, v_today)) then
    raise exception 'day_closed' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;

  if new.source = 'import' then
    raise exception 'import_forbidden' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.day <> old.day) then
    raise exception 'item_immutable' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' and (
      select count(*) from public.food_logs
       where user_id = new.user_id and day = new.day and id <> new.id) >= 200 then
    raise exception 'too_many_items' using errcode = 'P0001';
  end if;

  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

create trigger food_logs_guard before insert or update or delete on public.food_logs
  for each row execute function public.food_logs_guard();

create function public.user_foods_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' and (
      select count(*) from public.user_foods where user_id = new.user_id and id <> new.id) >= 500 then
    raise exception 'too_many_foods' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger user_foods_guard before insert on public.user_foods
  for each row execute function public.user_foods_guard();

-- The target in force on a day: the row with the greatest valid_from <= day.
create function public.target_on(p_user uuid, p_day date) returns public.nutrition_targets
language sql stable security definer set search_path = public as $$
  select t from public.nutrition_targets t
   where t.user_id = p_user and t.valid_from <= p_day
   order by t.valid_from desc limit 1
$$;

revoke all on function public.food_logs_guard(), public.user_foods_guard(),
  public.target_on(uuid, date) from public, anon, authenticated;

-- RLS policies and the invoker triggers run as the client and need today in the person's time
-- zone. local_today is security definer and reveals only a date, so clients may call it.
grant execute on function public.local_today(uuid) to authenticated;
