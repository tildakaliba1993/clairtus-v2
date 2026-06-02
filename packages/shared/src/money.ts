/**
 * Money is always represented in INTEGER minor units (cents, centimes…) plus a
 * currency code. Never use floats for money — all arithmetic stays exact.
 */
export type Currency = string; // e.g. 'USD', 'CDF', 'ZAR', 'NGN'

export interface Money {
  /** integer amount in the currency's minor unit */
  readonly amount: number;
  readonly currency: Currency;
}

export class MoneyError extends Error {}

export function money(amount: number, currency: Currency): Money {
  if (!Number.isInteger(amount)) {
    throw new MoneyError(`Money amount must be integer minor units, got ${amount}`);
  }
  if (!currency) throw new MoneyError('Money requires a currency');
  return { amount, currency };
}

export function zero(currency: Currency): Money {
  return money(0, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sum(items: Money[], currency: Currency): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function isNegative(m: Money): boolean {
  return m.amount < 0;
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function gt(a: Money, b: Money): boolean {
  assertSameCurrency(a, b);
  return a.amount > b.amount;
}

export function gte(a: Money, b: Money): boolean {
  assertSameCurrency(a, b);
  return a.amount >= b.amount;
}

export function eq(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

/**
 * Apply a fee in basis points (1.5% = 150 bps), rounding to the nearest minor unit.
 */
export function applyBps(m: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new MoneyError(`bps must be a non-negative integer, got ${bps}`);
  }
  return money(Math.round((m.amount * bps) / 10000), m.currency);
}
