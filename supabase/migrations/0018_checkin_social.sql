-- Phase 1c, the social side of check-ins: reactions, comments, the in-app notices they raise (plus
-- challenge invites), and get_checkin, the one way another account reads a post. The private note
-- and the workout detail never leave for another account.

-- Tables ----------------------------------------------------------------------------------------

create table public.checkin_reactions (
  checkin_id uuid not null references public.checkins on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  emoji      text not null check (octet_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (checkin_id, user_id, emoji)
);
create index checkin_reactions_user on public.checkin_reactions (user_id);

create table public.checkin_comments (
  id         bigint generated always as identity primary key,
  checkin_id uuid not null references public.checkins on delete cascade,
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index checkin_comments_checkin on public.checkin_comments (checkin_id, id);
create index checkin_comments_user on public.checkin_comments (user_id);

create table public.social_notices (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,   -- who receives it
  actor_id     uuid not null references auth.users on delete cascade,
  kind         text not null check (kind in ('reaction', 'comment', 'challenge_invite')),
  checkin_id   uuid references public.checkins on delete cascade,
  challenge_id uuid references public.challenges on delete cascade,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index social_notices_user on public.social_notices (user_id, id desc);
create index social_notices_unread on public.social_notices (user_id) where read_at is null;
create index social_notices_actor on public.social_notices (actor_id);
create index social_notices_checkin on public.social_notices (checkin_id);
create index social_notices_challenge on public.social_notices (challenge_id);

-- Access ----------------------------------------------------------------------------------------
-- Writes go in only on a post the person may see. Reading other people's reactions and comments is
-- done through get_checkin; the tables show a person only their own rows (and, for comments, the
-- ones on their own posts), which is what deleting needs.

alter table public.checkin_reactions enable row level security;
alter table public.checkin_comments enable row level security;
alter table public.social_notices enable row level security;

revoke all on public.checkin_reactions, public.checkin_comments, public.social_notices from anon;
revoke update, truncate on public.checkin_reactions, public.checkin_comments from authenticated;
revoke insert, update, delete, truncate on public.social_notices from authenticated;
grant update (read_at) on public.social_notices to authenticated;

create policy checkin_reactions_select_own on public.checkin_reactions
  for select to authenticated using (user_id = auth.uid());
create policy checkin_reactions_insert_visible on public.checkin_reactions
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_checkin(checkin_id));
create policy checkin_reactions_delete_own on public.checkin_reactions
  for delete to authenticated using (user_id = auth.uid());

create policy checkin_comments_select on public.checkin_comments
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.checkins c where c.id = checkin_id and c.user_id = auth.uid()));
create policy checkin_comments_insert_visible on public.checkin_comments
  for insert to authenticated with check (user_id = auth.uid() and public.can_see_checkin(checkin_id));
-- The author, or the owner of the post.
create policy checkin_comments_delete on public.checkin_comments
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.checkins c where c.id = checkin_id and c.user_id = auth.uid()));

create policy social_notices_select_own on public.social_notices
  for select to authenticated using (user_id = auth.uid());
create policy social_notices_update_own on public.social_notices
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Guards ----------------------------------------------------------------------------------------
-- Up to 10 different emojis per person on one post. The lock keeps two inserts at once from both
-- passing the count. The times are the server's, whatever a direct insert sends.

create function public.checkin_reactions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('checkin-react:' || new.checkin_id::text || ':' || new.user_id::text, 0));
  if (select count(*) from public.checkin_reactions
       where checkin_id = new.checkin_id and user_id = new.user_id and emoji <> new.emoji) >= 10 then
    raise exception 'too_many_reactions' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;

create trigger checkin_reactions_guard before insert on public.checkin_reactions
  for each row execute function public.checkin_reactions_guard();

create function public.checkin_comments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body := btrim(new.body);
  new.created_at := now();
  return new;
end $$;

create trigger checkin_comments_guard before insert on public.checkin_comments
  for each row execute function public.checkin_comments_guard();

-- Notices ---------------------------------------------------------------------------------------
-- One notice per reaction or comment that lands on someone else's post, and one per challenge
-- invite. Never for oneself. Removing the reaction or comment leaves the notice; deleting the post
-- or the challenge takes it away.

create function public.notify_checkin_social() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner from public.checkins where id = new.checkin_id;
  if v_owner is not null and v_owner <> new.user_id then
    insert into public.social_notices (user_id, actor_id, kind, checkin_id)
    values (v_owner, new.user_id,
            case when tg_table_name = 'checkin_reactions' then 'reaction' else 'comment' end,
            new.checkin_id);
  end if;
  return null;
end $$;

create trigger checkin_reactions_notify after insert on public.checkin_reactions
  for each row execute function public.notify_checkin_social();
create trigger checkin_comments_notify after insert on public.checkin_comments
  for each row execute function public.notify_checkin_social();

-- create_challenge adds the invited friends as members with invited_by set and joined_at null
-- (the creator joins at once, with no inviter). That pending row is the invite.
create function public.notify_challenge_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.joined_at is null and new.invited_by is not null and new.invited_by <> new.user_id then
    insert into public.social_notices (user_id, actor_id, kind, challenge_id)
    values (new.user_id, new.invited_by, 'challenge_invite', new.challenge_id);
  end if;
  return null;
end $$;

create trigger challenge_members_notify after insert on public.challenge_members
  for each row execute function public.notify_challenge_invite();

revoke all on function public.checkin_reactions_guard(), public.checkin_comments_guard(),
  public.notify_checkin_social(), public.notify_challenge_invite() from public, anon, authenticated;

-- RPCs ------------------------------------------------------------------------------------------
-- A post the caller may not see answers not_found, the same as one that does not exist.

create function public.react_checkin(p_id uuid, p_emoji text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_emoji is null or octet_length(p_emoji) not between 1 and 16 then
    raise exception 'invalid_emoji' using errcode = 'P0001';
  end if;
  if not coalesce(p_on, false) then
    -- Taking one's own reaction back works even after losing sight of the post.
    delete from public.checkin_reactions where checkin_id = p_id and user_id = v_me and emoji = p_emoji;
    return;
  end if;
  if not public.can_see_checkin(p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.checkin_reactions (checkin_id, user_id, emoji)
  values (p_id, v_me, p_emoji)
  on conflict do nothing;
end $$;

create function public.comment_checkin(p_id uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   bigint;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'invalid_comment' using errcode = 'P0001';
  end if;
  if not public.can_see_checkin(p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.checkin_comments (checkin_id, user_id, body)
  values (p_id, v_me, v_body)
  returning id into v_id;
  return v_id;
end $$;

-- The author or the owner of the post; for anyone else the comment does not exist.
create function public.delete_comment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  delete from public.checkin_comments m
   where m.id = p_id
     and (m.user_id = v_me
          or exists (select 1 from public.checkins c where c.id = m.checkin_id and c.user_id = v_me));
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end $$;

-- One post with its reactions (grouped by emoji, with who reacted) and comments (oldest first).
-- note and detail are added only when the caller owns the post.
create function public.get_checkin(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_c   public.checkins%rowtype;
  v_out jsonb;
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not public.can_see_checkin(p_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_c from public.checkins where id = p_id;

  v_out := jsonb_build_object(
    'id', v_c.id,
    'user', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
               from public.profiles p where p.id = v_c.user_id),
    'day', v_c.day,
    'activity', v_c.activity,
    'routine_name', v_c.routine_name,
    'title', v_c.title,
    'caption', v_c.caption,
    'duration_min', v_c.duration_min,
    'visibility', v_c.visibility,
    -- can_see_checkin passed, so the caller may see the photo.
    'photo_path', v_c.photo_path,
    'created_at', v_c.created_at,
    'reactions', coalesce((
      select jsonb_agg(jsonb_build_object('emoji', g.emoji, 'count', g.n, 'mine', g.mine, 'users', g.users)
                       order by g.n desc, g.first_at, g.emoji)
        from (select r.emoji, count(*)::int as n, bool_or(r.user_id = v_me) as mine,
                     min(r.created_at) as first_at,
                     jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url)
                               order by r.created_at, r.user_id) as users
                from public.checkin_reactions r
                join public.profiles p on p.id = r.user_id
               where r.checkin_id = p_id
               group by r.emoji) g), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'user', jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar_url', p.avatar_url),
               'body', m.body,
               'created_at', m.created_at,
               'can_delete', m.user_id = v_me or v_c.user_id = v_me)
             order by m.id)
        from public.checkin_comments m
        join public.profiles p on p.id = m.user_id
       where m.checkin_id = p_id), '[]'::jsonb));

  if v_c.user_id = v_me then
    v_out := v_out || jsonb_build_object('note', v_c.note, 'detail', v_c.detail);
  end if;
  return v_out;
end $$;

-- The caller's notices, newest first, and how many are unread in all.
create function public.get_notices(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'kind', n.kind,
               'actor', jsonb_build_object('id', a.id, 'name', a.display_name, 'avatar_url', a.avatar_url),
               'checkin_id', n.checkin_id,
               'checkin_title', c.title,
               'challenge_id', n.challenge_id,
               'challenge_title', h.title,
               'created_at', n.created_at,
               'read', n.read_at is not null)
             order by n.id desc)
        from (select * from public.social_notices
               where user_id = v_me
               order by id desc
               limit greatest(1, least(coalesce(p_limit, 30), 100))) n
        left join public.profiles a on a.id = n.actor_id
        left join public.checkins c on c.id = n.checkin_id
        left join public.challenges h on h.id = n.challenge_id), '[]'::jsonb),
    'unread', (select count(*)::int from public.social_notices where user_id = v_me and read_at is null));
end $$;

-- Marks the caller's notices up to an id (the newest one the list showed) as read.
create function public.mark_notices_read(p_upto bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  update public.social_notices
     set read_at = now()
   where user_id = v_me and id <= p_upto and read_at is null;
end $$;

revoke all on function public.react_checkin(uuid, text, boolean), public.comment_checkin(uuid, text),
  public.delete_comment(bigint), public.get_checkin(uuid), public.get_notices(int),
  public.mark_notices_read(bigint) from public, anon;
grant execute on function public.react_checkin(uuid, text, boolean), public.comment_checkin(uuid, text),
  public.delete_comment(bigint), public.get_checkin(uuid), public.get_notices(int),
  public.mark_notices_read(bigint) to authenticated;
