-- Phase 4a, day closing: day D closes at the start of D+2 local (spec 6.4), its valid checks are
-- marked (habit_checks.counted), its snapshot goes to habit_days and the server-only events it earns
-- pay habits XP through award_xp (spec 4, 5.1, 5.2, 6.3; plan decision 7).

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
  return n;
end $$;

revoke all on function public.habit_week_q(uuid, date), public.close_habit_days(uuid)
  from public, anon, authenticated;

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
