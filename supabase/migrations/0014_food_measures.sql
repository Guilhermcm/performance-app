-- Phase 2b, personal food measures ("concha" = 120 g of a given food).

create table public.food_measures (
  id         uuid primary key,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  food_key   text not null check (food_key ~ '^(taco|off|custom):[A-Za-z0-9-]{1,64}$'),
  label      text not null check (char_length(btrim(label)) between 1 and 30),
  grams      numeric(6,1) not null check (grams >= 1 and grams <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_measures_user_food on public.food_measures (user_id, food_key);

alter table public.food_measures enable row level security;

revoke all on public.food_measures from anon;
revoke truncate on public.food_measures from authenticated;

create policy food_measures_select_own on public.food_measures
  for select to authenticated using (user_id = auth.uid());
create policy food_measures_insert_own on public.food_measures
  for insert to authenticated with check (user_id = auth.uid());
create policy food_measures_update_own on public.food_measures
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy food_measures_delete_own on public.food_measures
  for delete to authenticated using (user_id = auth.uid());

-- Security invoker: limits apply to client roles only; the cascade from auth.users and security
-- definer functions run as the owner and pass untouched. Counts skip the incoming id so an upsert
-- of an existing measure on a full set still passes.
create function public.food_measures_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if (select count(*) from public.food_measures
         where user_id = new.user_id and food_key = new.food_key and id <> new.id) >= 10
       or (select count(*) from public.food_measures
            where user_id = new.user_id and id <> new.id) >= 500 then
      raise exception 'too_many_measures' using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

create trigger food_measures_guard before insert or update on public.food_measures
  for each row execute function public.food_measures_guard();

revoke all on function public.food_measures_guard() from public, anon, authenticated;
