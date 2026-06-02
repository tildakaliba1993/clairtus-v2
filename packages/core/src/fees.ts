import {
  type Money,
  type Currency,
  money,
  zero,
  add,
  subtract,
  applyBps,
  MoneyError,
} from '@clairtus/shared';

/**
 * Who covers the platform (Clairtus) escrow fee.
 * - SELLER: buyer pays exactly the item value; fee is deducted from seller payouts.
 * - BUYER:  buyer pays item value + full fee; sellers receive full value.
 * - SPLIT:  buyer pays item value + half the fee; sellers bear the other half.
 */
export type FeeResponsibility = 'SELLER' | 'BUYER' | 'SPLIT';

export class FeeError extends Error {}

export interface FeeInput {
  /** Agreed item/transaction value. */
  base: Money;
  /** Platform fee in basis points (1.5% = 150). */
  feeBps: number;
  feeResponsibility: FeeResponsibility;
  /** Optional split payout: gross going to a secondary vendor (must be < base). */
  secondaryGross?: Money;
}

export interface FeeBreakdown {
  base: Money;
  /** Platform (Clairtus) revenue. */
  totalFee: Money;
  /** Portion of the fee added to the buyer's deposit. */
  buyerFeeShare: Money;
  /** What the buyer actually pays in. */
  depositAmount: Money;
  /** Net paid out to the primary seller. */
  primaryNet: Money;
  secondaryGross: Money;
  /** Net paid out to the secondary vendor. */
  secondaryNet: Money;
  /** Always equals totalFee — Clairtus's take. */
  platformRevenue: Money;
}

/**
 * Computes the full money breakdown for an escrow, in integer minor units.
 *
 * INVARIANT (asserted by tests): primaryNet + secondaryNet + platformRevenue === depositAmount.
 * The seller-borne portion of the fee is allocated between primary and secondary
 * vendors in proportion to their gross, with no rounding leakage.
 */
export function computeFeeBreakdown(input: FeeInput): FeeBreakdown {
  const { base, feeBps, feeResponsibility } = input;
  const currency: Currency = base.currency;
  const secondaryGross = input.secondaryGross ?? zero(currency);

  if (secondaryGross.currency !== currency) {
    throw new MoneyError(`Currency mismatch: ${secondaryGross.currency} vs ${currency}`);
  }
  if (base.amount <= 0) throw new FeeError('base must be positive');
  if (secondaryGross.amount < 0) throw new FeeError('secondaryGross cannot be negative');
  if (secondaryGross.amount >= base.amount) {
    throw new FeeError('secondaryGross must be strictly less than base');
  }

  const totalFee = applyBps(base, feeBps);
  const half = money(Math.round(totalFee.amount / 2), currency);

  const buyerFeeShare: Money =
    feeResponsibility === 'BUYER' ? totalFee :
    feeResponsibility === 'SPLIT' ? half :
    zero(currency); // SELLER

  const sellerBorneFee = subtract(totalFee, buyerFeeShare);
  const depositAmount = add(base, buyerFeeShare);

  // Allocate the seller-borne fee between primary & secondary by gross proportion.
  // primaryBorneFee is the remainder, so the two always sum to sellerBorneFee exactly.
  const secondaryBorneFee = money(
    Math.round((sellerBorneFee.amount * secondaryGross.amount) / base.amount),
    currency,
  );
  const primaryBorneFee = subtract(sellerBorneFee, secondaryBorneFee);

  const primaryGross = subtract(base, secondaryGross);
  const primaryNet = subtract(primaryGross, primaryBorneFee);
  const secondaryNet = subtract(secondaryGross, secondaryBorneFee);

  return {
    base,
    totalFee,
    buyerFeeShare,
    depositAmount,
    primaryNet,
    secondaryGross,
    secondaryNet,
    platformRevenue: totalFee,
  };
}
