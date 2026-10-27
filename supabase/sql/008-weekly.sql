-- iSpend
-- run by GitHub Actions on push
-- a short summary of last week, every Sunday morning, to phones that get reminders (each phone can turn it off)
alter table public.push_subs add column if not exists weekly boolean not null default true;
alter table public.push_subs add column if not exists week_stats jsonb;
alter table public.push_subs add column if not exists week_sent date;
