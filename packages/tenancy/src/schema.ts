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
 * `force row level security` makes even the table owner subject to it (defense in depth);
 * the `nullif(..,'')` guard means "no tenant context" → zero rows (deny by default),
 * never a cast error. Reused by every tenant-scoped table (escrows, parties, …).
 */
export function tenantRlsSql(table: string, tenantColumn = 'tenant_id'): string {
  const policy = `${table}_tenant_isolation`;
  const match = `${tenantColumn} = nullif(current_setting('${TENANT_CONTEXT_VAR}', true), '')::uuid`;
  return `
    alter table ${table} enable row level security;
    alter table ${table} force row level security;
    drop policy if exists ${policy} on ${table};
    create policy ${policy} on ${table}
      using (${match})
      with check (${match});
  `;
}
