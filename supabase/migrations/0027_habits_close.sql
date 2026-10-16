-- Phase 4a, day closing: day D closes at the start of D+2 local (spec 6.4), its valid checks are
-- marked (habit_checks.counted), its snapshot goes to habit_days and the server-only events it earns
-- pay habits XP through award_xp (spec 4, 5.1, 5.2, 6.3; plan decision 7).
-- Then the habits_week streak, the daily safety net and the private habit badges (spec 5.3, 5.4;
-- plan decisions 3, 4 and 20).

-- Closed days -----------------------------------------------------------------------------------
-- xp is what the day paid: its valid checks and the +30. The week bonus is the week's, not the day's.

create table public.habit_days (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null,
  checks     smallint not null,   -- checks made that day
  valid      smallint not null,   -- valid checks (spec 4)
  xp         integer not null,    -- XP paid for the day (valid checks and the +30)
  closed_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.habit_days enable row level security;
create policy habit_days_select_own on public.habit_days
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.habit_days from anon, authenticated;
revoke select on public.habit_days from anon;

-- Null until the day closes; then whether the check fit under its habit's target for the week.
-- Clients have no update on habit_checks, and habit_checks_guard (0026) clears it on their inserts.
alter table public.habit_checks add column counted boolean;

-- The closing reads a person's checks and targets by day and by week.
create index habit_checks_user_day on public.habit_checks (user_id, day);
create index habit_targets_user_week on public.habit_targets (user_id, week_start);

-- Q of a week: the sum of its frozen targets (spec 4).
create function public.habit_week_q(p_user uuid, p_week date) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(target), 0)::integer
    from public.habit_targets where user_id = p_user and week_start = p_week
$$;

-- Weekly streak (spec 5.3) ---------------------------------------------------------------------
-- In the mould of close_sleep_weeks (0022). A week is judged once its seven days have closed
-- (week_start + 6 <= local_today - 2, Tuesday morning) and closed days never reopen, so a verdict
-- is final and nothing is ever replayed. On target is the week's habit_week_target paid.
--   on target                              -> +1 (and a shield every 4, at most 2)
--   a day outside a period, missed         -> neutral: nothing changes (the activation week included)
--   Q = 0 (every habit archived), missed   -> neutral too
--   missed with a streak and shield        -> the shield goes, the streak stays
--   otherwise                              -> 0
-- The iron habit run needs no state: achievement_stats reads it from the targets and checks. It
-- ends looking at the badges, so every close does (spec 6.4).

create function public.close_habit_weeks(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_last   date;
  v_s      public.streaks%rowtype;
  v_week   date;
  v_judged integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  -- The last week whose seven days have all closed.
  v_last := public.local_today(p_user) - 8;
  insert into public.streaks (user_id, kind) values (p_user, 'habits_week') on conflict do nothing;
  select * into v_s from public.streaks where user_id = p_user and kind = 'habits_week' for update;

  if v_s.last_period is null then
    select public.week_start_of(min(started_on)) into v_week
      from public.habit_periods where user_id = p_user;
  else
    v_week := v_s.last_period + 7;
  end if;

  while v_week is not null and v_week <= v_last loop
    if exists (select 1 from public.xp_ledger
                where user_id = p_user and reason = 'habit_week_target' and week_start = v_week) then
      v_s.current := v_s.current + 1;
      v_s.best := greatest(v_s.best, v_s.current);
      if v_s.current % 4 = 0 then v_s.shields := least(2, v_s.shields + 1); end if;
    elsif exists (select 1 from generate_series(v_week, v_week + 6, interval '1 day') d
                   where not public.habits_active_on(p_user, d::date))
       or public.habit_week_q(p_user, v_week) = 0 then
      null;   -- neutral week
    elsif v_s.current > 0 and v_s.shields > 0 then
      v_s.shields := v_s.shields - 1;
    else
      v_s.current := 0;
    end if;
    v_s.last_period := v_week;
    v_week := v_week + 7;
    v_judged := v_judged + 1;
  end loop;

  if v_judged > 0 then
    update public.streaks
       set current = v_s.current, best = v_s.best, shields = v_s.shields, last_period = v_s.last_period
     where user_id = p_user and kind = 'habits_week';
  end if;
  perform public.evaluate_achievements(p_user);
end $$;

revoke all on function public.close_habit_weeks(uuid) from public, anon, authenticated;

-- Closing ---------------------------------------------------------------------------------------
-- In the mould of close_sleep_nights (0022). Every pending day from the day after the last closed
-- one (or the first period) up to local_today - 2, skipping days outside a period. For each day, in
-- order: the week's targets freeze if they have not yet; the day's checks that still fit under
-- their habit's target are marked counted; each valid check emits habit_check (by habits.sort, then
-- id), the day emits habit_day if it had one, and the week emits habit_week_target on the day C
-- reaches Q. Events are unique by source_ref, so a day never pays twice. Runs as the owner: the
-- server-only events pass RLS, and award_xp pays them.

create function public.close_habit_days(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_first date;
  v_last  date;
  v_day   date;
  v_week  date;
  v_q     integer;
  v_valid integer;
  r       record;
  n       integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  select min(started_on) into v_first from public.habit_periods where user_id = p_user;
  if v_first is null then return 0; end if;
  select greatest(v_first, max(day) + 1) into v_first from public.habit_days where user_id = p_user;
  v_last := public.local_today(p_user) - 2;

  for v_day in
    select d::date from generate_series(v_first, v_last, interval '1 day') d
     where not exists (select 1 from public.habit_days x where x.user_id = p_user and x.day = d::date)
     order by 1
  loop
    continue when not public.habits_active_on(p_user, v_day);
    v_week := public.week_start_of(v_day);
    perform public.freeze_habit_targets(p_user, v_week);

    -- One check per habit and day, so the days already closed in the week decide whether it fits.
    -- A habit without a target row that week has no room.
    update public.habit_checks c
       set counted = coalesce((select t.target from public.habit_targets t
                                where t.habit_id = c.habit_id and t.week_start = v_week), 0)
                   > (select count(*) from public.habit_checks p
                       where p.habit_id = c.habit_id and p.day >= v_week and p.day < v_day and p.counted)
     where c.user_id = p_user and c.day = v_day;

    v_valid := 0;
    for r in
      select c.habit_id from public.habit_checks c join public.habits h on h.id = c.habit_id
       where c.user_id = p_user and c.day = v_day and c.counted
       order by h.sort, h.id
    loop
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'habits', 'habit_check', v_day,
              'habit:' || r.habit_id::text || ':' || to_char(v_day, 'YYYY-MM-DD'))
      on conflict do nothing;
      v_valid := v_valid + 1;
    end loop;

    if v_valid > 0 then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'habits', 'habit_day', v_day, 'habits:' || to_char(v_day, 'YYYY-MM-DD'))
      on conflict do nothing;
    end if;

    v_q := public.habit_week_q(p_user, v_week);
    if v_q > 0 and (select count(*) from public.habit_checks
                     where user_id = p_user and day between v_week and v_day and counted) >= v_q then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'habits', 'habit_week_target', v_day, 'habits-week:' || to_char(v_week, 'YYYY-MM-DD'))
      on conflict do nothing;
    end if;

    insert into public.habit_days (user_id, day, checks, valid, xp)
    values (p_user, v_day,
            (select count(*) from public.habit_checks where user_id = p_user and day = v_day),
            v_valid,
            (select coalesce(sum(l.amount), 0)
               from public.xp_ledger l join public.activity_events e on e.id = l.event_id
              where e.user_id = p_user and e.pillar = 'habits' and e.kind in ('habit_check', 'habit_day')
                and e.occurred_on = v_day));
    n := n + 1;
  end loop;

  -- Even when no day closed: a week may be due, and the badges are looked at on every close.
  perform public.close_habit_weeks(p_user);
  return n;
end $$;

revoke all on function public.habit_week_q(uuid, date), public.close_habit_days(uuid)
  from public, anon, authenticated;

-- Daily safety net (0030 schedules it) ----------------------------------------------------------
-- In the mould of close_all_sleep_nights (0022). Visits everyone with an open period, or with a
-- closed period whose last week is not judged yet (its days may still be pending too, and that week
-- still has to be judged). Returns how many of them had days pending, so a second run the same day
-- returns 0.

create function public.close_all_habit_days() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct p.user_id from public.habit_periods p
      left join public.streaks s on s.user_id = p.user_id and s.kind = 'habits_week'
     where p.ended_on is null or p.ended_on >= coalesce(s.last_period + 7, p.started_on)
  loop
    if public.close_habit_days(r.user_id) > 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function public.close_all_habit_days() from public, anon, authenticated;

-- XP per event: the habits branch (spec 5.1, 5.2; plan decision 7) -----------------------------
-- 0022's body with the habits branch added, before Treino's. Habits has its own reasons, so nothing
-- of Treino, Nutrition or Sleep ever counts them. A valid check pays round(600 / P), P = max(Q, 7),
-- with Q read from habit_targets when it is paid; with Q >= 7 the Q-th pays what is left of 600. The
-- checks of a week never pay more than 600 together, even when Q changes mid-week, and an amount of
-- 0 writes no row. Weekly max 960.

create or replace function public.award_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_week   date := public.week_start_of(new.occurred_on);
  v_target smallint;
  v_count  integer;
  v_q      integer;
  v_paid   integer;
  v_amount integer;
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

  if new.pillar = 'sleep' then
    if new.kind = 'night_on_target' then
      v_target := public.week_target_for(new.user_id, v_week, 'sleep');
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'sleep_night';
      if v_count < v_target then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'sleep', public.session_xp(v_target, v_count + 1), 'sleep_night', new.id, v_week);
        if v_count + 1 = v_target then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'sleep', 150, 'sleep_week_target', new.id, v_week);
        end if;
      else
        select count(*) into v_count from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason = 'sleep_night_extra';
        if v_count < 2 then
          insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
          values (new.user_id, 'sleep', 25, 'sleep_night_extra', new.id, v_week);
        end if;
      end if;
    elsif new.kind = 'night_rested' then
      select count(*) into v_count from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'sleep_rested';
      if v_count < 3 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'sleep', 30, 'sleep_rested', new.id, v_week);
      end if;
    elsif new.kind = 'night_logged' then
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'sleep_logged' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'sleep', 10, 'sleep_logged', new.id, v_week);
      end if;
    end if;
    perform public.evaluate_achievements(new.user_id);
    return null;
  end if;

  if new.pillar = 'habits' then
    if new.kind = 'habit_check' then
      v_q := public.habit_week_q(new.user_id, v_week);
      -- This check's place among the week's valid checks (the closing emits them in order).
      select count(*) into v_count from public.activity_events
       where user_id = new.user_id and pillar = 'habits' and kind = 'habit_check'
         and occurred_on between v_week and v_week + 6;
      select coalesce(sum(amount), 0) into v_paid from public.xp_ledger
       where user_id = new.user_id and week_start = v_week and reason = 'habit_check';
      v_amount := case when v_q >= 7 and v_count = v_q then 600 - v_paid
                       else least(round(600.0 / greatest(v_q, 7))::integer, 600 - v_paid) end;
      if v_amount > 0 then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'habits', v_amount, 'habit_check', new.id, v_week);
      end if;
    elsif new.kind = 'habit_week_target' then
      v_q := public.habit_week_q(new.user_id, v_week);
      v_amount := case when v_q >= 7 then 150 else round(150.0 * v_q / 7)::integer end;
      if v_amount > 0 and not exists (
        select 1 from public.xp_ledger
         where user_id = new.user_id and week_start = v_week and reason = 'habit_week_target'
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'habits', v_amount, 'habit_week_target', new.id, v_week);
      end if;
    elsif new.kind = 'habit_day' then
      if not exists (
        select 1 from public.xp_ledger l join public.activity_events e on e.id = l.event_id
         where l.user_id = new.user_id and l.reason = 'habit_day' and e.occurred_on = new.occurred_on
      ) then
        insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
        values (new.user_id, 'habits', 30, 'habit_day', new.id, v_week);
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
  elsif new.kind = 'pr' and new.occurred_on < public.training_checkin_since() then
    select count(*) into v_count from public.xp_ledger
     where user_id = new.user_id and week_start = v_week and reason = 'pr';
    if v_count < 3 then
      insert into public.xp_ledger (user_id, pillar, amount, reason, event_id, week_start)
      values (new.user_id, 'strength', 30, 'pr', new.id, v_week);
    end if;
  elsif new.kind = 'weight_logged' and new.occurred_on < public.training_checkin_since() then
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

-- Badges (spec 5.4; plan decisions 3 and 20) ----------------------------------------------------
-- All private: never shown to friends. Mirrored by src/features/gamification/achievements.ts
-- (gamification-catalog.test.ts). The metric check is 0022's with the four habits metrics.

alter table public.achievement_catalog drop constraint achievement_catalog_metric_check;
alter table public.achievement_catalog add constraint achievement_catalog_metric_check check (metric in (
  'workouts', 'prs', 'week_targets', 'best_streak', 'weigh_in_run', 'level', 'early_workouts', 'friends',
  'challenges_won', 'nutrition_logged_days', 'nutrition_on_target_days', 'nutrition_week_targets',
  'nutrition_best_streak', 'protein_best_run', 'sleep_logged_nights', 'sleep_on_target_nights',
  'sleep_week_targets', 'sleep_best_streak', 'sleep_clock_best_run', 'habits_checks', 'habits_week_targets',
  'habits_best_streak', 'habits_iron_best_run'));

insert into public.achievement_catalog (code, metric, threshold, xp, sort, private) values
  ('habits_first_check',   'habits_checks',           1,   50, 500, true),
  ('habits_checks_50',     'habits_checks',          50,  100, 510, true),
  ('habits_checks_200',    'habits_checks',         200,  200, 520, true),
  ('habits_checks_500',    'habits_checks',         500,  300, 530, true),
  ('habits_checks_1000',   'habits_checks',        1000,  500, 540, true),
  ('habits_week_target_1', 'habits_week_targets',     1,   75, 550, true),
  ('habits_streak_4',      'habits_best_streak',      4,  150, 560, true),
  ('habits_streak_12',     'habits_best_streak',     12,  400, 570, true),
  ('habits_streak_26',     'habits_best_streak',     26,  800, 580, true),
  ('habits_iron_8',        'habits_iron_best_run',    8,  200, 590, true);

-- Achievement metrics ---------------------------------------------------------------------------
-- 0022's, with the habits ones. They read only closed days (counted is null until then), the
-- ledger, the streak and the frozen targets.

create or replace function public.achievement_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workouts', (select count(*) from public.activity_events e
                  where e.user_id = p_user and e.kind = 'workout_completed'
                    and e.occurred_on < public.training_checkin_since()
                    and not exists (select 1 from public.training_days t
                                     where t.user_id = p_user and t.day = e.occurred_on
                                       and t.checked and not t.legacy))
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
      ) lengths), 0),
    'sleep_logged_nights', (select count(*) from public.sleep_nights where user_id = p_user and logged),
    'sleep_on_target_nights', (select count(*) from public.sleep_nights where user_id = p_user and on_target),
    'sleep_week_targets', (select count(*) from public.xp_ledger
                            where user_id = p_user and reason = 'sleep_week_target'),
    'sleep_best_streak', coalesce((select best from public.streaks
                                    where user_id = p_user and kind = 'sleep_week'), 0),
    -- Longest run of consecutive closed nights, all logged, in bed within 30 minutes of the target.
    -- A night without a log, without a target or outside a period breaks it.
    'sleep_clock_best_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select night - (row_number() over (order by night))::int as grp
            from public.sleep_nights
           where user_id = p_user and logged and bed_diff_min <= 30
        ) runs group by grp
      ) lengths), 0),
    'habits_checks', (select count(*) from public.habit_checks where user_id = p_user and counted),
    'habits_week_targets', (select count(*) from public.xp_ledger
                             where user_id = p_user and reason = 'habit_week_target'),
    'habits_best_streak', coalesce((select best from public.streaks
                                     where user_id = p_user and kind = 'habits_week'), 0),
    -- Longest run of consecutive judged weeks in which one same habit met its own target (> 0).
    -- A week without a target row (the habit did not exist or was archived) breaks it; the week it
    -- was archived counts if the lowered target was met (plan decision 4).
    'habits_iron_best_run', coalesce((
      select max(n) from (
        select count(*) as n from (
          select t.habit_id,
                 t.week_start - 7 * (row_number() over (partition by t.habit_id order by t.week_start))::int as grp
            from public.habit_targets t
           where t.user_id = p_user and t.target > 0
             and t.week_start <= public.local_today(p_user) - 8
             and (select count(*) from public.habit_checks c
                   where c.habit_id = t.habit_id and c.day between t.week_start and t.week_start + 6
                     and c.counted) >= t.target
        ) runs group by habit_id, grp
      ) lengths), 0)
  )
$$;

revoke all on function public.achievement_stats(uuid) from public, anon, authenticated;
