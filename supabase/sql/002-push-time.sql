-- run by GitHub Actions on push
-- iSpend: a reminder time for each phone. Run once: SQL Editor -> New query -> paste -> Run.
alter table public.push_subs add column if not exists remind_at text not null default '21:00';
-- the server now looks every 15 minutes, so a time like 20:30 works too
select cron.unschedule('ispend-evening') where exists (select 1 from cron.job where jobname = 'ispend-evening');
select cron.schedule('ispend-evening', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://kgggpqoaporqkxcdngqn.supabase.co/functions/v1/ispend-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnZ2dwcW9hcG9ycWt4Y2RuZ3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjY5MDIsImV4cCI6MjEwODAwMjkwMn0.5VIFb-E28SroABOSisX4CYR2COEO1Bcfj2K_yx-wzJQ'),
    body := '{}'::jsonb);
$$);
