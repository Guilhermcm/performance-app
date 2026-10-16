-- Phase 4a: daily safety net for habits (spec 6.6). get_my_progress and get_habit_history already
-- close pending days and weeks whenever the app opens; this pays the days, the weekly streak and the
-- badges of people who stay away. Challenges need nothing here: close-challenges already waits for
-- challenge_grace and closes the participants' pending days. It only does something where pg_cron
-- exists (Supabase, once the extension is enabled; see docs/SETUP.md §7). Elsewhere, the PGlite
-- tests included, it is a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-habit-days', '50 6 * * *', 'select public.close_all_habit_days()') $cron$;
  end if;
exception when others then
  raise notice 'close-habit-days not scheduled: %', sqlerrm;
end $$;
