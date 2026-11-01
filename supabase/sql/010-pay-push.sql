-- iSpend
-- run by GitHub Actions on push
-- after an Apple Pay payment is saved, the site's own notification says so ("💳 נרשם ב-iSpend"),
-- sent in the background (the shortcut does not wait for it)
create or replace function public.add_pay(token text, amount text, merchant text default '', card text default '', payments text default '1')
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid; amt numeric; n int; m text; c text; recent int; pid text;
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
  pid := 'ap-' || (extract(epoch from clock_timestamp()) * 1000)::bigint;
  insert into public.tx (user_id, vals) values (uid, jsonb_build_array(
    to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD'), amt::text, m, c, 'לא מסווג', 'הוצאה', 'Apple Pay',
    pid, case when n > 1 then n::text else '' end));
  begin
    perform net.http_post(
      url := 'https://kgggpqoaporqkxcdngqn.supabase.co/functions/v1/ispend-push?paid=1',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnZ2dwcW9hcG9ycWt4Y2RuZ3FuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjY5MDIsImV4cCI6MjEwODAwMjkwMn0.5VIFb-E28SroABOSisX4CYR2COEO1Bcfj2K_yx-wzJQ'),
      body := jsonb_build_object('token', regexp_replace(token, '\s', '', 'g'), 'amount', amt::text, 'merchant', m, 'payments', n::text, 'id', pid));
  exception when others then null; -- the payment is saved either way
  end;
  return 'נרשם: ₪' || amt || ' ב' || m || case when n > 1 then ' ב-' || n || ' תשלומים' else '' end;
end $$;
revoke all on function public.add_pay(text, text, text, text, text) from public;
grant execute on function public.add_pay(text, text, text, text, text) to anon, authenticated;
