-- iSpend
-- run by GitHub Actions on push
-- "תנועה חדשה" notifications: at most 30 an hour per person (counted here, readable only by the server)
create table if not exists public.pay_push_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  hour text not null,
  n int not null default 0,
  primary key (user_id, hour)
);
alter table public.pay_push_usage enable row level security;
revoke all on public.pay_push_usage from anon, authenticated;
