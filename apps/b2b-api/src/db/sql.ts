import type { SqlExecutor } from '@clairtus/tenancy';

/** DI token for the database executor (pglite in tests, Postgres adapter in prod). */
export const SQL = 'SQL_EXECUTOR';

export type { SqlExecutor };

/** Idempotency ledger: one row per (tenant, Idempotency-Key) — caches the response. */
export const IDEMPOTENCY_SCHEMA = `
create table if not exists idempotency_keys (
  tenant_id uuid not null,
  key text not null,
  request_hash text not null,
  response jsonb not null,
  status_code int not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
`;

/** Placeholder executor — overridden in tests (pglite) and by the Postgres adapter in prod. */
export const UNCONFIGURED_SQL: SqlExecutor = {
  query() {
    throw new Error('SQL executor not configured — provide a Postgres adapter or override in tests');
  },
  transaction() {
    throw new Error('SQL executor not configured');
  },
};
