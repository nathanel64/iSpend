-- iSpend
-- run by GitHub Actions on push
-- a daily count of questions per person for the "ask" box (only the server writes it)
create table if not exists public.ask_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ask_usage enable row level security;
revoke all on public.ask_usage from anon, authenticated;
