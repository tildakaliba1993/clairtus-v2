import { TENANCY_SCHEMA, tenantRlsSql, type SqlExecutor } from '@clairtus/tenancy';
import { LEDGER_SCHEMA } from '@clairtus/ledger';
import { JOB_QUEUE_SCHEMA } from '@clairtus/queue';
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
  kyc_status text not null default 'NONE',
  kyc_result_code text,
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

create table if not exists payins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  escrow_id uuid not null,
  rail text,
  rail_ref text,
  amount bigint not null,
  currency text not null,
  status text not null,
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

/** Domain events + outbound webhook delivery (signed, retried, replayable). */
export const WEBHOOK_SCHEMA = `
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  escrow_id uuid,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  url text not null,
  signing_secret text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  endpoint_id uuid not null,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists webhook_deliveries_due_idx on webhook_deliveries(status, next_retry_at);
`;

/** KYC verification checks (one per startVerification), tenant-scoped. */
export const KYC_SCHEMA = `
create table if not exists kyc_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  party_id uuid not null,
  provider text not null,
  status text not null default 'PENDING',
  result_code text,
  job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`;

/** Immutable record of every compliance decision (limits/KYC/structuring) — feeds the M5 audit log. */
export const COMPLIANCE_SCHEMA = `
create table if not exists compliance_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  escrow_id uuid,
  kind text not null,            -- 'create' | 'release'
  market text not null,          -- tenant country / market code
  currency text not null,
  amount_usd numeric not null,
  daily_used_usd numeric not null default 0,
  monthly_used_usd numeric not null default 0,
  structuring boolean not null default false,
  outcome text not null,         -- 'allow' | 'deny'
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists compliance_decisions_tenant_idx on compliance_decisions(tenant_id, created_at);
`;

/** Self-serve: maps an external auth user (e.g. a Supabase user id) to the tenant they provisioned. */
export const TENANT_USERS_SCHEMA = `
create table if not exists tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  auth_user_id text not null unique,
  email text,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);
create index if not exists tenant_users_tenant_idx on tenant_users(tenant_id);
`;

/** Immutable, append-only audit log of money operations + admin actions (architecture §14). */
export const AUDIT_SCHEMA = `
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  action text not null,          -- e.g. 'escrow.released' | 'payout.created' | 'apikey.issued'
  resource_type text not null,   -- 'escrow' | 'payout' | 'party' | 'apikey' | 'tenant'
  resource_id uuid,
  escrow_id uuid,
  actor text,                    -- key last4 / 'system' (best-effort)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_tenant_idx on audit_log(tenant_id, created_at);
create index if not exists audit_log_escrow_idx on audit_log(escrow_id);
`;

/** Tenant-scoped tables that get the RLS isolation policy. */
export const RLS_TABLES = ['parties', 'escrows', 'payins', 'payouts', 'events', 'webhook_endpoints', 'webhook_deliveries', 'kyc_checks', 'compliance_decisions', 'audit_log'] as const;

/**
 * Applies the full schema (tenancy + ledger + idempotency + domain + RLS). Used by tests;
 * production runs the equivalent versioned migrations under infra/.
 */
export async function applyAllSchema(sql: SqlExecutor): Promise<void> {
  const blocks = [TENANCY_SCHEMA, LEDGER_SCHEMA, IDEMPOTENCY_SCHEMA, JOB_QUEUE_SCHEMA, DOMAIN_SCHEMA, WEBHOOK_SCHEMA, KYC_SCHEMA, COMPLIANCE_SCHEMA, AUDIT_SCHEMA, TENANT_USERS_SCHEMA];
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
