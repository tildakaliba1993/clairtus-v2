import type { SqlExecutor } from '@clairtus/tenancy';

/** DI token for the database executor (pglite in tests, Postgres adapter in prod). */
export const SQL = 'SQL_EXECUTOR';

/** DI token for the LIVE payout rail (a PaymentRail, or null when payouts only post to the ledger). */
export const RAIL = 'PAYMENT_RAIL';

/** DI token for the sandbox rail used by test-mode keys (deterministic, no network). */
export const SIMULATED_RAIL = 'SIMULATED_RAIL';

/** DI token for the per-mode payout RailRouters (`{ live, sandbox }`) — breaker + failover in the money path. */
export const PAYOUT_ROUTERS = 'PAYOUT_ROUTERS';

/** DI token for the durable JobQueue (retry + DLQ) backing async payout dispatch. */
export const JOB_QUEUE = 'JOB_QUEUE';

/** DI token for the fetch implementation used to deliver outbound webhooks (overridable in tests). */
export const FETCH = 'FETCH_IMPL';

/** DI token for the KYC provider (a KycProvider, or null when KYC is not configured). */
export const KYC_PROVIDER = 'KYC_PROVIDER';
/** DI token for the URL Smile ID posts verification results to. */
export const KYC_CALLBACK_URL = 'KYC_CALLBACK_URL';
/** DI token: releases whose base amount exceeds this (minor units) require a VERIFIED seller. */
export const KYC_RELEASE_THRESHOLD = 'KYC_RELEASE_THRESHOLD';

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
