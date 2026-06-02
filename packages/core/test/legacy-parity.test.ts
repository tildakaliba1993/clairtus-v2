/**
 * Parity / characterization tests for the B2C → core repoint (T0.4).
 *
 * These pin down how the new `@clairtus/core` fee engine relates to the legacy
 * DRC `stateMachine.ts` fee math, so the repoint is a *reviewed* change, not a
 * silent one.
 *
 * Findings (intentional differences — core is the corrected version):
 *  1. Legacy is internally INCONSISTENT: getDepositAmount() adds an *unrounded*
 *     fee, while the payout path deducts a fee rounded with Math.round() to whole
 *     MAJOR units. Core is consistent (one rounded fee in minor units).
 *  2. Legacy rounds fees to whole major units (loses cents). Core rounds to the
 *     nearest minor unit (precise).
 *  3. Legacy's split-with-secondary formula leaks `secondaryFee`; core reconciles
 *     exactly (covered in fees.test.ts).
 *
 * For "clean" inputs (whole-unit base where base*feePct/100 is already whole and
 * no secondary), legacy is self-consistent and core matches it EXACTLY — which
 * covers the common DRC flows, so those users see no change.
 */
import { describe, it, expect } from 'vitest';
import { money } from '@clairtus/shared';
import { computeFeeBreakdown, type FeeResponsibility } from '../src/fees';

// ---- Legacy reference (ported from stateMachine.ts, major units / floats) ----
const round2 = (n: number) => Math.round(n * 100) / 100;
function legacyDeposit(base: number, feePct: number, resp: FeeResponsibility): number {
  const fee = (base * feePct) / 100;
  if (resp === 'BUYER') return round2(base + fee);
  if (resp === 'SPLIT') return round2(base + fee / 2);
  return base; // SELLER
}

// core deposit in major units, for comparison
function coreDepositMajor(baseMajor: number, feePct: number, resp: FeeResponsibility): number {
  const b = computeFeeBreakdown({
    base: money(Math.round(baseMajor * 100), 'USD'),
    feeBps: Math.round(feePct * 100),
    feeResponsibility: resp,
  });
  return b.depositAmount.amount / 100;
}

const RESPS: FeeResponsibility[] = ['SELLER', 'BUYER', 'SPLIT'];

describe('parity: clean whole-unit amounts (common DRC flows) — core === legacy', () => {
  // base where fee is a whole number: 1.5% of 1000 = 15, of 2000 = 30
  it.each([
    [1000, 1.5],
    [2000, 1.5],
    [1000, 0], // promo
  ])('base=%d feePct=%d matches across all responsibilities', (base, feePct) => {
    for (const resp of RESPS) {
      expect(coreDepositMajor(base, feePct, resp)).toBe(legacyDeposit(base, feePct, resp));
    }
  });
});

describe('correction: fractional fee — core is precise & consistent', () => {
  it('base=500 feePct=1.5 (fee=7.50): core keeps the cents; legacy is coarse/inconsistent', () => {
    // core BUYER deposit = 500 + 7.50 = 507.50 (exact)
    expect(coreDepositMajor(500, 1.5, 'BUYER')).toBe(507.5);
    // core breakdown reconciles exactly
    const b = computeFeeBreakdown({ base: money(50000, 'USD'), feeBps: 150, feeResponsibility: 'BUYER' });
    expect(b.totalFee).toEqual(money(750, 'USD')); // 7.50, not legacy's round(7.5)=8
    expect(b.primaryNet.amount + b.secondaryNet.amount + b.platformRevenue.amount).toBe(b.depositAmount.amount);
  });
});
