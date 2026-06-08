import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Ledger, type SqlExecutor } from '@clairtus/ledger';
import { applyAllSchema } from '../db/schema';
import { AuditService } from './audit.service';

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

const TENANT = '11111111-1111-1111-1111-111111111111';
let db: PGlite;
let sql: SqlExecutor;
let ledger: Ledger;
let audit: AuditService;
let external: string;
let held: string;

beforeEach(async () => {
  db = new PGlite();
  sql = executor(db);
  await applyAllSchema(sql);
  ledger = new Ledger(sql);
  audit = new AuditService(sql);
  external = (await ledger.createAccount({ tenantId: TENANT, type: 'external', currency: 'ZAR' })).id;
  held = (await ledger.createAccount({ tenantId: TENANT, type: 'escrow_held', currency: 'ZAR' })).id;
});

const group = (reference: string) => ({
  tenantId: TENANT, reference, currency: 'ZAR', escrowId: '22222222-2222-2222-2222-222222222222',
  entries: [
    { accountId: external, direction: 'debit' as const, amount: 100000 },
    { accountId: held, direction: 'credit' as const, amount: 100000 },
  ],
});
const auditEntry = { tenantId: TENANT, action: 'escrow.funded', resourceType: 'escrow', escrowId: '22222222-2222-2222-2222-222222222222' };
const heldBalance = () => ledger.getBalance(held);
const auditCount = async () => Number((await sql.query<{ n: number }>(`select count(*)::int as n from audit_log where tenant_id = $1`, [TENANT])).rows[0]!.n);

describe('B4: ledger post + audit row are written in one transaction', () => {
  it('commits the ledger post and its audit row together', async () => {
    await sql.transaction(async (tx) => {
      await ledger.post(group('fund:1'), tx);
      await audit.record(auditEntry, tx);
    });
    expect(await heldBalance()).toBe(100000);
    expect(await auditCount()).toBe(1);
  });

  it('rolls BOTH back when the audit write fails — no money op without an audit row', async () => {
    await expect(
      sql.transaction(async (tx) => {
        await ledger.post(group('fund:2'), tx);
        // Simulate a failure between the ledger post and the audit commit.
        throw new Error('crash before commit');
      }),
    ).rejects.toThrow('crash before commit');

    // The ledger post was rolled back with the (never-written) audit row.
    expect(await heldBalance()).toBe(0);
    expect(await auditCount()).toBe(0);
    const groups = await sql.query<{ n: number }>(`select count(*)::int as n from ledger_posting_groups where reference = $1`, ['fund:2']);
    expect(groups.rows[0]!.n).toBe(0);
  });

  it('rolls the ledger post back when the audit INSERT itself errors', async () => {
    // A tx whose audit insert violates a constraint (null tenant) must undo the ledger post too.
    await expect(
      sql.transaction(async (tx) => {
        await ledger.post(group('fund:3'), tx);
        await tx.query(
          `insert into audit_log (tenant_id, action, resource_type) values ($1, $2, $3)`,
          [null, 'escrow.funded', 'escrow'], // tenant_id is NOT NULL → error
        );
      }),
    ).rejects.toBeTruthy();
    expect(await heldBalance()).toBe(0);
    expect(await auditCount()).toBe(0);
  });
});
