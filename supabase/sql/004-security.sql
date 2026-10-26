-- iSpend: tighter database permissions. Row level security already keeps each person to their own rows;
-- this also removes table rights nobody needs, so nothing is reachable by mistake.

-- the public (not signed in) key never reads or writes tables directly; it only runs add_pay (the Apple Pay shortcut)
revoke all on public.tx, public.profiles, public.push_subs, public.push_keys, public.merchant_cache from anon;
-- signed-in people: only the everyday rights, on their own rows (RLS)
revoke truncate, references, trigger on public.tx, public.profiles, public.push_subs, public.merchant_cache from authenticated;
-- the server's push keys and the shared business memory are written only by the server functions
revoke all on public.push_keys from authenticated;
revoke insert, update, delete on public.merchant_cache from authenticated;
-- the sign-up trigger is not something to call from outside
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- how many new business names each person sent to the AI today (a daily cap keeps the free quota safe)
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
