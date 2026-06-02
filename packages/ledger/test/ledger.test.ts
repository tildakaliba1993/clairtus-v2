import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Ledger, LedgerError, type SqlExecutor } from '../src';

// pglite-backed SqlExecutor (in-process Postgres — no Docker)
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
          transaction() {
            throw new Error('nested transaction not supported');
          },
        }),
      ) as never;
    },
  };
}

const TENANT = 'tenant-1';
let db: PGlite;
let ledger: Ledger;

async function makeAccounts() {
  return {
    held: await ledger.createAccount({ tenantId: TENANT, type: 'escrow_held', currency: 'ZAR' }),
    external: await ledger.createAccount({ tenantId: TENANT, type: 'external', currency: 'ZAR' }),
    recipient: await ledger.createAccount({ tenantId: TENANT, type: 'recipient_payable', currency: 'ZAR' }),
    revenue: await ledger.createAccount({ tenantId: TENANT, type: 'clairtus_revenue', currency: 'ZAR' }),
  };
}

beforeEach(async () => {
  db = new PGlite();
  ledger = new Ledger(executor(db));
  await ledger.init();
});

describe('invariant: posting groups must balance', () => {
  it('rejects an unbalanced group and writes nothing', async () => {
    const { held, external } = await makeAccounts();
    await expect(
      ledger.post({
        tenantId: TENANT,
        reference: 'bad-1',
        currency: 'ZAR',
        entries: [
          { accountId: held.id, direction: 'credit', amount: 1000 },
          { accountId: external.id, direction: 'debit', amount: 999 },
        ],
      }),
    ).rejects.toThrow(LedgerError);
    expect(await ledger.getBalance(held.id)).toBe(0);
    expect(await ledger.getBalance(external.id)).toBe(0);
  });

  it('rejects non-positive / non-integer amounts', async () => {
    const { held, external } = await makeAccounts();
    for (const amount of [0, -5, 1.5]) {
      await expect(
        ledger.post({
          tenantId: TENANT, reference: `x-${amount}`, currency: 'ZAR',
          entries: [
            { accountId: held.id, direction: 'credit', amount },
            { accountId: external.id, direction: 'debit', amount },
          ],
        }),
      ).rejects.toThrow(LedgerError);
    }
  });
});

describe('escrow money flow', () => {
  it('fund → hold credits escrow_held and debits external', async () => {
    const { held, external } = await makeAccounts();
    await ledger.post({
      tenantId: TENANT, reference: 'fund-1', currency: 'ZAR', escrowId: 'esc-1',
      entries: [
        { accountId: external.id, direction: 'debit', amount: 100000 },
        { accountId: held.id, direction: 'credit', amount: 100000 },
      ],
    });
    expect(await ledger.getBalance(held.id)).toBe(100000);
    expect(await ledger.getBalance(external.id)).toBe(-100000);
  });

  it('release splits held into recipient net + revenue and zeroes the hold', async () => {
    const { held, external, recipient, revenue } = await makeAccounts();
    await ledger.post({
      tenantId: TENANT, reference: 'fund-2', currency: 'ZAR', escrowId: 'esc-2',
      entries: [
        { accountId: external.id, direction: 'debit', amount: 100000 },
        { accountId: held.id, direction: 'credit', amount: 100000 },
      ],
    });
    await ledger.post({
      tenantId: TENANT, reference: 'release-2', currency: 'ZAR', escrowId: 'esc-2',
      entries: [
        { accountId: held.id, direction: 'debit', amount: 100000 },
        { accountId: recipient.id, direction: 'credit', amount: 98500 },
        { accountId: revenue.id, direction: 'credit', amount: 1500 },
      ],
    });
    expect(await ledger.getBalance(held.id)).toBe(0);
    expect(await ledger.getBalance(recipient.id)).toBe(98500);
    expect(await ledger.getBalance(revenue.id)).toBe(1500);
  });

  it('reverse undoes a posting group exactly', async () => {
    const { held, external } = await makeAccounts();
    const { postingGroupId } = await ledger.post({
      tenantId: TENANT, reference: 'fund-3', currency: 'ZAR',
      entries: [
        { accountId: external.id, direction: 'debit', amount: 50000 },
        { accountId: held.id, direction: 'credit', amount: 50000 },
      ],
    });
    await ledger.reverse(postingGroupId, 'reverse-3', TENANT);
    expect(await ledger.getBalance(held.id)).toBe(0);
    expect(await ledger.getBalance(external.id)).toBe(0);
  });
});

describe('invariant: idempotency by reference', () => {
  it('re-posting the same reference is a no-op', async () => {
    const { held, external } = await makeAccounts();
    const entries = [
      { accountId: external.id, direction: 'debit' as const, amount: 100000 },
      { accountId: held.id, direction: 'credit' as const, amount: 100000 },
    ];
    const first = await ledger.post({ tenantId: TENANT, reference: 'dup-1', currency: 'ZAR', entries });
    const second = await ledger.post({ tenantId: TENANT, reference: 'dup-1', currency: 'ZAR', entries });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.postingGroupId).toBe(first.postingGroupId);
    expect(await ledger.getBalance(held.id)).toBe(100000); // not doubled
  });
});

describe('invariant: balances reconcile under concurrent writes', () => {
  it('20 parallel balanced posts land exactly', async () => {
    const { held, external } = await makeAccounts();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ledger.post({
          tenantId: TENANT, reference: `c-${i}`, currency: 'ZAR',
          entries: [
            { accountId: external.id, direction: 'debit', amount: 100 },
            { accountId: held.id, direction: 'credit', amount: 100 },
          ],
        }),
      ),
    );
    expect(await ledger.getBalance(held.id)).toBe(2000);
    expect(await ledger.getBalance(external.id)).toBe(-2000);
  });
});
