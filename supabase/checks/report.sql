select json_build_object(
  'cron_has_secret', (select command like '%x-ispend-cron%' from cron.job where jobname = 'ispend-evening'),
  'secret_set', (select cron_secret is not null and length(cron_secret) > 40 from public.push_keys where id = 1),
  'endpoint_check', (select count(*) from pg_constraint where conname = 'push_endpoint_ok'),
  'recent_calls', (select json_agg(json_build_object('at', created, 'status', status_code) order by created desc) from (select created, status_code from net._http_response order by created desc limit 4) x),
  'pushsubs', (select count(*) from public.push_subs),
  'cache', (select json_agg(json_build_object('s', source, 'n', n)) from (select source, count(*) n from public.merchant_cache group by source) x)
) as r;
