import { describe, it, expect } from 'vitest';
import type { SqlExecutor } from '../db/sql';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('inserts an append-only row with the given action + metadata', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const sql: SqlExecutor = {
      async query<T = Record<string, unknown>>(s: string, p?: unknown[]): Promise<{ rows: T[] }> {
        calls.push({ sql: s, params: p ?? [] });
        return { rows: [] as T[] };
      },
      async transaction<T>(): Promise<T> {
        throw new Error('not used');
      },
    };
    const audit = new AuditService(sql);
    await audit.record({ tenantId: 't1', action: 'escrow.released', resourceType: 'escrow', resourceId: 'e1', escrowId: 'e1', metadata: { revenue: 1500 } });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/insert into audit_log/i);
    expect(calls[0]!.sql).not.toMatch(/update|delete/i); // append-only
    expect(calls[0]!.params).toEqual(['t1', 'escrow.released', 'escrow', 'e1', 'e1', 'system', JSON.stringify({ revenue: 1500 })]);
  });
});
