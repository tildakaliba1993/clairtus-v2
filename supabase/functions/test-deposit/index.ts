import { pawapayRequest } from "../_shared/pawapayClient.ts";

Deno.serve(async (req: Request) => {
  try {
    // ⚠️ Updated back to your Vodacom test number
    const TEST_PHONE = "243824401073"; 
    
    // ⚠️ Exact provider code for Vodacom M-Pesa in DRC
    const MNO_CORRESPONDENT = "VODACOM_MPESA_COD"; 

    console.log(`Initiating Live $1 Deposit to ${TEST_PHONE} via ${MNO_CORRESPONDENT}...`);

    const payload = {
      depositId: crypto.randomUUID(),
      amount: "1.00", 
      currency: "USD", 
      country: "COD",
      correspondent: MNO_CORRESPONDENT,
      payer: {
        type: "MSISDN",
        address: { value: TEST_PHONE }
      },
      customerTimestamp: new Date().toISOString(),
      statementDescription: "Clairtus MPesa Test"
    };

    const result = await pawapayRequest("/deposits", "POST", payload);

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