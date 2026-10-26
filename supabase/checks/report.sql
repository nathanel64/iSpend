select source, count(*) as n, max(updated_at) as last,
  (array_agg(raw || ' = ' || coalesce(name, '') || ' / ' || coalesce(cat, '') order by updated_at desc))[1:8] as sample
from public.merchant_cache group by source;
