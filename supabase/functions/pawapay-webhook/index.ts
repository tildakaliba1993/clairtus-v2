// supabase/functions/pawapay-webhook/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";
import { MESSAGES } from "../_shared/whatsappMessaging.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const body = await req.json();
    console.log(`💰 [PAWAPAY WEBHOOK RECEIVED]:`, JSON.stringify(body));

    const depositId = body.depositId;
    const status = body.status;

    if (!depositId || !status) return new Response("Invalid Payload", { status: 400 });

    const supabase = getSupabaseClient();
    const { data: tx, error: txError } = await supabase.from("transactions").select("*").eq("pawapay_deposit_id", depositId).single();

    if (txError || !tx) {
      console.error("❌ Transaction not found for depositId:", depositId);
      return new Response("Transaction Not Found", { status: 404 });
    }

    if (status === "COMPLETED") {
      console.log(`✅ Payment COMPLETED for TX: ${tx.reference}`);
      
      const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
      
      // Update TX to FUNDED and save the PIN
      await supabase.from("transactions").update({ status: "FUNDED", pin_code: generatedPin }).eq("id", tx.id);
      
      // Crucial Fix: Ensure BOTH users get moved into the delivery phase, regardless of who initiated the contract.
      await supabase.from("sessions").update({ current_state: "AWAITING_DELIVERY_BUYER", draft_transaction_id: tx.id }).eq("phone_number", tx.buyer_phone);
      await sendWhatsAppText(tx.buyer_phone, MESSAGES.PAYMENT_SUCCESS_BUYER(tx.base_amount, generatedPin));

      await supabase.from("sessions").update({ current_state: "AWAITING_DELIVERY_SELLER", draft_transaction_id: tx.id }).eq("phone_number", tx.seller_phone);
      await sendWhatsAppText(tx.seller_phone, MESSAGES.PAYMENT_SUCCESS_SELLER(tx.base_amount));

    } else if (status === "FAILED" || status === "REJECTED") {
      console.log(`❌ Payment FAILED for TX: ${tx.reference}`);
      await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", tx.buyer_phone);
      await sendWhatsAppText(tx.buyer_phone, MESSAGES.PAYMENT_FAILED_BUYER);
    }

    return new Response("Webhook Processed Successfully", { status: 200 });

  } catch (error) {
    console.error("🚨 Fatal Error in PawaPay Webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});