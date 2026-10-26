-- iSpend: evening reminders. Run once: Supabase -> SQL Editor -> New query -> paste everything -> Run.

-- the phones that asked for a reminder
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  sub jsonb not null,
  last_add date,
  last_sent date,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own push" on public.push_subs;
create policy "own push" on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- the server's key pair (made by the function on first use; nobody else can read it)
create table if not exists public.push_keys (
  id int primary key,
  public_key text not null,
  private_key text not null
);
alter table public.push_keys enable row level security;

-- every hour the function is called; it sends only at 21:00 Israel time
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('ispend-evening') where exists (select 1 from cron.job where jobname = 'ispend-evening');
select cron.schedule('ispend-evening', '0 * * * *', $$
  select net.http_post(
    url := 'https://kgggpqoaporqkxcdngqn.supabase.co/functions/v1/ispend-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnZ2dwcW9hcG9ycWt4Y2RuZ3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjY5MDIsImV4cCI6MjEwODAwMjkwMn0.5VIFb-E28SroABOSisX4CYR2COEO1Bcfj2K_yx-wzJQ'),
    body := '{}'::jsonb);
$$);
