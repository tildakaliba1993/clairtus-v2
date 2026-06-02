import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Ledger, type SqlExecutor } from '@clairtus/ledger';
import { money } from '@clairtus/shared';
import {
  computeFeeBreakdown,
  buildFundPosting,
  buildReleasePosting,
  buildRefundPosting,
  buildPayoutPosting,
  buildPartialReleasePosting,
  EscrowLedgerError,
} from '../src';

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
          transaction() { throw new Error('nested tx unsupported'); },
        }),
      ) as never;
    },
  };
}

const TENANT = 'tenant-1';
let db: PGlite;
let ledger: Ledger;
let acc: Record<string, string>;

beforeEach(async () => {
  db = new PGlite();
  ledger = new Ledger(executor(db));
  await ledger.init();
  const mk = async (type: never) => (await ledger.createAccount({ tenantId: TENANT, type, currency: 'ZAR' })).id;
  acc = {
    external: await mk('external' as never),
    held: await mk('escrow_held' as never),
    primary: await mk('recipient_payable' as never),
    secondary: await mk('recipient_payable' as never),
    revenue: await mk('clairtus_revenue' as never),
  };
});

/** Conservation: the whole system must always sum to zero. */
async function systemSum(): Promise<number> {
  let total = 0;
  for (const id of Object.values(acc)) total += await ledger.getBalance(id);
  return total;
}

describe('escrow lifecycle posts correctly and reconciles', () => {
  it('fund → release (split) → payout, conserving to zero at every step', async () => {
    const breakdown = computeFeeBreakdown({
      base: money(100000, 'ZAR'),
      feeBps: 150,
      feeResponsibility: 'SELLER',
      secondaryGross: money(40000, 'ZAR'),
    });
    const accounts = {
      external: acc.external!, held: acc.held!,
      primaryRecipient: acc.primary!, secondaryRecipient: acc.secondary!, revenue: acc.revenue!,
    };
    const base = { tenantId: TENANT, currency: 'ZAR', escrowId: 'esc-1' };

    await ledger.post(buildFundPosting({ ...base, reference: 'fund', depositAmount: breakdown.depositAmount.amount, accounts }));
    expect(await ledger.getBalance(acc.held!)).toBe(100000);
    expect(await systemSum()).toBe(0);

    await ledger.post(buildReleasePosting({ ...base, reference: 'release', breakdown, accounts }));
    expect(await ledger.getBalance(acc.held!)).toBe(0);
    expect(await ledger.getBalance(acc.primary!)).toBe(59100);
    expect(await ledger.getBalance(acc.secondary!)).toBe(39400);
    expect(await ledger.getBalance(acc.revenue!)).toBe(1500);
    expect(await systemSum()).toBe(0);

    await ledger.post(buildPayoutPosting({ ...base, reference: 'payout-p', amount: 59100, recipientAccount: acc.primary!, externalAccount: acc.external! }));
    await ledger.post(buildPayoutPosting({ ...base, reference: 'payout-s', amount: 39400, recipientAccount: acc.secondary!, externalAccount: acc.external! }));
    expect(await ledger.getBalance(acc.primary!)).toBe(0);
    expect(await ledger.getBalance(acc.secondary!)).toBe(0);
    expect(await ledger.getBalance(acc.revenue!)).toBe(1500); // Clairtus keeps its fee
    expect(await systemSum()).toBe(0);
  });

  it('refund returns the full deposit and conserves to zero', async () => {
    const base = { tenantId: TENANT, currency: 'ZAR', escrowId: 'esc-2' };
    const accounts = { external: acc.external!, held: acc.held! };
    await ledger.post(buildFundPosting({ ...base, reference: 'fund', depositAmount: 100000, accounts }));
    await ledger.post(buildRefundPosting({ ...base, reference: 'refund', depositAmount: 100000, accounts }));
    expect(await ledger.getBalance(acc.held!)).toBe(0);
    expect(await ledger.getBalance(acc.external!)).toBe(0); // money back out to buyer
    expect(await systemSum()).toBe(0);
  });

  it('promo (0 fee, no secondary): release moves whole deposit to the seller', async () => {
    const breakdown = computeFeeBreakdown({ base: money(50000, 'ZAR'), feeBps: 0, feeResponsibility: 'SELLER' });
    const accounts = {
      external: acc.external!, held: acc.held!, primaryRecipient: acc.primary!, revenue: acc.revenue!,
    };
    const base = { tenantId: TENANT, currency: 'ZAR', escrowId: 'esc-3' };
    await ledger.post(buildFundPosting({ ...base, reference: 'fund', depositAmount: 50000, accounts }));
    await ledger.post(buildReleasePosting({ ...base, reference: 'release', breakdown, accounts }));
    expect(await ledger.getBalance(acc.held!)).toBe(0);
    expect(await ledger.getBalance(acc.primary!)).toBe(50000);
    expect(await ledger.getBalance(acc.revenue!)).toBe(0);
    expect(await systemSum()).toBe(0);
  });
});

describe('invariant #2: cannot release more than held', () => {
  it('partial release within held balance reconciles', async () => {
    const base = { tenantId: TENANT, currency: 'ZAR', escrowId: 'esc-4' };
    await ledger.post(buildFundPosting({ ...base, reference: 'fund', depositAmount: 100000, accounts: { external: acc.external!, held: acc.held! } }));
    await ledger.post(buildPartialReleasePosting({ ...base, reference: 'partial', amount: 30000, heldBalance: 100000, accounts: { held: acc.held!, primaryRecipient: acc.primary! } }));
    expect(await ledger.getBalance(acc.held!)).toBe(70000);
    expect(await ledger.getBalance(acc.primary!)).toBe(30000);
    expect(await systemSum()).toBe(0);
  });

  it('throws when releasing more than the held balance', () => {
    expect(() =>
      buildPartialReleasePosting({
        tenantId: TENANT, currency: 'ZAR', escrowId: 'esc-5', reference: 'over',
        amount: 100001, heldBalance: 100000,
        accounts: { held: acc.held!, primaryRecipient: acc.primary! },
      }),
    ).toThrow(EscrowLedgerError);
  });
});
