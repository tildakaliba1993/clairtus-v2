import type { SqlExecutor } from '@clairtus/tenancy';
import { applyAllSchema } from './schema';

export interface Migration {
  /** Stable, ordered identifier (e.g. `0001_baseline`). Never rename or reorder once shipped. */
  id: string;
  /** Apply the migration. Runs inside a transaction together with its applied-marker. */
  up(sql: SqlExecutor): Promise<void>;
}

/** Ledger of which migrations have run (one row per applied id). */
const SCHEMA_MIGRATIONS = `
create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);
`;

/**
 * Ordered, forward-only migrations.
 *
 * `0001_baseline` is the full v1 schema. It is built entirely from `create … if not exists` (+
 * idempotent RLS), so it is a safe **no-op on the already-provisioned production DB** and a full build
 * on a fresh one — the first deploy after this change simply records it as applied. Evolve the schema
 * by appending new numbered migrations (`0002_…`) with `ALTER`/backfill statements; the runner applies
 * only those not yet recorded. Do not edit a migration once it has shipped.
 */
export const MIGRATIONS: Migration[] = [
  { id: '0001_baseline', up: (sql) => applyAllSchema(sql) },
];

/**
 * Apply every not-yet-recorded migration in order. Each migration and its applied-marker are written
 * in the same transaction, so a failure rolls back cleanly and is never half-recorded. Safe to run on
 * every deploy (already-applied migrations are skipped).
 */
export async function runMigrations(sql: SqlExecutor, migrations: Migration[] = MIGRATIONS): Promise<void> {
  for (const stmt of SCHEMA_MIGRATIONS.split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql.query(stmt);
  }
  const { rows } = await sql.query<{ id: string }>(`select id from schema_migrations`);
  const done = new Set(rows.map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await sql.transaction(async (tx) => {
      await m.up(tx);
      await tx.query(`insert into schema_migrations (id) values ($1)`, [m.id]);
    });
  }
}
