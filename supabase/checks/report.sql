select json_build_object(
  'applepay_rows', (select json_agg(json_build_object('at', created_at, 'd', vals->>0, 'amt', vals->>1, 'm', left(vals->>2, 30))) from (select created_at, vals from public.tx where vals->>6 = 'Apple Pay' order by created_at desc limit 5) x),
  'tx_today', (select count(*) from public.tx where created_at > now() - interval '1 day'),
  'profiles', (select json_agg(json_build_object('has_token', pay_token is not null, 'sheet', (settings::text like '%exec%'))) from public.profiles)
) as r;
