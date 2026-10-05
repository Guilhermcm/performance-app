-- Phase 1b: daily safety net for challenges. get_challenges and the rankings close due challenges
-- whenever someone opens them; this pays the +300 to people who stay away. It only does something
-- where pg_cron exists (Supabase, once the extension is enabled; see docs/SETUP.md §7). Elsewhere,
-- the PGlite tests included, it is a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Same job name again updates the schedule instead of adding a second job.
    execute $cron$ select cron.schedule('close-challenges', '15 6 * * *', 'select public.close_all_challenges()') $cron$;
  end if;
exception when others then
  raise notice 'close-challenges not scheduled: %', sqlerrm;
end $$;
