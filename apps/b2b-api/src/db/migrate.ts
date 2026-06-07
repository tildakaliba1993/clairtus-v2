import type { SqlExecutor } from '@clairtus/tenancy';
import { runMigrations } from './migrations';

/**
 * Apply outstanding database migrations (run before the API serves money endpoints — Fly
 * release_command / CI deploy step). Forward-only and idempotent: each migration runs at most once,
 * tracked in `schema_migrations`. The v1 baseline is all `create … if not exists`, so this is safe on
 * both a fresh DB and the already-provisioned production DB.
 * IMPORTANT: run this as the same DB role the API uses (the table OWNER) — see tenantRlsSql.
 */
export async function migrate(sql: SqlExecutor): Promise<void> {
  await runMigrations(sql);
}
