import postgres, { type Sql } from 'postgres';
import type { SqlExecutor } from '@clairtus/tenancy';

/**
 * Wraps a `postgres` (porsager) connection as our SqlExecutor. The same instance powers
 * tenancy, ledger, escrow, webhooks, KYC and the job queue. Transactions map to `sql.begin`.
 */
export function createPostgresExecutor(sql: Sql): SqlExecutor {
  const wrap = (q: Sql): SqlExecutor => ({
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const rows = (await q.unsafe(text, params as never[])) as unknown as T[];
      return { rows };
    },
    transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      return q.begin((tx) => fn(wrap(tx as unknown as Sql))) as Promise<T>;
    },
  });
  return wrap(sql);
}

export interface PostgresConnection {
  sql: Sql;
  executor: SqlExecutor;
  close: () => Promise<void>;
}

/**
 * Connect to Postgres (Supabase). Defaults are safe for the Supabase **transaction pooler**
 * (pgBouncer): `prepare: false`. For a direct/session connection set PG_PREPARE=true.
 * Pool size via PG_POOL_MAX (default 10).
 */
export function connectPostgres(url: string): PostgresConnection {
  const sql = postgres(url, {
    max: Number(process.env.PG_POOL_MAX ?? 10),
    prepare: process.env.PG_PREPARE === 'true',
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return { sql, executor: createPostgresExecutor(sql), close: () => sql.end({ timeout: 5 }) };
}
