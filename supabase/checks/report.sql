select json_build_object(
  'policies', (select json_agg(json_build_object('t', tablename, 'p', policyname, 'cmd', cmd, 'roles', roles, 'q', qual, 'w', with_check)) from pg_policies where schemaname = 'public'),
  'rls', (select json_agg(json_build_object('t', relname, 'rls', relrowsecurity)) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
  'grants_anon', (select json_agg(distinct table_name || ':' || privilege_type) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
  'funcs', (select json_agg(json_build_object('f', p.proname, 'secdef', p.prosecdef, 'exec_anon', has_function_privilege('anon', p.oid, 'execute'))) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  'cache', (select json_agg(json_build_object('s', source, 'n', n)) from (select source, count(*) n from public.merchant_cache group by source) x),
  'pushsubs', (select count(*) from public.push_subs)
) as r;
