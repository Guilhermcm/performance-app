-- Phase 2b, history calendar: get_nutrition_days (0011) also returns the XP each day earned and the
-- weekly goal of every week the range touches. Same signature, same privileges, same 62-day limit.
--
--   xp     per day: the nutrition ledger rows paid for that day's events (source_ref
--          'nutrition:<day>'), the +150 of the day that met the weekly goal included. Bonuses
--          without an event (achievements, challenges) belong to no day and are left out.
--   weeks  per Monday-start week touched by [p_from, p_to], whole weeks even when the range cuts
--          them: start, target (the value frozen for that week; failing that the next frozen one,
--          as week_target_for reads it, then the profile's), on_target (closed days on target in
--          the week) and target_hit (the weekly goal bonus was paid for it).
-- Reads only: unlike week_target_for it never freezes a week.

create or replace function public.get_nutrition_days(p_from date, p_to date) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_t   public.nutrition_targets;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'no_profile' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 62 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  perform public.close_nutrition_days(v_uid);
  select * into v_t from public.target_on(v_uid, public.local_today(v_uid));
  return jsonb_build_object(
    'target', case when v_t.valid_from is null then null else jsonb_build_object(
      'valid_from', v_t.valid_from, 'mode', v_t.mode, 'kcal', v_t.kcal, 'protein_g', v_t.protein_g,
      'carbs_g', v_t.carbs_g, 'fat_g', v_t.fat_g) end,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'kcal', d.kcal, 'protein_g', d.protein_g, 'carbs_g', d.carbs_g,
               'fat_g', d.fat_g, 'meals', d.meals, 'target', d.target, 'logged', d.logged,
               'on_target', d.on_target, 'balanced', d.balanced, 'imported', d.imported,
               'xp', coalesce((
                 select sum(l.amount)::int
                   from public.activity_events e
                   join public.xp_ledger l on l.event_id = e.id
                  where e.user_id = v_uid and e.pillar = 'nutrition'
                    and e.source_ref = 'nutrition:' || to_char(d.day, 'YYYY-MM-DD')
                    and l.user_id = v_uid and l.pillar = 'nutrition'), 0)) order by d.day)
        from public.nutrition_days d
       where d.user_id = v_uid and d.day between p_from and p_to), '[]'::jsonb),
    'weeks', (
      select jsonb_agg(jsonb_build_object(
               'start', w.start,
               'target', coalesce(
                 (select t.target from public.weekly_targets t
                   where t.user_id = v_uid and t.pillar = 'nutrition' and t.week_start >= w.start
                   order by t.week_start limit 1),
                 (select p.nutrition_days_per_week from public.profiles p where p.id = v_uid), 5),
               'on_target', (select count(*)::int from public.nutrition_days d
                              where d.user_id = v_uid and d.on_target and not d.imported
                                and d.day between w.start and w.start + 6),
               'target_hit', exists (select 1 from public.xp_ledger l
                                      where l.user_id = v_uid and l.reason = 'nutrition_week_target'
                                        and l.week_start = w.start)) order by w.start)
        from (select g::date as start
                from generate_series(public.week_start_of(p_from), public.week_start_of(p_to),
                                     interval '7 days') g) w));
end $$;

revoke all on function public.get_nutrition_days(date, date) from public, anon;
grant execute on function public.get_nutrition_days(date, date) to authenticated;
