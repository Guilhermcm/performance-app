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

-- XP per event (strength pillar) ------------------------------------------------------------------

create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_week   date := public.week_start_of(new.occurred_on);
  v_target smallint;
  v_count  integer;
begin
  -- One award at a time per user: the counts below decide the amount.
  perform pg_advisory_xact_lock(hashtextextended('xp:' || new.user_id::text, 0));
  if new.pillar <> 'strength' then return null; end if;

  if new.kind = 'workout_completed' then
    v_target := public.week_target_for(new.user_id, v_week);
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'workout';
    if v_count < v_target then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', public.session_xp(v_target, v_count + 1), 'workout', new.id, v_week);
      if v_count + 1 = v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150, 'week_target', new.id, v_week);
        -- A goal met in a week already judged (a session logged into the past) changes that
        -- week's verdict: replay the streak from the start.
        if exists (select 1 from public.streaks
                    where user_id = new.user_id and kind = 'training_week' and last_period >= v_week) then
          perform public.close_weeks(new.user_id, true);
        end if;
      end if;
    else
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'workout_extra';
      if v_count < 2 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 25, 'workout_extra', new.id, v_week);
      end if;
    end if;
  elsif new.kind = 'pr' then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'pr';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'pr', new.id, v_week);
    end if;
  elsif new.kind = 'weight_logged' then
    if not exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = new.user_id and l.reason = 'weight' and e.occurred_on = new.occurred_on
    ) then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 10, 'weight', new.id, v_week);
    end if;
  end if;
  perform public.evaluate_achievements(new.user_id);
  return null;
end $$;

create trigger activity_events_award after insert on public.activity_events
  for each row execute function public.award_xp();

revoke all on function public.award_xp() from public, anon, authenticated;

-- Weekly streak --------------------------------------------------------------------------------

-- Judges every closed week not judged yet: goal met → +1 (and a shield every 4, at most 2);
-- missed with a streak and a shield → the shield goes, the streak stays; otherwise → 0.
-- The week in progress is never judged. p_rebuild replays from the first week (best is kept).
create or replace function public.close_weeks(p_user uuid, p_rebuild boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_now  date := public.local_week_start(p_user);
  v_s    public.streaks%rowtype;
  v_week date;
begin
  if not exists (select 1 from public.profiles where id = p_user) then return; end if;
  insert into public.streaks (user_id, kind) values (p_user, 'training_week') on conflict do nothing;
  select * into v_s from public.streaks where user_id = p_user and kind = 'training_week' for update;
  if p_rebuild then
    v_s.current := 0;
    v_s.shields := 0;
    v_s.last_period := null;
  end if;

  if v_s.last_period is null then
    select least(
      (select public.week_start_of(min(occurred_on)) from public.activity_events where user_id = p_user),
      (select public.week_start_of((created_at at time zone timezone)::date) from public.profiles where id = p_user)
    ) into v_week;
  else
    v_week := v_s.last_period + 7;
  end if;

  while v_week is not null and v_week < v_now loop
    if exists (select 1 from public.xp_ledger
                where user_id = p_user and reason = 'week_target' and week_start = v_week) then
      v_s.current := v_s.current + 1;
      v_s.best := greatest(v_s.best, v_s.current);
      if v_s.current % 4 = 0 then v_s.shields := least(2, v_s.shields + 1); end if;
    elsif v_s.current > 0 and v_s.shields > 0 then
      v_s.shields := v_s.shields - 1;
    else
      v_s.current := 0;
    end if;
    v_s.last_period := v_week;
    v_week := v_week + 7;
  end loop;

  update public.streaks
     set current = v_s.current, best = v_s.best, shields = v_s.shields, last_period = v_s.last_period
   where user_id = p_user and kind = 'training_week';
end $$;

revoke all on function public.close_weeks(uuid, boolean) from public, anon, authenticated;

-- Achievements ----------------------------------------------------------------------------------

-- Mirrored by src/features/gamification/achievements.ts (gamification-catalog.test.ts compares
-- them). friends and challenges_won are never computed here: Phase 1b unlocks those badges with
-- award_achievement.
create table public.achievement_catalog (
  code      text primary key,
  metric    text not null check (metric in ('workouts', 'prs', 'week_targets', 'best_streak', 'weigh_in_run',
                                            'level', 'early_workouts', 'friends', 'challenges_won')),
  threshold integer not null check (threshold > 0),
  xp        integer not null check (xp >= 0),
  sort      smallint not null unique
);

insert into public.achievement_catalog (code, metric, threshold, xp, sort) values
  ('first_workout',   'workouts',        1,   50,  10),
  ('workouts_10',     'workouts',       10,  100,  20),
  ('workouts_50',     'workouts',       50,  200,  30),
  ('workouts_100',    'workouts',      100,  300,  40),
  ('workouts_250',    'workouts',      250,  500,  50),
  ('workouts_500',    'workouts',      500,  800,  60),
  ('first_pr',        'prs',             1,   50,  70),
  ('prs_10',          'prs',            10,  150,  80),
  ('prs_50',          'prs',            50,  400,  90),
  ('week_target_1',   'week_targets',    1,   75, 100),
  ('streak_4',        'best_streak',     4,  150, 110),
  ('streak_12',       'best_streak',    12,  400, 120),
  ('streak_26',       'best_streak',    26,  800, 130),
  ('streak_52',       'best_streak',    52, 1500, 140),
  ('weigh_in_7',      'weigh_in_run',    7,  100, 150),
  ('level_10',        'level',          10,    0, 160),
  ('level_25',        'level',          25,    0, 170),
  ('level_50',        'level',          50,    0, 180),
  ('first_friend',    'friends',         1,   50, 190),
  ('challenge_first', 'challenges_won',  1,  200, 200),
  ('challenge_won_5', 'challenges_won',  5,  500, 210),
  ('early_bird',      'early_workouts',  5,  100, 220);

create table public.user_achievements (
  user_id     uuid not null references auth.users on delete cascade,
  code        text not null references public.achievement_catalog,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

alter table public.achievement_catalog enable row level security;
alter table public.user_achievements enable row level security;
create policy achievement_catalog_select on public.achievement_catalog for select to authenticated using (true);
create policy user_achievements_select_own on public.user_achievements for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.achievement_catalog, public.user_achievements from anon, authenticated;
grant select on public.achievement_catalog, public.user_achievements to authenticated;

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events where user_id = p_user and kind = 'workout_completed'),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger where user_id = p_user and reason = 'week_target'),
    'best_streak', coalesce((select best from public.streaks where user_id = p_user and kind = 'training_week'), 0),
    -- Longest run of consecutive weigh-in days (gaps and islands).
    'weigh_in_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select d - (row_number() over (order by d))::int as grp
            from (select distinct occurred_on as d from public.activity_events
                   where user_id = p_user and kind = 'weight_logged') days
        ) runs group by grp
      ) lengths), 0),
    -- Live sessions only: the app sends the local start hour for those, never for backfills.
    'early_workouts', (select count(*) from public.activity_events
                        where user_id = p_user and kind = 'workout_completed'
                          and jsonb_typeof(payload -> 'hour') = 'number' and (payload ->> 'hour')::numeric < 7)
  )
$$;

-- Pure: which catalogue codes the stats reach that are not unlocked yet, in catalogue order.
-- Mirrored by evaluateAchievements in src/features/gamification/achievements.ts.
create or replace function public.achievements_for_stats(p_stats jsonb, p_unlocked text[]) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(code order by sort), '{}')
    from public.achievement_catalog
   where not (code = any (coalesce(p_unlocked, '{}')))
     and jsonb_typeof(p_stats -> metric) = 'number'
     and (p_stats ->> metric)::numeric >= threshold
$$;

-- General bonus (pillar null), paid once per (user, reason). Week: the user's current one unless given.
create or replace function public.award_bonus_xp(p_user uuid, p_amount integer, p_reason text, p_week date default null)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 5000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
  values (p_user, null, p_amount, p_reason, null, coalesce(p_week, public.local_week_start(p_user)))
  on conflict (user_id, reason) where event_id is null do nothing;
  return found;
end $$;

create or replace function public.award_achievement(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_xp integer;
begin
  select xp into v_xp from public.achievement_catalog where code = p_code;
  if not found then raise exception 'unknown_achievement' using errcode = '22023'; end if;
  insert into public.user_achievements (user_id, code) values (p_user, p_code) on conflict do nothing;
  if not found then return false; end if;
  if v_xp > 0 then perform public.award_bonus_xp(p_user, v_xp, 'achievement:' || p_code); end if;
  return true;
end $$;

create or replace function public.evaluate_achievements(p_user uuid) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_new   text[];
  v_more  text[];
  v_code  text;
  v_total bigint;
begin
  v_new := public.achievements_for_stats(public.achievement_stats(p_user),
             array(select code from public.user_achievements where user_id = p_user));
  foreach v_code in array v_new loop perform public.award_achievement(p_user, v_code); end loop;
  -- Level badges last: the XP of the badges above may be what reaches the level.
  select coalesce(sum(amount), 0) into v_total from public.xp_ledger where user_id = p_user;
  v_more := public.achievements_for_stats(
              jsonb_build_object('level', (select level from public.level_for(v_total))),
              array(select code from public.user_achievements where user_id = p_user));
  foreach v_code in array v_more loop perform public.award_achievement(p_user, v_code); end loop;
  return v_new || v_more;
end $$;

revoke all on function public.achievement_stats(uuid), public.award_bonus_xp(uuid, integer, text, date),
  public.award_achievement(uuid, text), public.evaluate_achievements(uuid) from public, anon, authenticated;

-- Progress ------------------------------------------------------------------------------------------

create or replace function public.total_xp(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.xp_ledger where user_id = p_user
$$;

create or replace function public.week_xp(p_user uuid, p_week date) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.xp_ledger where user_id = p_user and week_start = p_week
$$;

-- What anyone allowed to see this user may see: levels, XP, streak, badges. No weights, no stats.
-- Phase 1b shows it to friends; the caller checks the friendship.
create or replace function public.progress_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_week   date := public.local_week_start(p_user);
  v_total  bigint := public.total_xp(p_user);
  v_target smallint;
  v_streak public.streaks%rowtype;
  v_count  jsonb;
begin
  v_target := coalesce(
    (select target from public.weekly_targets where user_id = p_user and week_start = v_week),
    (select days_per_week from public.profiles where id = p_user), 3);
  select * into v_streak from public.streaks where user_id = p_user and kind = 'training_week';
  select jsonb_build_object(
           'workouts', count(*) filter (where reason = 'workout'),
           'extras', count(*) filter (where reason = 'workout_extra'),
           'prs', count(*) filter (where reason = 'pr'),
           'target_hit', count(*) filter (where reason = 'week_target') > 0)
    into v_count
    from public.xp_ledger where user_id = p_user and week_start = v_week;
  return jsonb_build_object(
    'total_xp', v_total,
    'level', public.level_json(v_total),
    'pillars', (
      select coalesce(jsonb_object_agg(p.name, public.level_json(p.xp) || jsonb_build_object('xp', p.xp)), '{}'::jsonb)
        from (select e::text as name,
                     coalesce((select sum(amount) from public.xp_ledger where user_id = p_user and pillar = e), 0)::bigint as xp
                from unnest(enum_range(null::public.pillar)) e) p
       where p.name = 'strength' or p.xp > 0),
    'week', jsonb_build_object('start', v_week, 'xp', public.week_xp(p_user, v_week), 'max', 960, 'target', v_target) || v_count,
    'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                 'shields', coalesce(v_streak.shields, 0)),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at) order by unlocked_at, code)
        from public.user_achievements where user_id = p_user), '[]'::jsonb)
  );
end $$;

create or replace function public.get_my_progress() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_today date;
  v_card  jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xp:' || v_uid::text, 0));
  v_today := public.local_today(v_uid);
  perform public.week_target_for(v_uid, public.week_start_of(v_today));
  perform public.close_weeks(v_uid);
  perform public.evaluate_achievements(v_uid);
  v_card := public.progress_card(v_uid);
  return v_card || jsonb_build_object(
    'today', v_today,
    'stats', public.achievement_stats(v_uid) || jsonb_build_object('level', (v_card -> 'level' ->> 'level')::int),
    'week', (v_card -> 'week') || jsonb_build_object('weighed_today', exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = v_uid and l.reason = 'weight' and e.occurred_on = v_today)));
end $$;

-- Daily safety net (0003 schedules it): freezes the new week's target, closes weeks and hands out
-- streak badges for people who did not open the app.
create or replace function public.close_all_weeks() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.profiles loop
    perform public.week_target_for(r.id, public.local_week_start(r.id));
    perform public.close_weeks(r.id);
    perform public.evaluate_achievements(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.total_xp(uuid), public.week_xp(uuid, date), public.progress_card(uuid),
  public.close_all_weeks() from public, anon, authenticated;
revoke all on function public.get_my_progress() from public, anon;
grant execute on function public.get_my_progress() to authenticated;
