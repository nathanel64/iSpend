-- iSpend
-- run by GitHub Actions on push
-- the reminder run can only be started by the database's own scheduler (a secret only the database knows),
-- and push subscriptions must point at a real push service.
alter table public.push_keys add column if not exists cron_secret text;
update public.push_keys set cron_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') where cron_secret is null;
select cron.unschedule('ispend-evening') where exists (select 1 from cron.job where jobname = 'ispend-evening');
select cron.schedule('ispend-evening', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://kgggpqoaporqkxcdngqn.supabase.co/functions/v1/ispend-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnZ2dwcW9hcG9ycWt4Y2RuZ3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjY5MDIsImV4cCI6MjEwODAwMjkwMn0.5VIFb-E28SroABOSisX4CYR2COEO1Bcfj2K_yx-wzJQ',
      'x-ispend-cron', (select cron_secret from public.push_keys where id = 1)),
    body := '{}'::jsonb);
$$);
alter table public.push_subs drop constraint if exists push_endpoint_ok;
alter table public.push_subs add constraint push_endpoint_ok check (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)/') not valid;
