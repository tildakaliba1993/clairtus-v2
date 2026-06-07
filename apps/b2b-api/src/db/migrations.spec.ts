import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { SqlExecutor } from '@clairtus/tenancy';
import { runMigrations, MIGRATIONS, type Migration } from './migrations';
import { migrate } from './migrate';

function executor(db: PGlite): SqlExecutor {
  return {
    async query(sql, params) {
      const r = await db.query(sql, params as never);
      return { rows: r.rows as never[] };
    },
    async transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query(sql, params) {
            const r = await tx.query(sql, params as never);
            return { rows: r.rows as never[] };
          },
          transaction() { throw new Error('nested'); },
        }),
      ) as never;
    },
  };
}

let db: PGlite;
let sql: SqlExecutor;

beforeEach(() => {
  db = new PGlite();
  sql = executor(db);
});

const applied = async (): Promise<string[]> =>
  (await sql.query<{ id: string }>(`select id from schema_migrations order by id`)).rows.map((r) => r.id);
const tableExists = async (name: string): Promise<boolean> =>
  (await sql.query<{ t: string | null }>(`select to_regclass($1) as t`, [name])).rows[0]!.t !== null;

describe('versioned migrations (B1)', () => {
  it('runs the baseline on a fresh db and records it', async () => {
    await runMigrations(sql);
    expect(await applied()).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await applied()).toContain('0001_baseline');
    // Baseline built every layer: domain, ledger, queue, tenancy.
    expect(await tableExists('escrows')).toBe(true);
    expect(await tableExists('ledger_accounts')).toBe(true);
    expect(await tableExists('jobs')).toBe(true);
    expect(await tableExists('api_keys')).toBe(true);
  });

  it('is idempotent — re-running applies nothing new and does not error', async () => {
    await runMigrations(sql);
    const before = await applied();
    await runMigrations(sql); // simulates a redeploy against an already-migrated db
    expect(await applied()).toEqual(before);
  });

  it('runs only un-applied migrations, in order (forward-only)', async () => {
    const ran: string[] = [];
    const mk = (id: string): Migration => ({ id, async up() { ran.push(id); } });

    await runMigrations(sql, [mk('a'), mk('b')]);
    expect(ran).toEqual(['a', 'b']);
    expect(await applied()).toEqual(['a', 'b']);

    await runMigrations(sql, [mk('a'), mk('b'), mk('c')]);
    expect(ran).toEqual(['a', 'b', 'c']); // a/b skipped — only c ran the second time
    expect(await applied()).toEqual(['a', 'b', 'c']);
  });

  it('a failing migration rolls back atomically and is not recorded', async () => {
    const ran: string[] = [];
    const ok = (id: string): Migration => ({ id, async up(tx) { ran.push(id); await tx.query(`create table if not exists t_${id} (x int)`); } });
    const boom: Migration = { id: 'bad', async up(tx) { await tx.query(`create table t_bad (x int)`); throw new Error('boom'); } };

    await runMigrations(sql, [ok('first')]);
    await expect(runMigrations(sql, [ok('first'), boom])).rejects.toThrow('boom');
    expect(await applied()).toEqual(['first']); // 'bad' not recorded
    expect(await tableExists('t_bad')).toBe(false); // its DDL rolled back with the marker
  });

  it('migrate() applies the baseline via the runner (single queue apply, no error)', async () => {
    await migrate(sql);
    expect(await tableExists('jobs')).toBe(true);
    expect(await applied()).toContain('0001_baseline');
  });
});
