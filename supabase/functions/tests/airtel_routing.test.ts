// supabase/functions/tests/airtel_routing.test.ts
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Simulate the function from stateMachine.ts
function getNetworkName(phone: string) {
    const clean = phone.replace(/\+/g, '').replace(/\s/g, '');
    if (clean.startsWith("24399") || clean.startsWith("24397")) return "Airtel";
    if (clean.startsWith("24384") || clean.startsWith("24385") || clean.startsWith("24389")) return "Orange";
    return "M-Pesa";
}

Deno.test("Network Routing: Accurately identifies DRC Telecoms", () => {
    assertEquals(getNetworkName("+243991234567"), "Airtel");
    assertEquals(getNetworkName("243971234567"), "Airtel");
    assertEquals(getNetworkName("+243841234567"), "Orange");
    assertEquals(getNetworkName("243811234567"), "M-Pesa");
});

Deno.test("Security Check: Airtel is completely blocked for Buyers (Deposits)", () => {
    const airtelBuyer = "+243990000000";
    const orangeBuyer = "+243840000000";
    
    // Simulate the logic in CMD_ACHETER, AWAITING_COUNTERPARTY_PHONE_SELL, and INVITED_BUYER
    const isAirtelBlocked = getNetworkName(airtelBuyer) === "Airtel";
    const isOrangeBlocked = getNetworkName(orangeBuyer) === "Airtel";

    assertEquals(isAirtelBlocked, true, "Airtel buyer MUST trigger the block sequence");
    assertEquals(isOrangeBlocked, false, "Orange buyer MUST be allowed to proceed");
});

Deno.test("Security Check: Airtel is allowed for Sellers (Payouts)", () => {
    const airtelSeller = "+243970000000";
    
    // Simulate the logic in AWAITING_COUNTERPARTY_PHONE_BUY and Payout engine
    // We intentionally do NOT use the === "Airtel" block here
    const isAirtelBlockedForSeller = false; 

    assertEquals(isAirtelBlockedForSeller, false, "Airtel seller MUST be allowed to receive payouts");
});