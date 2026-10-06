-- Phase 2a, day closing: day D closes at the start of D+2 local (spec 4.2), its summary goes to
-- nutrition_days and the server-only events it earns pay nutrition XP through award_xp (spec 6.3).

-- Closed days ---------------------------------------------------------------------------------

create table public.nutrition_days (
  user_id    uuid not null references auth.users on delete cascade,
  day        date not null,
  kcal       numeric(9,1) not null,          -- 200 items x 5000 kcal fit
  protein_g  numeric(9,1) not null,
  carbs_g    numeric(9,1) not null,
  fat_g      numeric(9,1) not null,
  meals      smallint not null,              -- meals with at least one item
  target     jsonb,                          -- the target in force; null on an imported day without one
  logged     boolean not null,
  on_target  boolean not null,
  balanced   boolean not null,
  imported   boolean not null default false, -- 2b; never pays XP nor counts in metrics
  closed_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.nutrition_days enable row level security;
create policy nutrition_days_select_own on public.nutrition_days
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.nutrition_days from anon, authenticated;
revoke select on public.nutrition_days from anon;

-- Classification (spec 6.2) -------------------------------------------------------------------
-- Exact numeric arithmetic, so 90% and 110% of the target count and nothing past them does.

create function public.classify_nutrition_day(
  p_kcal numeric, p_protein numeric, p_carbs numeric, p_fat numeric, p_meals int, p_target jsonb
) returns jsonb
language plpgsql immutable security definer set search_path = public as $$
declare
  v_kcal    numeric := (p_target ->> 'kcal')::numeric;
  v_protein numeric := (p_target ->> 'protein_g')::numeric;
  v_carbs   numeric := (p_target ->> 'carbs_g')::numeric;
  v_fat     numeric := (p_target ->> 'fat_g')::numeric;
  v_logged  boolean;
  v_on      boolean;
  v_bal     boolean;
begin
  v_logged := coalesce(p_meals >= 2 and p_kcal >= v_kcal * 0.5, false);
  v_on := v_logged and coalesce(abs(p_kcal - v_kcal) <= v_kcal * 0.1 and p_protein >= v_protein, false);
  v_bal := v_on and coalesce(abs(p_carbs - v_carbs) <= v_carbs * 0.2
                             and abs(p_fat - v_fat) <= v_fat * 0.2, false);
  return jsonb_build_object('logged', v_logged, 'on_target', v_on, 'balanced', v_bal);
end $$;

-- Closing -------------------------------------------------------------------------------------
-- Every pending day from the first period up to local_today - 2. Days outside a period or without
-- a target in force are not judged and get no row. Runs as the owner: the server-only events pass
-- RLS and the 14-day window, and award_xp pays them.

create function public.close_nutrition_days(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_first  date;
  v_last   date;
  v_day    date;
  v_t      public.nutrition_targets;
  v_target jsonb;
  v_kcal   numeric;
  v_prot   numeric;
  v_carbs  numeric;
  v_fat    numeric;
  v_meals  integer;
  v_class  jsonb;
  v_ref    text;
  n        integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_user::text, 0));
  select min(started_on) into v_first from public.nutrition_periods where user_id = p_user;
  if v_first is null then return 0; end if;
  v_last := public.local_today(p_user) - 2;

  for v_day in
    select d::date from generate_series(v_first, v_last, interval '1 day') d
     where not exists (select 1 from public.nutrition_days x where x.user_id = p_user and x.day = d::date)
     order by 1
  loop
    continue when not public.nutrition_active_on(p_user, v_day);
    select * into v_t from public.target_on(p_user, v_day);
    continue when v_t.valid_from is null;
    v_target := jsonb_build_object('kcal', v_t.kcal, 'protein_g', v_t.protein_g,
                                   'carbs_g', v_t.carbs_g, 'fat_g', v_t.fat_g);

    select coalesce(sum(kcal), 0), coalesce(sum(protein_g), 0), coalesce(sum(carbs_g), 0),
           coalesce(sum(fat_g), 0), count(distinct meal)
      into v_kcal, v_prot, v_carbs, v_fat, v_meals
      from public.food_logs where user_id = p_user and day = v_day;
    v_class := public.classify_nutrition_day(v_kcal, v_prot, v_carbs, v_fat, v_meals, v_target);

    insert into public.nutrition_days
      (user_id, day, kcal, protein_g, carbs_g, fat_g, meals, target, logged, on_target, balanced)
    values (p_user, v_day, v_kcal, v_prot, v_carbs, v_fat, v_meals, v_target,
            (v_class ->> 'logged')::boolean, (v_class ->> 'on_target')::boolean,
            (v_class ->> 'balanced')::boolean);

    v_ref := 'nutrition:' || to_char(v_day, 'YYYY-MM-DD');
    if (v_class ->> 'logged')::boolean then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'nutrition', 'day_logged', v_day, v_ref) on conflict do nothing;
    end if;
    if (v_class ->> 'on_target')::boolean then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'nutrition', 'day_on_target', v_day, v_ref) on conflict do nothing;
    end if;
    if (v_class ->> 'balanced')::boolean then
      insert into public.activity_events (user_id, pillar, kind, occurred_on, source_ref)
      values (p_user, 'nutrition', 'macros_balanced', v_day, v_ref) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.classify_nutrition_day(numeric, numeric, numeric, numeric, int, jsonb),
  public.close_nutrition_days(uuid) from public, anon, authenticated;

-- XP per event: the nutrition branch (spec 6.3) ---------------------------------------------------
-- Copied from 0008_weekly_targets_pillar.sql; the strength branch is unchanged. Nutrition has its
-- own reasons so nothing of strength (training_week, week_targets, weeks_on_target, target_hit)
-- ever counts them.

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

  if new.kind = 'workout_completed' then
    v_target := public.week_target_for(new.user_id, v_week, 'strength');
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
