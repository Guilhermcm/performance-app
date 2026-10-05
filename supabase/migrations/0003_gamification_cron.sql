-- Phase 1a: daily safety net for closing weeks. get_my_progress already closes them whenever the
-- app opens; this keeps streaks and badges current for people who stay away for days. It only does
-- something where pg_cron exists (Supabase, once the extension is enabled; see docs/SETUP.md §7).
-- Elsewhere, the PGlite tests included, it is a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-weeks', '0 6 * * *', 'select public.close_all_weeks()') $cron$;
  end if;
exception when others then
  raise notice 'close-weeks not scheduled: %', sqlerrm;
end $$;
