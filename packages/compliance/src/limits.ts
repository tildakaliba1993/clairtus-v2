/**
 * Per-market transaction-limit engine. Pure functions, no DB, no I/O — the
 * caller supplies the live FX rate and the user's already-used volume; this
 * engine returns a decision. Same logic for B2C (DRC/BCC today) and the B2B API
 * (per-tenant, per-market) tomorrow.
 *
 * Limits are expressed in USD (the regulatory base); amounts arrive in the
 * transaction currency (major units) plus an FX rate (local units per USD).
 * Ported 1:1 from the live B2C BCC logic so it is a behavior-preserving swap.
 */

export interface MarketRules {
  /** Minimum per transaction, in USD. */
  minUsd: number;
  /** Maximum per transaction AND per rolling 24h, in USD (BCC: equal). */
  dailyMaxUsd: number;
  /** Maximum per rolling 30 days, in USD. */
  monthlyMaxUsd: number;
}

/** BCC (Banque Centrale du Congo) — Instruction n°24 Art. 17 (permanent limits). */
export const BCC_RULES: MarketRules = { minUsd: 1, dailyMaxUsd: 500, monthlyMaxUsd: 2500 };

/** Build BCC rules with optional env overrides (only valid with express BCC authorization). */
export function bccRulesFromEnv(env: {
  BCC_MAX_USD?: string | null;
  BCC_MONTHLY_MAX_USD?: string | null;
}): MarketRules {
  const daily = parseFloat(env.BCC_MAX_USD ?? '');
  const monthly = parseFloat(env.BCC_MONTHLY_MAX_USD ?? '');
  return {
    minUsd: 1,
    dailyMaxUsd: isNaN(daily) ? 500 : daily,
    monthlyMaxUsd: isNaN(monthly) ? 2500 : monthly,
  };
}

// ─── FX conversion (identical to the live B2C helpers) ───────────────────────
export function toUsd(amount: number, currency: string, rate: number): number {
  return currency === 'CDF' ? amount / rate : amount;
}
export function fromUsd(amountUsd: number, currency: string, rate: number): number {
  return currency === 'CDF' ? Math.floor(amountUsd * rate) : parseFloat(amountUsd.toFixed(2));
}
/** Minimum in the transaction currency (1 USD or its live CDF equivalent). */
export function minAmount(currency: string, rate: number, rules: MarketRules = BCC_RULES): number {
  return currency === 'CDF' ? Math.round(rate * rules.minUsd) : rules.minUsd;
}

// ─── Per-transaction bounds ──────────────────────────────────────────────────
export type AmountCheck =
  | { ok: true }
  | { ok: false; code: 'BELOW_MIN'; min: number }
  | { ok: false; code: 'ABOVE_MAX'; max: number };

export function checkAmountBounds(
  amount: number,
  currency: string,
  rate: number,
  rules: MarketRules = BCC_RULES,
): AmountCheck {
  const min = minAmount(currency, rate, rules);
  if (amount < min) return { ok: false, code: 'BELOW_MIN', min };
  const max = fromUsd(rules.dailyMaxUsd, currency, rate);
  if (amount > max) return { ok: false, code: 'ABOVE_MAX', max };
  return { ok: true };
}

// ─── Cumulative daily / monthly ceilings (apply to the payer) ────────────────
export type VolumeCheck =
  | { ok: true }
  | { ok: false; code: 'DAILY_EXCEEDED'; dailyRemaining: number; monthlyRemaining: number }
  | { ok: false; code: 'MONTHLY_EXCEEDED'; monthlyRemaining: number };

export function checkVolumeLimits(params: {
  /** The payment about to be made, in the transaction currency (major units). */
  depositAmount: number;
  currency: string;
  rate: number;
  /** Already-committed volume in the rolling windows, in USD. */
  dailyUsedUsd: number;
  monthlyUsedUsd: number;
  rules?: MarketRules;
}): VolumeCheck {
  const rules = params.rules ?? BCC_RULES;
  const newUsd = toUsd(params.depositAmount, params.currency, params.rate);
  const dailyRemaining = fromUsd(Math.max(0, rules.dailyMaxUsd - params.dailyUsedUsd), params.currency, params.rate);
  const monthlyRemaining = fromUsd(Math.max(0, rules.monthlyMaxUsd - params.monthlyUsedUsd), params.currency, params.rate);

  if (params.dailyUsedUsd + newUsd > rules.dailyMaxUsd + 0.01) {
    return { ok: false, code: 'DAILY_EXCEEDED', dailyRemaining, monthlyRemaining };
  }
  if (params.monthlyUsedUsd + newUsd > rules.monthlyMaxUsd + 0.01) {
    return { ok: false, code: 'MONTHLY_EXCEEDED', monthlyRemaining };
  }
  return { ok: true };
}

// ─── AML: structuring / velocity signal ──────────────────────────────────────
/** Ping-pong / structuring: repeated transactions with the same counterparty. */
export function isStructuring(params: { repeatCountWithCounterparty: number; threshold?: number }): boolean {
  return params.repeatCountWithCounterparty >= (params.threshold ?? 2);
}
