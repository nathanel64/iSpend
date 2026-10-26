-- iSpend: a shared memory of business names. Each raw name from the card company is classified once
-- (by the AI, or by a person's own correction) and every account reuses the answer. Only names are stored, never amounts.
create table if not exists public.merchant_cache (
  raw_key text primary key,
  raw text not null,
  name text,
  cat text,
  source text not null default 'ai',
  updated_at timestamptz not null default now()
);
alter table public.merchant_cache enable row level security;
drop policy if exists "read merchant cache" on public.merchant_cache;
create policy "read merchant cache" on public.merchant_cache for select to authenticated using (true);
-- writes go only through the classify-merchant function
