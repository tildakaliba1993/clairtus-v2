// supabase/functions/tests/core_logic.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// 🧪 TEST SUITE 1: Standard Split Payout (1.5% Fee, Seller covers)
Deno.test("Financial Math: Standard 1.5% Split Payout — Seller covers fee", () => {
    const baseAmount = 1000;
    const secondaryGross = 400;
    const feePercentage = 1.5;
    const feeResponsibility = "SELLER";

    const feeMultiplier = feePercentage / 100;

    // depositAmount = baseAmount when SELLER covers fee
    const depositAmount = baseAmount;

    const secondaryFee = Math.round(secondaryGross * feeMultiplier);
    const totalFee = Math.round(baseAmount * feeMultiplier);
    const primaryFee = totalFee - secondaryFee;

    const primaryNet = parseFloat((depositAmount - secondaryGross - totalFee).toFixed(2));
    const secondaryNet = secondaryGross - secondaryFee;

    assertEquals(depositAmount, 1000, "Deposit should equal base when seller covers fee");
    assertEquals(totalFee, 15, "Total Clairtus fee should be 15 (1.5% of 1000)");
    assertEquals(secondaryFee, 6, "Secondary vendor fee should be 6 (1.5% of 400)");
    assertEquals(primaryFee, 9, "Primary vendor fee should be 9");
    assertEquals(primaryNet, 585, "Primary net should be 585 (1000 - 400 - 15)");
    assertEquals(secondaryNet, 394, "Secondary net should be 394 (400 - 6)");
    assertEquals(primaryNet + secondaryNet + totalFee, depositAmount, "Net amounts + fees MUST equal depositAmount");
});

// 🧪 TEST SUITE 1b: Standard Split Payout (1.5% Fee, Buyer covers)
Deno.test("Financial Math: Standard 1.5% Split Payout — Buyer covers fee", () => {
    const baseAmount = 1000;
    const secondaryGross = 400;
    const feePercentage = 1.5;

    const feeMultiplier = feePercentage / 100;
    const totalFee = Math.round(baseAmount * feeMultiplier);

    // depositAmount = baseAmount + totalFee when BUYER covers fee
    const depositAmount = parseFloat((baseAmount + totalFee).toFixed(2));

    const secondaryFee = Math.round(secondaryGross * feeMultiplier);
    const primaryNet = parseFloat((depositAmount - secondaryGross - totalFee).toFixed(2));
    const secondaryNet = secondaryGross - secondaryFee;

    assertEquals(depositAmount, 1015, "Deposit should be 1015 when buyer covers fee");
    assertEquals(primaryNet, 600, "Primary seller receives full 600 (buyer covered fee)");
    assertEquals(primaryNet + secondaryNet + totalFee, depositAmount, "Math must balance");
});

// 🧪 TEST SUITE 2: Promo Code BETA26 (0% Fee)
Deno.test("Financial Math: BETA26 Promo Code applied (0% Fee)", () => {
    const baseAmount = 1500;
    const secondaryGross = 700;
    const feePercentage = 0.0; // Applied via Promo Code

    const feeMultiplier = feePercentage / 100;
    const totalFee = Math.round(baseAmount * feeMultiplier);
    const secondaryFee = Math.round(secondaryGross * feeMultiplier);
    const depositAmount = baseAmount; // SELLER covers 0% = no change

    const primaryNet = parseFloat((depositAmount - secondaryGross - totalFee).toFixed(2));
    const secondaryNet = secondaryGross - secondaryFee;

    assertEquals(totalFee, 0, "Total Clairtus fee must be 0");
    assertEquals(primaryNet, 800, "Primary vendor should receive full 800");
    assertEquals(secondaryNet, 700, "Secondary vendor should receive full 700");
    assertEquals(primaryNet + secondaryNet + totalFee, depositAmount, "Net amounts MUST perfectly equal depositAmount");
});

// 🧪 TEST SUITE 3: The "Fraction of a Cent" Stress Test (1.5% fee)
Deno.test("Financial Math: Weird Fractional Values (e.g. 333 split on 1000, 1.5%)", () => {
    const baseAmount = 1000;
    const secondaryGross = 333;
    const feePercentage = 1.5;

    const feeMultiplier = feePercentage / 100;
    const depositAmount = baseAmount; // SELLER covers

    const secondaryFee = Math.round(secondaryGross * feeMultiplier); // Math.round(4.995) = 5
    const totalFee = Math.round(baseAmount * feeMultiplier); // Math.round(15) = 15
    const primaryFee = totalFee - secondaryFee; // 15 - 5 = 10

    const primaryNet = parseFloat((depositAmount - secondaryGross - totalFee).toFixed(2)); // 1000 - 333 - 15 = 652
    const secondaryNet = secondaryGross - secondaryFee; // 333 - 5 = 328

    assertEquals(primaryFee + secondaryFee, totalFee, "Combined fees must perfectly equal total fee");
    assertEquals(primaryNet + secondaryNet + totalFee, depositAmount, "Math must balance perfectly despite rounding");
});
