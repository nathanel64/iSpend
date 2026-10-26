-- iSpend: more hardening.

-- 1) Apple Pay shortcut: sane sizes, and at most 60 payments an hour per account (a leaked key can't flood an account)
create or replace function public.add_pay(token text, amount text, merchant text default '', card text default '', payments text default '1')
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid; amt numeric; n int; m text; c text; recent int;
begin
  if token is null or length(token) > 100 then return 'מפתח שגוי'; end if;
  select id into uid from public.profiles where pay_token = regexp_replace(token, '\s', '', 'g');
  if uid is null then return 'מפתח שגוי'; end if;
  select count(*) into recent from public.tx where user_id = uid and created_at > now() - interval '1 hour' and vals->>6 = 'Apple Pay';
  if recent >= 60 then return 'יותר מדי תשלומים בשעה האחרונה. נסו שוב מאוחר יותר.'; end if;
  begin
    amt := abs(nullif(regexp_replace(replace(left(coalesce(amount, ''), 40), ',', ''), '[^0-9.]', '', 'g'), '')::numeric);
  exception when others then amt := null;
  end;
  if amt is null or amt = 0 or amt > 1000000 then return 'סכום לא תקין'; end if;
  amt := round(amt, 2);
  n := greatest(1, least(36, coalesce(nullif(regexp_replace(left(coalesce(payments, '1'), 6), '\D', '', 'g'), '')::int, 1)));
  m := left(coalesce(nullif(trim(merchant), ''), 'ללא שם'), 120);
  c := left(coalesce(nullif(trim(card), ''), 'Apple Pay'), 60);
  insert into public.tx (user_id, vals) values (uid, jsonb_build_array(
    to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD'), amt::text, m, c, 'לא מסווג', 'הוצאה', 'Apple Pay',
    'ap-' || (extract(epoch from clock_timestamp()) * 1000)::bigint, case when n > 1 then n::text else '' end));
  return 'נרשם: ₪' || amt || ' ב' || m || case when n > 1 then ' ב-' || n || ' תשלומים' else '' end;
end $$;
revoke all on function public.add_pay(text, text, text, text, text) from public;
grant execute on function public.add_pay(text, text, text, text, text) to anon, authenticated;

-- 2) the Apple Pay key stays a long random code (a person can't change it to something easy to guess)
alter table public.profiles drop constraint if exists pay_token_strong;
alter table public.profiles add constraint pay_token_strong check (pay_token ~ '^[0-9a-f]{32,64}$') not valid;

-- 3) corrections to the shared business memory: one person's correction stays a vote;
--    it reaches everyone only when two different people agree on the same name and category
create table if not exists public.merchant_votes (
  raw_key text not null,
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  cat text,
  updated_at timestamptz not null default now(),
  primary key (raw_key, user_id)
);
alter table public.merchant_votes enable row level security;
revoke all on public.merchant_votes from anon, authenticated;
