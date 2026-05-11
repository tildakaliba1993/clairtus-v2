import { pawapayRequest } from "../_shared/pawapayClient.ts";

Deno.serve(async (req: Request) => {
  try {
    // ⚠️ Ensure this is your M-Pesa test number
    const TEST_PHONE = "243824401073"; 
    const MNO_CORRESPONDENT = "VODACOM_MPESA_COD"; 

    console.log(`Initiating Live $0.50 Payout to ${TEST_PHONE}...`);

    const payload = {
      payoutId: crypto.randomUUID(),
      amount: "0.50", 
      currency: "USD", 
      country: "COD",
      correspondent: MNO_CORRESPONDENT,
      recipient: {
        type: "MSISDN",
        address: { value: TEST_PHONE }
      },
      customerTimestamp: new Date().toISOString(),
      statementDescription: "Clairtus Payout Test"
    };

    const result = await pawapayRequest("/payouts", "POST", payload);

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});