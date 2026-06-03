import { TENANCY_SCHEMA, tenantRlsSql, type SqlExecutor } from '@clairtus/tenancy';
import { LEDGER_SCHEMA } from '@clairtus/ledger';
import { IDEMPOTENCY_SCHEMA } from './sql';

/**
 * Tenant-scoped business tables. Every row carries tenant_id and is locked down with the
 * shared RLS policy (defense in depth); the service layer also scopes every query by
 * tenant_id explicitly, which is what enforces isolation when the connection role bypasses
 * RLS (e.g. pglite's superuser in tests). RLS is the DB backstop for a restricted prod role.
 */
export const DOMAIN_SCHEMA = `
create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  role text not null,
  name text,
  phone text,
  account_ref text,
  bank_code text,
  created_at timestamptz not null default now()
);

create table if not exists escrows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  status text not null,
  base_amount bigint not null,
  currency text not null,
  fee_bps int not null,
  fee_responsibility text not null,
  buyer_party_id uuid,
  seller_party_id uuid not null,
  secondary_party_id uuid,
  secondary_amount bigint not null default 0,
  held_account_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  escrow_id uuid not null,
  recipient_party_id uuid not null,
  amount bigint not null,
  currency text not null,
  rail text,
  rail_ref text,
  status text not null,
  created_at timestamptz not null default now()
);
`;

/** Tenant-scoped tables that get the RLS isolation policy. */
export const RLS_TABLES = ['parties', 'escrows', 'payouts'] as const;

/**
 * Applies the full schema (tenancy + ledger + idempotency + domain + RLS). Used by tests;
 * production runs the equivalent versioned migrations under infra/.
 */
export async function applyAllSchema(sql: SqlExecutor): Promise<void> {
  const blocks = [TENANCY_SCHEMA, LEDGER_SCHEMA, IDEMPOTENCY_SCHEMA, DOMAIN_SCHEMA];
  for (const block of blocks) {
    for (const stmt of block.split(';').map((s) => s.trim()).filter(Boolean)) {
      await sql.query(stmt);
    }
  }
  for (const table of RLS_TABLES) {
    for (const stmt of tenantRlsSql(table).split(';').map((s) => s.trim()).filter(Boolean)) {
      await sql.query(stmt);
    }
  }
}
