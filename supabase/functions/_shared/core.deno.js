// AUTO-GENERATED — DO NOT EDIT. Built from packages/core via: pnpm run build:b2c-core
// ../shared/src/money.ts
var MoneyError = class extends Error {
};
function money(amount, currency) {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(`Money amount must be integer minor units, got ${amount}`);
  }
  if (!currency) throw new MoneyError("Money requires a currency");
  return { amount, currency };
}
function zero(currency) {
  return money(0, currency);
}
function assertSameCurrency(a, b) {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
function add(a, b) {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}
function subtract(a, b) {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}
function applyBps(m, bps) {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new MoneyError(`bps must be a non-negative integer, got ${bps}`);
  }
  return money(Math.round(m.amount * bps / 1e4), m.currency);
}

// src/fees.ts
var FeeError = class extends Error {
};
function computeFeeBreakdown(input) {
  const { base, feeBps, feeResponsibility } = input;
  const currency = base.currency;
  const secondaryGross = input.secondaryGross ?? zero(currency);
  if (secondaryGross.currency !== currency) {
    throw new MoneyError(`Currency mismatch: ${secondaryGross.currency} vs ${currency}`);
  }
  if (base.amount <= 0) throw new FeeError("base must be positive");
  if (secondaryGross.amount < 0) throw new FeeError("secondaryGross cannot be negative");
  if (secondaryGross.amount >= base.amount) {
    throw new FeeError("secondaryGross must be strictly less than base");
  }
  const totalFee = applyBps(base, feeBps);
  const half = money(Math.round(totalFee.amount / 2), currency);
  const buyerFeeShare = feeResponsibility === "BUYER" ? totalFee : feeResponsibility === "SPLIT" ? half : zero(currency);
  const sellerBorneFee = subtract(totalFee, buyerFeeShare);
  const depositAmount = add(base, buyerFeeShare);
  const secondaryBorneFee = money(
    Math.round(sellerBorneFee.amount * secondaryGross.amount / base.amount),
    currency
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
    platformRevenue: totalFee
  };
}

// src/escrow.ts
var EscrowTransitionError = class extends Error {
};
var TRANSITIONS = {
  DRAFT: { REQUEST_FUNDING: "AWAITING_FUNDING", CANCEL: "CANCELLED" },
  AWAITING_FUNDING: { FUNDING_CONFIRMED: "FUNDED", CANCEL: "CANCELLED" },
  // Once funded, you cannot CANCEL — money has moved, so you must REFUND.
  FUNDED: { RELEASE: "RELEASED", REFUND: "REFUNDED", OPEN_DISPUTE: "DISPUTED" },
  DISPUTED: { RESOLVE_RELEASE: "RELEASED", RESOLVE_REFUND: "REFUNDED" },
  RELEASED: {},
  REFUNDED: {},
  CANCELLED: {}
};
var EVENT_TO_DOMAIN = {
  REQUEST_FUNDING: "escrow.awaiting_funding",
  FUNDING_CONFIRMED: "escrow.funded",
  RELEASE: "escrow.released",
  REFUND: "escrow.refunded",
  CANCEL: "escrow.cancelled",
  OPEN_DISPUTE: "escrow.disputed",
  RESOLVE_RELEASE: "escrow.released",
  RESOLVE_REFUND: "escrow.refunded"
};
function isTerminal(status) {
  return status === "RELEASED" || status === "REFUNDED" || status === "CANCELLED";
}
function canApply(status, event) {
  return TRANSITIONS[status][event] !== void 0;
}
function applyEscrowEvent(state, event) {
  const next = TRANSITIONS[state.status][event];
  if (next === void 0) {
    throw new EscrowTransitionError(
      `Illegal transition: cannot apply "${event}" from "${state.status}"`
    );
  }
  return { state: { status: next }, events: [{ type: EVENT_TO_DOMAIN[event] }] };
}
export {
  EscrowTransitionError,
  FeeError,
  applyEscrowEvent,
  canApply,
  computeFeeBreakdown,
  isTerminal
};
