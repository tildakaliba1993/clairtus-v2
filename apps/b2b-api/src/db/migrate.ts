import type { SqlExecutor } from '@clairtus/tenancy';
import { JOB_QUEUE_SCHEMA } from '@clairtus/queue';
import { applyAllSchema } from './schema';

/**
 * Apply the full schema to a database. Everything is `create table if not exists` + idempotent
 * RLS policy (re)creation, so this is safe to run repeatedly (it doubles as the v1 migration).
 * IMPORTANT: run this as the same DB role the API uses (the table OWNER) — see tenantRlsSql.
 */
export async function migrate(sql: SqlExecutor): Promise<void> {
  await applyAllSchema(sql); // tenancy + ledger + idempotency + domain + webhooks + kyc + RLS
  for (const stmt of JOB_QUEUE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql.query(stmt); // durable job queue (T5.2)
  }
}
