/**
 * Multi-tenancy schema. Runs unchanged on pglite (tests) and Postgres (Supabase, prod).
 *
 * `tenants` and `api_keys` are managed by the privileged service role (the API server),
 * so they are not themselves RLS-restricted — API-key authentication must look keys up
 * across tenants by hash. Tenant-scoped DATA tables (escrows, parties, payins, …) get
 * Row-Level Security via `tenantRlsSql()` below, enforcing invariant #4 at the database.
 */
export const TENANCY_SCHEMA = `
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mode text not null check (mode in ('test','live')),
  hash text not null,
  last4 text not null,
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_hash_idx on api_keys(hash);
`;

/** Session GUC that carries the authenticated tenant id into RLS policies. */
export const TENANT_CONTEXT_VAR = 'app.current_tenant';

/**
 * SQL that locks a tenant-scoped table down with Row-Level Security: a row is visible/
 * writable only when its tenant column equals the current `app.current_tenant` GUC.
 * The `nullif(..,'')` guard means "no tenant context" → zero rows (deny by default),
 * never a cast error. Reused by every tenant-scoped table (escrows, parties, …).
 *
 * NOTE on FORCE: we intentionally do NOT `force row level security`. The trusted API service
 * connects as the table OWNER (which bypasses RLS) and enforces tenant isolation in the service
 * layer (every query is scoped by tenant_id). RLS here is defense-in-depth for any OTHER role
 * (e.g. a direct Supabase `anon`/`authenticated` connection), which remains fully constrained.
 * Forcing RLS would also subject the service to it and — since the service sets no GUC — filter
 * out all rows. (Set `app.current_tenant` + use a non-owner role to opt a connection into RLS.)
 */
export function tenantRlsSql(table: string, tenantColumn = 'tenant_id'): string {
  const policy = `${table}_tenant_isolation`;
  const match = `${tenantColumn} = nullif(current_setting('${TENANT_CONTEXT_VAR}', true), '')::uuid`;
  return `
    alter table ${table} enable row level security;
    drop policy if exists ${policy} on ${table};
    create policy ${policy} on ${table}
      using (${match})
      with check (${match});
  `;
}
