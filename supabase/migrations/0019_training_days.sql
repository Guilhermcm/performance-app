-- Phase 1c, training days: check-ins pay the strength pillar (shown as "Treino"). A day closes at
-- the start of D+2 local into training_days and its server-only events pay XP (spec 5.1, 5.2).
-- From the cutover date on (app_settings.training_checkin_since, written below), workout_completed
-- no longer pays a day; earlier days keep what they paid and count as legacy training days.
-- Bodies of award_xp (0010), close_weeks (0002), achievement_stats (0011), challenge_progress
-- (0015), progress_card, my_progress_extras and get_my_progress (0012) are copied with only the
-- training parts changed; no signature changes.

-- Cutover date (decision 4) -------------------------------------------------------------------------
-- The day this migration runs. Days before it are legacy: their workout_completed already paid.

insert into public.app_settings (key, value)
values ('training_checkin_since', to_jsonb(current_date))
on conflict (key) do nothing;

-- Without the setting every day is a check-in day.
create function public.training_checkin_since() returns date
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (value #>> '{}')::date from public.app_settings where key = 'training_checkin_since'),
    date '0001-01-01')
$$;

revoke all on function public.training_checkin_since() from public, anon, authenticated;

-- Closed days ---------------------------------------------------------------------------------------
--   checked   a check-in that day (a legacy day counts as one)
--   detailed  a check-in with workout detail (detail.entries not empty)
--   legacy    before the cutover with a workout_completed: counts for streak, challenges and
--             metrics, never pays training XP

create table public.training_days (
  user_id   uuid not null references auth.users on delete cascade,
  day       date not null,
  checked   boolean not null,
  detailed  boolean not null,
  legacy    boolean not null default false,
  closed_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.training_days enable row level security;
create policy training_days_select_own on public.training_days
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.training_days from anon, authenticated;
revoke select on public.training_days from anon;

insert into public.event_kinds (pillar, kind, server_only) values
  ('strength', 'training_day', true),
  ('strength', 'training_detailed', true);

-- Weekly streak --------------------------------------------------------------------------------------
-- 0002's, with two changes: a week counts when either target reason paid it, and from the cutover
-- week on a week is judged only once its seven days have closed (week_start + 6 <= local_today - 2).
-- Weeks before that are judged as soon as they end, as before: their workouts paid at once.

create or replace function public.close_weeks(p_user uuid, p_rebuild boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_now    date := public.local_week_start(p_user);
  v_closed date := public.local_today(p_user) - 8;
  v_cut    date := public.week_start_of(public.training_checkin_since());
  v_s      public.streaks%rowtype;
  v_week   date;
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

  while v_week is not null and v_week < v_now and (v_week < v_cut or v_week <= v_closed) loop
    if exists (select 1 from public.xp_ledger
                where user_id = p_user and reason in ('week_target', 'training_week_target')
                  and week_start = v_week) then
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

-- XP per event --------------------------------------------------------------------------------------
-- 0010's nutrition branch unchanged. Strength:
--   workout_completed  from the cutover on: no day XP (the check-in pays the day). Before it: the
--                      old branch, unless the day already closed paid by a check-in; a closed day
--                      it lands on becomes legacy.
--   training_day       10 (training_logged, once a day), then round(600/T) up to the T-th day
--                      (training_day, the T-th takes the rest) with +150 (training_week_target),
--                      or 25 (training_day_extra, 2 a week)
--   training_detailed  30, 3 a week
-- Days and extras count old and new reasons together, so a cutover week pays 600 + 150 once.

create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_week   date := public.week_start_of(new.occurred_on);
  v_target smallint;
  v_count  integer;
begin
  -- One award at a time per user: the counts below decide the amount.
  perform pg_advisory_xact_lock(hashtextextended('xp:' || new.user_id::text, 0));

  if new.pillar = 'nutrition' then
    if new.kind = 'day_on_target' then
      v_target := public.week_target_for(new.user_id, v_week, 'nutrition');
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'nutrition_day';
      if v_count < v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'nutrition', public.session_xp(v_target, v_count + 1), 'nutrition_day', new.id, v_week);
        if v_count + 1 = v_target then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'nutrition', 150, 'nutrition_week_target', new.id, v_week);
        end if;
      else
        select count(*) into v_count from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason = 'nutrition_day_extra';
        if v_count < 2 then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'nutrition', 25, 'nutrition_day_extra', new.id, v_week);
        end if;
      end if;
    elsif new.kind = 'macros_balanced' then
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'nutrition_balanced';
      if v_count < 3 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'nutrition', 30, 'nutrition_balanced', new.id, v_week);
      end if;
    elsif new.kind = 'day_logged' then
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'nutrition_logged' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'nutrition', 10, 'nutrition_logged', new.id, v_week);
      end if;
    end if;
    perform public.evaluate_achievements(new.user_id);
    return null;
  end if;

  if new.pillar <> 'strength' then return null; end if;

  if new.kind in ('workout_completed', 'training_day') then
    if new.kind = 'workout_completed' then
      -- From the cutover on, the day is paid by its check-in when it closes.
      if new.occurred_on >= public.training_checkin_since() then
        perform public.evaluate_achievements(new.user_id);
        return null;
      end if;
      -- A day before the cutover already paid by its check-in pays nothing again.
      if exists (select 1 from public.training_days
                  where user_id = new.user_id and day = new.occurred_on and checked and not legacy) then
        perform public.evaluate_achievements(new.user_id);
        return null;
      end if;
      update public.training_days set checked = true, legacy = true
       where user_id = new.user_id and day = new.occurred_on;
    else
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'training_logged' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 10, 'training_logged', new.id, v_week);
      end if;
    end if;

    v_target := public.week_target_for(new.user_id, v_week, 'strength');
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason in ('workout', 'training_day');
    if v_count < v_target then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', public.session_xp(v_target, v_count + 1),
              case when new.kind = 'training_day' then 'training_day' else 'workout' end, new.id, v_week);
      if v_count + 1 = v_target and not exists (
        select 1 from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason in ('week_target', 'training_week_target')
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 150,
                case when new.kind = 'training_day' then 'training_week_target' else 'week_target' end,
                new.id, v_week);
        -- A goal met in a week already judged changes that week's verdict: replay the streak.
        if exists (select 1 from public.streaks
                    where user_id = new.user_id and kind = 'training_week' and last_period >= v_week) then
          perform public.close_weeks(new.user_id, true);
        end if;
      end if;
    else
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason in ('workout_extra', 'training_day_extra');
      if v_count < 2 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'strength', 25,
                case when new.kind = 'training_day' then 'training_day_extra' else 'workout_extra' end,
                new.id, v_week);
      end if;
    end if;
  elsif new.kind = 'training_detailed' then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'training_detailed';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'training_detailed', new.id, v_week);
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

revoke all on function public.award_xp() from public, anon, authenticated;

-- Closing days ---------------------------------------------------------------------------------------
-- Every day without a row from the person's first check-in or legacy workout up to
-- local_today - 2, one row each (unchecked days included). Runs as the owner: the server-only
-- events pass RLS and the 14-day window, and award_xp pays them. Ends judging the streak weeks.

create function public.close_training_days(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cut      date;
  v_first    date;
  v_last     date;
  v_day      date;
  v_checked  boolean;
  v_detailed boolean;
  v_legacy   boolean;
  v_ref      text;
  n          integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  v_cut := public.training_checkin_since();
  v_last := public.local_today(p_user) - 2;
  select least(
    (select min(day) from public.checkins where user_id = p_user),
    (select min(occurred_on) from public.activity_events
      where user_id = p_user and kind = 'workout_completed' and occurred_on < v_cut)
  ) into v_first;
  if v_first is null or v_first > v_last then return 0; end if;

  for v_day in
    select d::date from generate_series(v_first, v_last, interval '1 day') d
     where not exists (select 1 from public.training_days x where x.user_id = p_user and x.day = d::date)
     order by 1
  loop
    select count(*) > 0,
           coalesce(bool_or(jsonb_typeof(detail -> 'entries') = 'array'
                            and jsonb_array_length(detail -> 'entries') > 0), false)
      into v_checked, v_detailed
      from public.checkins where user_id = p_user and day = v_day;
    v_legacy := v_day < v_cut and exists (
      select 1 from public.activity_events
       where user_id = p_user and kind = 'workout_completed' and occurred_on = v_day);

    insert into public.training_days (user_id, day, checked, detailed, legacy)
    values (p_user, v_day, v_checked or v_legacy, v_detailed, v_legacy);

    if v_checked and not v_legacy then
      v_ref := 'training:' || to_char(v_day, 'YYYY-MM-DD');
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'strength', 'training_day', v_day, v_ref) on conflict do nothing;
      if v_detailed then
        insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
        values (p_user, 'strength', 'training_detailed', v_day, v_ref) on conflict do nothing;
      end if;
    end if;
    n := n + 1;
  end loop;

  perform public.close_weeks(p_user);
  return n;
end $$;

revoke all on function public.close_training_days(uuid) from public, anon, authenticated;

-- Daily safety net (scheduled at the end) --------------------------------------------------------
-- Everyone with a check-in or a legacy workout on a due day that has no row yet. Returns how many
-- people it went through.

create function public.close_all_training_days() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cut date := public.training_checkin_since();
  r     record;
  n     integer := 0;
begin
  for r in
    select u.user_id from (
      select c.user_id, c.day from public.checkins c
      union
      select e.user_id, e.occurred_on from public.activity_events e
       where e.kind = 'workout_completed' and e.occurred_on < v_cut
    ) u
     where not exists (select 1 from public.training_days t where t.user_id = u.user_id and t.day = u.day)
     group by u.user_id
    having min(u.day) <= public.local_today(u.user_id) - 2
  loop
    perform public.close_training_days(r.user_id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.close_all_training_days() from public, anon, authenticated;

-- Achievement metrics ---------------------------------------------------------------------------------
-- 0011's, with workouts = workouts before the cutover (as before) + checked training days that are
-- not legacy; week_targets counts both target reasons.

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events
                  where user_id = p_user and kind = 'workout_completed'
                    and occurred_on < public.training_checkin_since())
              + (select count(*) from public.training_days where user_id = p_user and checked and not legacy),
    'prs', (select count(*) from public.activity_events where user_id = p_user and kind = 'pr'),
    'week_targets', (select count(*) from public.xp_ledger
                      where user_id = p_user and reason in ('week_target', 'training_week_target')),
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
                          and jsonb_typeof(payload -> 'hour') = 'number' and (payload ->> 'hour')::numeric < 7),
    'friends', (select count(*) from public.friendships where p_user in (user_a, user_b)),
    'challenges_won', (select count(*) from public.challenge_members where user_id = p_user and won),
    'nutrition_logged_days', (select count(*) from public.nutrition_days
                               where user_id = p_user and not imported and logged),
    'nutrition_on_target_days', (select count(*) from public.nutrition_days
                                  where user_id = p_user and not imported and on_target),
    'nutrition_week_targets', (select count(*) from public.xp_ledger
                                where user_id = p_user and reason = 'nutrition_week_target'),
    'nutrition_best_streak', coalesce((select best from public.streaks
                                        where user_id = p_user and kind = 'nutrition_week'), 0),
    -- Longest run of consecutive closed days with protein at or above the target in force.
    'protein_best_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select day - (row_number() over (order by day))::int as grp
            from public.nutrition_days
           where user_id = p_user and not imported
             and protein_g >= (target ->> 'protein_g')::numeric
        ) runs group by grp
      ) lengths), 0)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;

-- Challenges: weeks_on_target ---------------------------------------------------------------------
-- 0015's, with a week met by either target reason. workouts_count moves to training days in 0020.

create or replace function public.challenge_progress(p_challenge uuid, p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  c public.challenges%rowtype;
  v numeric;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then return null; end if;
  if c.template = 'workouts_count' then
    select count(*) into v from public.activity_events
     where user_id = p_user and kind = 'workout_completed' and occurred_on between c.starts_on and c.ends_on;
  elsif c.template = 'weeks_on_target' then
    select count(*) into v from public.xp_ledger
     where user_id = p_user and reason in ('week_target', 'training_week_target')
       and week_start between public.week_start_of(c.starts_on) and c.ends_on;
  elsif c.template = 'nutrition_days_on_target' then
    select count(*) into v from public.nutrition_days
     where user_id = p_user and on_target and not imported and day between c.starts_on and c.ends_on
       and public.nutrition_active_on(p_user, day);
  else
    select coalesce(sum(least(greatest((payload ->> 'vol')::numeric, 0), 100000)), 0) into v
      from public.activity_events
     where user_id = p_user and kind = 'workout_completed' and occurred_on between c.starts_on and c.ends_on
       and jsonb_typeof(payload -> 'vol') = 'number';
    v := round(v * (case when (select unit from public.profiles where id = p_user) = 'lb'
                         then 0.45359237 else 1 end) / 1000, 1);
  end if;
  return v;
end $$;

-- Public card -----------------------------------------------------------------------------------------
-- 0012's, with the week counting training days with the old sessions: workouts (days paid up to
-- T), extras and target_hit read both reasons. Only counts: nothing of a check-in leaves here.

create or replace function public.progress_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_week   date := public.local_week_start(p_user);
  v_total  bigint := public.total_xp(p_user);
  v_target smallint;
  v_streak public.streaks%rowtype;
  v_count  jsonb;
  v_split  jsonb;
begin
  v_target := coalesce(
    (select target from public.weekly_targets where user_id = p_user and pillar = 'strength' and week_start = v_week),
    (select days_per_week from public.profiles where id = p_user), 3);
  select * into v_streak from public.streaks where user_id = p_user and kind = 'training_week';
  select jsonb_build_object(
           'workouts', count(*) filter (where reason in ('workout', 'training_day')),
           'extras', count(*) filter (where reason in ('workout_extra', 'training_day_extra')),
           'prs', count(*) filter (where reason = 'pr'),
           'target_hit', count(*) filter (where reason in ('week_target', 'training_week_target')) > 0),
         jsonb_build_object(
           'strength', coalesce(sum(amount) filter (where pillar = 'strength'), 0),
           'nutrition', coalesce(sum(amount) filter (where pillar = 'nutrition'), 0),
           'bonus', coalesce(sum(amount) filter (where pillar is null), 0))
    into v_count, v_split
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
    'week', jsonb_build_object(
              'start', v_week, 'xp', public.week_xp(p_user, v_week),
              'max', 960 * (1 + public.nutrition_week_active(p_user, v_week)::int),
              'target', v_target, 'pillars', v_split) || v_count,
    'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                 'shields', coalesce(v_streak.shields, 0)),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', u.code, 'unlocked_at', u.unlocked_at) order by u.unlocked_at, u.code)
        from public.user_achievements u join public.achievement_catalog c on c.code = u.code
       where u.user_id = p_user and not c.private), '[]'::jsonb)
  );
end $$;

revoke all on function public.progress_card(uuid) from public, anon, authenticated;

-- The owner's extras ----------------------------------------------------------------------------------
-- 0012's, plus the training block once the person ever posted a check-in (for the "day
-- confirmed" celebration):
--   training.confirms_on  the day today closes (today + 2)
--   training.last_closed  the last closed day with a check-in that paid, whether it was detailed,
--                         and the XP its events paid

create or replace function public.my_progress_extras(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today  date := public.local_today(p_user);
  v_week   date := public.week_start_of(v_today);
  v_lw     date := public.week_start_of(v_today - 8);
  v_first  date;
  v_streak public.streaks%rowtype;
  v_day    public.nutrition_days%rowtype;
  v_tday   public.training_days%rowtype;
  v_nut    jsonb;
  v_train  jsonb;
begin
  select public.week_start_of(min(started_on)) into v_first
    from public.nutrition_periods where user_id = p_user;
  if v_first is not null then
    select * into v_streak from public.streaks where user_id = p_user and kind = 'nutrition_week';
    select * into v_day from public.nutrition_days
     where user_id = p_user and not imported order by day desc limit 1;
    v_nut := jsonb_build_object(
      'target', coalesce(
        (select target from public.weekly_targets where user_id = p_user and pillar = 'nutrition' and week_start = v_week),
        (select nutrition_days_per_week from public.profiles where id = p_user), 5),
      'on_target', (select count(*) from public.nutrition_days
                     where user_id = p_user and not imported and on_target and day between v_week and v_week + 6),
      'logged', (select count(*) from public.nutrition_days
                  where user_id = p_user and not imported and logged and day between v_week and v_week + 6),
      'streak', jsonb_build_object('current', coalesce(v_streak.current, 0), 'best', coalesce(v_streak.best, 0),
                                   'shields', coalesce(v_streak.shields, 0)),
      'confirms_on', v_today + 2,
      'last_closed', case when v_day.day is null then null else jsonb_build_object(
        'day', v_day.day, 'logged', v_day.logged, 'on_target', v_day.on_target, 'balanced', v_day.balanced,
        'xp', coalesce((
          select sum(l.amount) from public.xp_ledger l join public.activity_events e on e.id = l.event_id
           where l.user_id = p_user and e.user_id = p_user and e.pillar = 'nutrition'
             and e.occurred_on = v_day.day), 0)) end,
      'last_week', case when v_lw < v_first then null else jsonb_build_object(
        'start', v_lw,
        'target_hit', exists (select 1 from public.xp_ledger
                               where user_id = p_user and reason = 'nutrition_week_target' and week_start = v_lw)) end);
  end if;

  if exists (select 1 from public.checkins where user_id = p_user) then
    select * into v_tday from public.training_days
     where user_id = p_user and checked and not legacy order by day desc limit 1;
    v_train := jsonb_build_object(
      'confirms_on', v_today + 2,
      'last_closed', case when v_tday.day is null then null else jsonb_build_object(
        'day', v_tday.day, 'detailed', v_tday.detailed,
        'xp', coalesce((
          select sum(l.amount) from public.xp_ledger l join public.activity_events e on e.id = l.event_id
           where l.user_id = p_user and e.user_id = p_user
             and e.kind in ('training_day', 'training_detailed') and e.occurred_on = v_tday.day), 0)) end);
  end if;

  return jsonb_build_object(
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('code', code, 'unlocked_at', unlocked_at) order by unlocked_at, code)
        from public.user_achievements where user_id = p_user), '[]'::jsonb),
    'radar', jsonb_build_object(
      'strength', jsonb_build_object('current', public.pillar_consistency(p_user, 'strength', 0),
                                     'previous', public.pillar_consistency(p_user, 'strength', 1)),
      'nutrition', jsonb_build_object('current', public.pillar_consistency(p_user, 'nutrition', 0),
                                      'previous', public.pillar_consistency(p_user, 'nutrition', 1))))
    || case when v_nut is null then '{}'::jsonb else jsonb_build_object('nutrition', v_nut) end
    || case when v_train is null then '{}'::jsonb else jsonb_build_object('training', v_train) end;
end $$;

revoke all on function public.my_progress_extras(uuid) from public, anon, authenticated;

-- The owner's answer ----------------------------------------------------------------------------------
-- 0012's, closing pending training days (which judges the strength weeks) before the rest.

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
  perform public.week_target_for(v_uid, public.week_start_of(v_today), 'strength');
  perform public.week_target_for(v_uid, public.week_start_of(v_today), 'nutrition');
  perform public.close_training_days(v_uid);
  perform public.close_weeks(v_uid);
  perform public.close_nutrition_days(v_uid);
  perform public.evaluate_achievements(v_uid);
  v_card := public.progress_card(v_uid);
  return v_card || public.my_progress_extras(v_uid) || jsonb_build_object(
    'today', v_today,
    'stats', public.achievement_stats(v_uid) || jsonb_build_object('level', (v_card -> 'level' ->> 'level')::int),
    'week', (v_card -> 'week') || jsonb_build_object('weighed_today', exists (
      select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
       where l.user_id = v_uid and l.reason = 'weight' and e.occurred_on = v_today)));
end $$;

revoke all on function public.get_my_progress() from public, anon;
grant execute on function public.get_my_progress() to authenticated;

-- Daily safety net: pays the days, the weekly streak and the badges of people who stay away. Only
-- where pg_cron exists (Supabase, once enabled; docs/SETUP.md §7); elsewhere, PGlite included, a
-- no-op. Runs before close-weeks (06:00) so the weeks it judges see the closed days.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-training-days', '45 5 * * *', 'select public.close_all_training_days()') $cron$;
  end if;
exception when others then
  raise notice 'close-training-days not scheduled: %', sqlerrm;
end $$;
