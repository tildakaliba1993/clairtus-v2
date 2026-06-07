/**
 * Escrow accounting policy: turns escrow money events into balanced ledger
 * posting groups. The app layer resolves the concrete account IDs and calls
 * ledger.post(group). Amounts are integer MINOR units throughout (matching both
 * the fee engine and the ledger).
 *
 * Money flow across the ledger:
 *   fund:    external (debit gross)          → escrow_held (credit net) [+ psp_fees (credit fee)]
 *   release: escrow_held (debit deposit)     → recipient(s) (credit nets) + revenue (credit fee)
 *   payout:  recipient_payable (debit net)   → external (credit net)
 *   refund:  escrow_held (debit deposit)     → external (credit deposit)
 *
 * The whole system is conservative: the sum of all account balances is always 0.
 */
import type { PostingGroupInput, EntryInput } from '@clairtus/ledger';
import type { FeeBreakdown } from './fees';

export class EscrowLedgerError extends Error {}

export interface EscrowAccounts {
  external: string;
  held: string;
  primaryRecipient: string;
  secondaryRecipient?: string;
  revenue: string;
  pspFees?: string;
}

interface Base {
  tenantId: string;
  reference: string;
  currency: string;
  escrowId: string;
}

function assertPositiveInt(n: number, label: string): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new EscrowLedgerError(`${label} must be a positive integer (minor units), got ${n}`);
  }
}

/**
 * Buyer funds the escrow: money in, held. `depositAmount` is the amount actually settled into custody
 * (credited to `held`). When the rail deducts a PSP fee before settling, pass `fee` (+ a `pspFees`
 * account): the buyer's gross (`depositAmount + fee`) debits `external` and the fee credits `psp_fees`,
 * so the ledger reflects the true gross/net/fee split and never overstates custody.
 */
export function buildFundPosting(
  p: Base & { depositAmount: number; fee?: number; accounts: Pick<EscrowAccounts, 'external' | 'held' | 'pspFees'> },
): PostingGroupInput {
  assertPositiveInt(p.depositAmount, 'depositAmount');
  const fee = p.fee ?? 0;
  const entries: EntryInput[] = [
    { accountId: p.accounts.external, direction: 'debit', amount: p.depositAmount + fee },
    { accountId: p.accounts.held, direction: 'credit', amount: p.depositAmount },
  ];
  if (fee > 0) {
    assertPositiveInt(fee, 'fee');
    if (!p.accounts.pspFees) throw new EscrowLedgerError('pspFees account is required when fee > 0');
    entries.push({ accountId: p.accounts.pspFees, direction: 'credit', amount: fee });
  }
  return { tenantId: p.tenantId, reference: p.reference, currency: p.currency, escrowId: p.escrowId, entries };
}

/** Full release: held → recipient net(s) + platform revenue, using the fee breakdown. */
export function buildReleasePosting(
  p: Base & { breakdown: FeeBreakdown; accounts: EscrowAccounts },
): PostingGroupInput {
  const b = p.breakdown;
  const deposit = b.depositAmount.amount;

  const entries: EntryInput[] = [
    { accountId: p.accounts.held, direction: 'debit', amount: deposit },
    { accountId: p.accounts.primaryRecipient, direction: 'credit', amount: b.primaryNet.amount },
  ];

  if (b.secondaryNet.amount > 0) {
    if (!p.accounts.secondaryRecipient) {
      throw new EscrowLedgerError('secondaryRecipient account is required when secondaryNet > 0');
    }
    entries.push({ accountId: p.accounts.secondaryRecipient, direction: 'credit', amount: b.secondaryNet.amount });
  }
  if (b.platformRevenue.amount > 0) {
    entries.push({ accountId: p.accounts.revenue, direction: 'credit', amount: b.platformRevenue.amount });
  }

  return { tenantId: p.tenantId, reference: p.reference, currency: p.currency, escrowId: p.escrowId, entries };
}

/**
 * Partial (milestone) release: move an exact amount from held to a recipient.
 * Enforces invariant #2 — cannot release more than is currently held.
 */
export function buildPartialReleasePosting(
  p: Base & { amount: number; heldBalance: number; accounts: Pick<EscrowAccounts, 'held' | 'primaryRecipient'> },
): PostingGroupInput {
  assertPositiveInt(p.amount, 'amount');
  if (p.amount > p.heldBalance) {
    throw new EscrowLedgerError(`cannot release ${p.amount}: only ${p.heldBalance} held`);
  }
  return {
    tenantId: p.tenantId,
    reference: p.reference,
    currency: p.currency,
    escrowId: p.escrowId,
    entries: [
      { accountId: p.accounts.held, direction: 'debit', amount: p.amount },
      { accountId: p.accounts.primaryRecipient, direction: 'credit', amount: p.amount },
    ],
  };
}

/** Refund the full deposit back to the buyer. */
export function buildRefundPosting(
  p: Base & { depositAmount: number; accounts: Pick<EscrowAccounts, 'held' | 'external'> },
): PostingGroupInput {
  assertPositiveInt(p.depositAmount, 'depositAmount');
  return {
    tenantId: p.tenantId,
    reference: p.reference,
    currency: p.currency,
    escrowId: p.escrowId,
    entries: [
      { accountId: p.accounts.held, direction: 'debit', amount: p.depositAmount },
      { accountId: p.accounts.external, direction: 'credit', amount: p.depositAmount },
    ],
  };
}

/** Settlement: actually disburse a recipient's owed balance out to the rail. */
export function buildPayoutPosting(
  p: Base & { amount: number; recipientAccount: string; externalAccount: string },
): PostingGroupInput {
  assertPositiveInt(p.amount, 'amount');
  return {
    tenantId: p.tenantId,
    reference: p.reference,
    currency: p.currency,
    escrowId: p.escrowId,
    entries: [
      { accountId: p.recipientAccount, direction: 'debit', amount: p.amount },
      { accountId: p.externalAccount, direction: 'credit', amount: p.amount },
    ],
  };
}
