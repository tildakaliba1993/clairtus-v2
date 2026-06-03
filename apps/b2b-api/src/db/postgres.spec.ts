import { describe, it, expect, vi } from 'vitest';
import { createPostgresExecutor } from './postgres';

// Mocks the `postgres` Sql instance to verify our adapter maps query/params/transaction correctly.
function fakeSql() {
  const calls: { text: string; params: unknown[] }[] = [];
  const sql: any = {
    unsafe: vi.fn(async (text: string, params: unknown[]) => {
      calls.push({ text, params });
      return [{ ok: 1 }];
    }),
    begin: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(sql)),
  };
  return { sql, calls };
}

describe('createPostgresExecutor', () => {
  it('maps query(text, params) to sql.unsafe and returns { rows }', async () => {
    const { sql, calls } = fakeSql();
    const exec = createPostgresExecutor(sql);
    const res = await exec.query('select * from escrows where tenant_id = $1', ['t1']);
    expect(calls[0]).toEqual({ text: 'select * from escrows where tenant_id = $1', params: ['t1'] });
    expect(res).toEqual({ rows: [{ ok: 1 }] });
  });

  it('runs transaction() via sql.begin with a wrapped executor', async () => {
    const { sql } = fakeSql();
    const exec = createPostgresExecutor(sql);
    const out = await exec.transaction(async (tx) => {
      await tx.query('insert into x values ($1)', [1]);
      return 'done';
    });
    expect(sql.begin).toHaveBeenCalledOnce();
    expect(sql.unsafe).toHaveBeenCalledWith('insert into x values ($1)', [1]);
    expect(out).toBe('done');
  });
});
