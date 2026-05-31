-- Live USD→CDF exchange rate cache.
-- Written by the `fx-rate-updater` edge function (daily cron); read by the state
-- machine on every transaction to convert the BCC limits between USD and CDF.
-- Single-row table (id is always 1) so reads are a trivial primary-key lookup.

create table if not exists public.fx_rates (
    id          integer primary key default 1,
    usd_cdf     numeric  not null,
    source      text,
    updated_at  timestamptz not null default now(),
    constraint fx_rates_single_row check (id = 1)
);

-- Seed with a sane starting value so the cache is never empty before the first cron run.
-- (The updater overwrites this within 24h; the state machine also has a code-level fallback.)
insert into public.fx_rates (id, usd_cdf, source)
values (1, 2830, 'seed')
on conflict (id) do nothing;

-- RLS: only the service role (edge functions) touches this table; no public access.
alter table public.fx_rates enable row level security;
