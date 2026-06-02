/**
 * Double-entry ledger schema. Runs unchanged on pglite (tests) and Postgres
 * (Supabase, prod). Money is stored as bigint MINOR units. Entries are
 * append-only/immutable; balances are derived (never stored), so they cannot
 * drift and there is no update race.
 */
export const LEDGER_SCHEMA = `
create table if not exists ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  type text not null,
  owner_ref text,
  currency text not null,
  created_at timestamptz not null default now()
);

create table if not exists ledger_posting_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  reference text not null,
  escrow_id text,
  currency text not null,
  created_at timestamptz not null default now(),
  constraint ledger_posting_groups_ref_unique unique (tenant_id, reference)
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  posting_group_id uuid not null references ledger_posting_groups(id),
  account_id uuid not null references ledger_accounts(id),
  direction text not null check (direction in ('debit','credit')),
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_account_idx on ledger_entries(account_id);
`;
