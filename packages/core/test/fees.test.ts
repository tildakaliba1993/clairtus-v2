import { describe, it, expect } from 'vitest';
import { money, add } from '@clairtus/shared';
import { computeFeeBreakdown, FeeError, type FeeResponsibility } from '../src/fees';

const ZAR = 'ZAR';
// 1000.00 in minor units
const base = money(100000, ZAR);
const FEE_BPS = 150; // 1.5%

/** The core invariant: nothing is created or lost. */
function assertReconciles(b: ReturnType<typeof computeFeeBreakdown>) {
  const out = b.primaryNet.amount + b.secondaryNet.amount + b.platformRevenue.amount;
  expect(out).toBe(b.depositAmount.amount);
}

describe('computeFeeBreakdown — fee responsibility', () => {
  it('SELLER: buyer pays base; fee deducted from seller', () => {
    const b = computeFeeBreakdown({ base, feeBps: FEE_BPS, feeResponsibility: 'SELLER' });
    expect(b.depositAmount).toEqual(base);
    expect(b.totalFee).toEqual(money(1500, ZAR)); // 15.00
    expect(b.primaryNet).toEqual(money(98500, ZAR)); // 985.00
    assertReconciles(b);
  });

  it('BUYER: buyer pays base + fee; seller receives full base', () => {
    const b = computeFeeBreakdown({ base, feeBps: FEE_BPS, feeResponsibility: 'BUYER' });
    expect(b.depositAmount).toEqual(money(101500, ZAR)); // 1015.00
    expect(b.primaryNet).toEqual(base); // seller gets full 1000.00
    assertReconciles(b);
  });

  it('SPLIT: buyer pays base + half fee; seller bears the other half', () => {
    const b = computeFeeBreakdown({ base, feeBps: FEE_BPS, feeResponsibility: 'SPLIT' });
    expect(b.depositAmount).toEqual(money(100750, ZAR)); // 1007.50
    expect(b.primaryNet).toEqual(money(99250, ZAR)); // 992.50
    assertReconciles(b);
  });

  it('0 bps (promo): no fee, full pass-through', () => {
    const b = computeFeeBreakdown({ base, feeBps: 0, feeResponsibility: 'BUYER' });
    expect(b.totalFee.amount).toBe(0);
    expect(b.depositAmount).toEqual(base);
    expect(b.primaryNet).toEqual(base);
    assertReconciles(b);
  });
});

describe('computeFeeBreakdown — split payout to a secondary vendor', () => {
  const secondaryGross = money(40000, ZAR); // 400.00 of the 1000.00

  it.each<FeeResponsibility>(['SELLER', 'BUYER', 'SPLIT'])(
    'reconciles with a secondary vendor (%s pays fee)',
    (feeResponsibility) => {
      const b = computeFeeBreakdown({ base, feeBps: FEE_BPS, feeResponsibility, secondaryGross });
      // primary + secondary gross always equals base
      expect(add(b.primaryNet, b.secondaryNet).amount + b.platformRevenue.amount).toBe(
        b.depositAmount.amount,
      );
      assertReconciles(b);
    },
  );

  it('allocates the seller-borne fee proportionally (no rounding leak)', () => {
    // SELLER mode: seller bears all 15.00; secondary is 40% of base -> 6.00, primary 9.00
    const b = computeFeeBreakdown({ base, feeBps: FEE_BPS, feeResponsibility: 'SELLER', secondaryGross });
    expect(b.secondaryNet).toEqual(money(39400, ZAR)); // 400.00 - 6.00
    expect(b.primaryNet).toEqual(money(59100, ZAR)); // 600.00 - 9.00
    assertReconciles(b);
  });

  it('reconciles on awkward fractional values (333.00 secondary)', () => {
    const b = computeFeeBreakdown({
      base,
      feeBps: FEE_BPS,
      feeResponsibility: 'SELLER',
      secondaryGross: money(33300, ZAR),
    });
    assertReconciles(b);
  });
});

describe('computeFeeBreakdown — guards', () => {
  it('rejects non-positive base', () => {
    expect(() => computeFeeBreakdown({ base: money(0, ZAR), feeBps: FEE_BPS, feeResponsibility: 'SELLER' })).toThrow(FeeError);
  });
  it('rejects secondaryGross >= base', () => {
    expect(() =>
      computeFeeBreakdown({ base, feeBps: FEE_BPS, feeResponsibility: 'SELLER', secondaryGross: money(100000, ZAR) }),
    ).toThrow(FeeError);
  });
});
