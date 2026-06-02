// Deno parity test for the B2C → core repoint (T0.4).
// Confirms the coreFees adapter (which delegates to @clairtus/core) matches the
// legacy DRC fee math for the common whole-unit flows, and that payouts reconcile.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { getDepositAmount, computePayout } from "../_shared/coreFees.ts";

// Legacy reference (major units), ported from the old stateMachine.ts.
const round2 = (n: number) => Math.round(n * 100) / 100;
function legacyDeposit(base: number, feePct: number, resp: string): number {
  const fee = (base * feePct) / 100;
  if (resp === "BUYER") return round2(base + fee);
  if (resp === "SPLIT") return round2(base + fee / 2);
  return base;
}

Deno.test("deposit parity — clean whole-unit amounts match legacy", () => {
  for (const base of [1000, 2000]) {
    for (const feePct of [1.5, 2.5, 0]) {
      for (const resp of ["SELLER", "BUYER", "SPLIT"]) {
        assertEquals(
          getDepositAmount(base, feePct, resp),
          legacyDeposit(base, feePct, resp),
          `deposit base=${base} feePct=${feePct} resp=${resp}`,
        );
      }
    }
  }
});

Deno.test("payout values — single vendor (1000 @ 1.5%)", () => {
  assertEquals(computePayout(1000, 1.5, "SELLER").primaryNet, 985); // 1000 - 15
  assertEquals(computePayout(1000, 1.5, "BUYER").primaryNet, 1000); // buyer covered fee
  assertEquals(computePayout(1000, 1.5, "SPLIT").primaryNet, 992.5);
});

Deno.test("payout values — split with secondary vendor reconciles exactly", () => {
  const b = computePayout(1000, 1.5, "SELLER", 400);
  assertEquals(b.primaryNet, 591); // 600 - 9
  assertEquals(b.secondaryNet, 394); // 400 - 6
  // primaryNet + secondaryNet + totalFee === depositAmount (the core invariant)
  assertEquals(b.primaryNet + b.secondaryNet + b.totalFee, b.depositAmount);
});

Deno.test("guards — non-positive base returns base unchanged", () => {
  assertEquals(getDepositAmount(0, 1.5, "SELLER"), 0);
});
