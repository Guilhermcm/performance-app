-- Phase 1c, check-ins: the photo post of a workout, the posts a person hid from their feed, the
-- read-only app settings, and the private bucket that keeps the photos.

-- Tables ----------------------------------------------------------------------------------------

create table public.checkins (
  id           uuid primary key,                       -- made on the device
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  day          date not null,
  activity     text not null check (activity in
                 ('strength','run','bike','swim','walk','sport','class','other')),
  routine_id   text check (char_length(routine_id) <= 64),
  routine_name text check (char_length(routine_name) <= 60),
  title        text not null check (char_length(btrim(title)) between 1 and 60),
  caption      text check (char_length(caption) <= 500),
  note         text check (char_length(note) <= 500),  -- private: never leaves for another account
  duration_min smallint check (duration_min between 1 and 600),
  visibility   text not null check (visibility in ('friends','private')),
  photo_path   text not null check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|webp)$'),
  detail       jsonb check (detail is null or octet_length(detail::text) <= 16384),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- The photo lives in the owner's folder and is named after the check-in, so a path names one post.
  constraint checkins_photo_path_own check (photo_path in (
    user_id::text || '/' || id::text || '.jpg', user_id::text || '/' || id::text || '.webp'))
);
create index checkins_user_day on public.checkins (user_id, day);
create index checkins_feed on public.checkins (created_at desc, id);

create table public.hidden_checkins (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  checkin_id uuid not null references public.checkins on delete cascade,
  primary key (user_id, checkin_id)
);
create index hidden_checkins_checkin on public.hidden_checkins (checkin_id);

-- Settings the server writes and every signed-in client may read (the phase cutover date, ...).
create table public.app_settings (
  key   text primary key,
  value jsonb
);

-- Visibility ------------------------------------------------------------------------------------
-- Who may see a post: its owner, or a friend when the post is for friends. Unfriending cuts access
-- at once. The Storage policies run as the client and call these, hence the grant to authenticated.

create or replace function public.can_see_checkin(p_checkin uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.user_id = auth.uid()
        or (c.visibility = 'friends' and c.user_id in (select public.friend_ids(auth.uid())))
      from public.checkins c
     where c.id = p_checkin and auth.uid() is not null), false)
$$;

-- The same question for a Storage path. Only the exact <owner>/<checkin>.(jpg|webp) shape is read;
-- the check-in must exist with that id, that owner and that very path. Anything else is false.
create or replace function public.can_see_checkin_path(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
  v_id    uuid;
begin
  v_parts := regexp_match(coalesce(p_path, ''),
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'
    || '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|webp)$');
  if v_parts is null then
    return false;
  end if;
  select c.id into v_id from public.checkins c
   where c.id = v_parts[2]::uuid and c.user_id = v_parts[1]::uuid and c.photo_path = p_path;
  if v_id is null then
    return false;
  end if;
  return public.can_see_checkin(v_id);
end $$;

revoke all on function public.can_see_checkin(uuid), public.can_see_checkin_path(text)
  from public, anon;
grant execute on function public.can_see_checkin(uuid), public.can_see_checkin_path(text)
  to authenticated;

-- Access ----------------------------------------------------------------------------------------

alter table public.checkins enable row level security;
alter table public.hidden_checkins enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.checkins, public.hidden_checkins, public.app_settings from anon;
revoke truncate on public.checkins from authenticated;
revoke update, truncate on public.hidden_checkins from authenticated;
revoke insert, update, delete, truncate on public.app_settings from authenticated;

-- Friends read posts only through security definer functions, never this table.
create policy checkins_select_own on public.checkins
  for select to authenticated using (user_id = auth.uid());
create policy checkins_insert_own on public.checkins
  for insert to authenticated with check (user_id = auth.uid());
create policy checkins_update_own on public.checkins
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy checkins_delete_own on public.checkins
  for delete to authenticated using (user_id = auth.uid());

create policy hidden_checkins_select_own on public.hidden_checkins
  for select to authenticated using (user_id = auth.uid());
create policy hidden_checkins_insert_own on public.hidden_checkins
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_checkin(checkin_id));
create policy hidden_checkins_delete_own on public.hidden_checkins
  for delete to authenticated using (user_id = auth.uid());

create policy app_settings_select on public.app_settings
  for select to authenticated using (true);

-- Guard -----------------------------------------------------------------------------------------
-- Security invoker: the rules apply only to client roles. Security definer functions and the
-- cascade from auth.users run as the owner and pass untouched. Deleting is allowed at any time.

create function public.checkins_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_today date;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_today := public.my_local_today();
    if new.day not in (v_today - 1, v_today) then
      raise exception 'day_closed' using errcode = 'P0001';
    end if;
    if (select count(*) from public.checkins
         where user_id = new.user_id and day = new.day and id <> new.id) >= 10 then
      raise exception 'too_many_checkins' using errcode = 'P0001';
    end if;
    -- A post made offline keeps its earlier time; none is dated in the future to stay on top.
    new.created_at := least(coalesce(new.created_at, now()), now());
  else
    if new.id <> old.id or new.user_id <> old.user_id or new.day <> old.day
       or new.activity <> old.activity or new.photo_path <> old.photo_path then
      raise exception 'item_immutable' using errcode = 'P0001';
    end if;
    new.created_at := old.created_at;
  end if;

  new.updated_at := least(new.updated_at, now());
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

create trigger checkins_guard before insert or update on public.checkins
  for each row execute function public.checkins_guard();

revoke all on function public.checkins_guard() from public, anon, authenticated;

-- Storage ---------------------------------------------------------------------------------------
-- Private bucket for the photos: JPEG or WebP up to 600 KB, read through signed links only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkins', 'checkins', false, 614400, array['image/jpeg', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists checkins_photos_insert_own on storage.objects;
drop policy if exists checkins_photos_delete_own on storage.objects;
drop policy if exists checkins_photos_select on storage.objects;

-- Upload only into the own folder, as <checkin_id>.jpg or .webp.
create policy checkins_photos_insert_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'checkins'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ ('^' || auth.uid()::text
                || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$'));

create policy checkins_photos_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'checkins' and (storage.foldername(name))[1] = auth.uid()::text);

-- The owner always reads their own folder (a photo sent before its post, or left behind by a failed
-- post, can still be removed); anyone else only the photo of a post they may see.
create policy checkins_photos_select on storage.objects
  for select to authenticated using (
    bucket_id = 'checkins'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.can_see_checkin_path(name)));
