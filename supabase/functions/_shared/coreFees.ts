// Thin Deno adapter over @clairtus/core (vendored bundle: core.deno.js).
// The B2C state machine works in MAJOR currency units (as stored in the DB),
// while the shared core works in integer MINOR units. This adapter converts at
// the boundary and delegates ALL fee/deposit/payout math to the shared core, so
// the B2C product and the future B2B API compute money identically.
//
// To regenerate the bundle: `pnpm run build:b2c-core`
// @ts-ignore — the vendored bundle ships without type declarations.
import { computeFeeBreakdown } from "./core.deno.js";

type FeeResp = "SELLER" | "BUYER" | "SPLIT";
const CUR = "XXX"; // currency is irrelevant to the breakdown math (single-currency)

const toMinor = (major: number): number => Math.round(major * 100);
const toMajor = (minor: number): number => minor / 100;
const toBps = (feePct: number | null | undefined): number => Math.round((feePct ?? 1.5) * 100);
const resp = (r: string | null | undefined): FeeResp =>
  r === "BUYER" || r === "SPLIT" ? r : "SELLER";

/** Deposit the buyer pays, in major units (mirrors the legacy signature). */
export function getDepositAmount(base: number, feePct: number, feeResp?: string | null): number {
  if (!base || base <= 0) return base ?? 0;
  const b = computeFeeBreakdown({
    base: { amount: toMinor(base), currency: CUR },
    feeBps: toBps(feePct),
    feeResponsibility: resp(feeResp),
  });
  return toMajor(b.depositAmount.amount);
}

export interface PayoutBreakdown {
  depositAmount: number;
  totalFee: number;
  primaryNet: number;
  secondaryNet: number;
}

/** Full payout breakdown (deposit, fee, primary/secondary nets), in major units. */
export function computePayout(
  base: number,
  feePct: number,
  feeResp: string | null | undefined,
  secondaryGross = 0,
): PayoutBreakdown {
  const sg = secondaryGross > 0 && secondaryGross < base ? secondaryGross : 0;
  const b = computeFeeBreakdown({
    base: { amount: toMinor(base), currency: CUR },
    feeBps: toBps(feePct),
    feeResponsibility: resp(feeResp),
    secondaryGross: sg > 0 ? { amount: toMinor(sg), currency: CUR } : undefined,
  });
  return {
    depositAmount: toMajor(b.depositAmount.amount),
    totalFee: toMajor(b.totalFee.amount),
    primaryNet: toMajor(b.primaryNet.amount),
    secondaryNet: toMajor(b.secondaryNet.amount),
  };
}
