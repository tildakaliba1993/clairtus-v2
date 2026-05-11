import { pawapayRequest } from "../_shared/pawapayClient.ts";

Deno.serve(async (req: Request) => {
  try {
    // ⚠️ Paste your successful M-Pesa Deposit ID here:
    const ORIGINAL_DEPOSIT_ID = "77cfaf45-a12b-487d-b346-c6887e0d7c73"; 

    console.log(`Initiating Live Refund for Deposit: ${ORIGINAL_DEPOSIT_ID}...`);

    const payload = {
      refundId: crypto.randomUUID(),
      depositId: ORIGINAL_DEPOSIT_ID,
      statementDescription: "Clairtus Refund"
    };

    const result = await pawapayRequest("/refunds", "POST", payload);

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