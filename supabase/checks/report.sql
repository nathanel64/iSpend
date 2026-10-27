select json_build_object(
  'subs', (select json_agg(json_build_object('remind_at', remind_at, 'last_sent', last_sent, 'last_add', last_add, 'host', split_part(endpoint, '/', 3), 'created', created_at)) from public.push_subs),
  'tx_by_day', (select json_agg(json_build_object('d', d, 'n', n) order by d desc) from (select (created_at at time zone 'Asia/Jerusalem')::date d, count(*) n from public.tx where created_at > now() - interval '4 days' group by 1) x),
  'calls', (select json_agg(json_build_object('at', created, 'status', status_code, 'body', left(content, 80)) order by created desc) from (select created, status_code, content from net._http_response order by created desc limit 6) x),
  'oldest_call', (select min(created) from net._http_response)
) as r;
