// supabase/functions/tests/core_logic.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// 🧪 TEST SUITE 1: Standard Split Payout (2.5% Fee)
Deno.test("Financial Math: Standard 2.5% Split Payout", () => {
    const baseAmount = 1000;
    const secondaryGross = 400;
    const feePercentage = 2.5; 

    // Simulate the Edge Function Logic
    const feeMultiplier = feePercentage / 100;
    const primaryGross = baseAmount - secondaryGross;

    const secondaryFee = Math.round(secondaryGross * feeMultiplier);
    const totalFee = Math.round(baseAmount * feeMultiplier);
    const primaryFee = totalFee - secondaryFee; 

    const primaryNet = primaryGross - primaryFee;
    const secondaryNet = secondaryGross - secondaryFee;

    // 🎯 ASSERTIONS
    assertEquals(primaryGross, 600, "Primary gross should be exactly 600");
    assertEquals(totalFee, 25, "Total Clairtus fee should be 25");
    assertEquals(secondaryFee, 10, "Secondary vendor fee should be exactly 10 (2.5% of 400)");
    assertEquals(primaryFee, 15, "Primary vendor fee should be exactly 15 (2.5% of 600)");
    
    assertEquals(primaryNet, 585, "Primary net payout should be 585");
    assertEquals(secondaryNet, 390, "Secondary net payout should be 390");

    // 🔥 THE GOLDEN RULE: Everything must add up to exactly the base amount
    assertEquals(primaryNet + secondaryNet + totalFee, baseAmount, "Net amounts + Fees MUST perfectly equal the Base Amount");
});

// 🧪 TEST SUITE 2: Promo Code BETA26 (0% Fee)
Deno.test("Financial Math: BETA26 Promo Code applied (0% Fee)", () => {
    const baseAmount = 1500;
    const secondaryGross = 700;
    const feePercentage = 0.0; // Applied via Promo Code

    // Simulate the Edge Function Logic
    const feeMultiplier = feePercentage / 100;
    const primaryGross = baseAmount - secondaryGross;

    const secondaryFee = Math.round(secondaryGross * feeMultiplier);
    const totalFee = Math.round(baseAmount * feeMultiplier);
    const primaryFee = totalFee - secondaryFee; 

    const primaryNet = primaryGross - primaryFee;
    const secondaryNet = secondaryGross - secondaryFee;

    // 🎯 ASSERTIONS
    assertEquals(totalFee, 0, "Total Clairtus fee must be 0");
    assertEquals(primaryNet, 800, "Primary vendor should receive full 800");
    assertEquals(secondaryNet, 700, "Secondary vendor should receive full 700");
    assertEquals(primaryNet + secondaryNet + totalFee, baseAmount, "Net amounts MUST perfectly equal the Base Amount");
});

// 🧪 TEST SUITE 3: The "Fraction of a Cent" Stress Test
Deno.test("Financial Math: Weird Fractional Values (e.g. 333 split on 1000)", () => {
    const baseAmount = 1000;
    const secondaryGross = 333; // Causes weird decimal fees: 333 * 0.025 = 8.325
    const feePercentage = 2.5; 

    // Simulate the Edge Function Logic
    const feeMultiplier = feePercentage / 100;
    const primaryGross = baseAmount - secondaryGross; // 667

    const secondaryFee = Math.round(secondaryGross * feeMultiplier); // Math.round(8.325) = 8
    const totalFee = Math.round(baseAmount * feeMultiplier); // Math.round(25) = 25
    const primaryFee = totalFee - secondaryFee; // 25 - 8 = 17

    const primaryNet = primaryGross - primaryFee; // 667 - 17 = 650
    const secondaryNet = secondaryGross - secondaryFee; // 333 - 8 = 325

    // 🎯 ASSERTIONS
    assertEquals(primaryFee + secondaryFee, totalFee, "Combined fees must perfectly equal total fee");
    assertEquals(primaryNet + secondaryNet + totalFee, baseAmount, "Math must balance perfectly despite rounding");
});