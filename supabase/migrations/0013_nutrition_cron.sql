-- Phase 2a: daily safety net for nutrition. get_my_progress and get_nutrition_days already close
-- pending days and weeks whenever the app opens; this pays the days, the weekly streak and the
-- badges of people who stay away. It only does something where pg_cron exists (Supabase, once the
-- extension is enabled; see docs/SETUP.md §7). Elsewhere, the PGlite tests included, it is a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-nutrition-days', '30 6 * * *', 'select public.close_all_nutrition_days()') $cron$;
  end if;
exception when others then
  raise notice 'close-nutrition-days not scheduled: %', sqlerrm;
end $$;
