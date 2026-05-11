// supabase/functions/admin-console/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { initiatePawaPayPayout } from "../_shared/pawapayClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const body = await req.json();
    const { transactionId, resolution, adminSecret } = body;

    // 🛡️ SECURITY CHECK: Ensure only YOU can run this
    const EXPECTED_SECRET = Deno.env.get("ADMIN_SECRET");
    if (!EXPECTED_SECRET || adminSecret !== EXPECTED_SECRET) {
      console.error("🚨 Unauthorized Admin Access Attempt!");
      return new Response("Unauthorized", { status: 401 });
    }

    if (!transactionId || !["PAYOUT_SELLER", "REFUND_BUYER"].includes(resolution)) {
      return new Response("Invalid Payload", { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: tx, error: txError } = await supabase.from("transactions").select("*").eq("id", transactionId).single();

    if (txError || !tx) return new Response("Transaction Not Found", { status: 404 });
    if (tx.status !== "DISPUTED" && tx.status !== "FUNDED") {
       return new Response(`Transaction is not in a resolvable state. Current status: ${tx.status}`, { status: 400 });
    }

    console.log(`⚖️ [ADMIN CONSOLE] Resolving TX ${tx.reference}. Action: ${resolution}`);

    const actionId = crypto.randomUUID();

    // 🟢 SCENARIO 1: ADMIN WINS FOR SELLER (Force Payout)
    if (resolution === "PAYOUT_SELLER") {
      const payoutAmount = Number((tx.base_amount * 0.975).toFixed(2)); // Subtract Clairtus Fee
      await initiatePawaPayPayout(actionId, payoutAmount, tx.seller_phone);
      
      await supabase.from("transactions").update({ status: "COMPLETED", pawapay_payout_id: actionId }).eq("id", tx.id);
      
      await sendWhatsAppText(tx.seller_phone, `⚖️ *Résolution de Litige*\n\nAprès vérification, Clairtus a tranché en votre faveur.\n✅ Un virement de ${payoutAmount} $ a été envoyé sur votre compte Mobile Money.`);
      await sendWhatsAppText(tx.buyer_phone, `⚖️ *Résolution de Litige*\n\nAprès vérification, les fonds de ${tx.base_amount} $ ont été débloqués et envoyés au vendeur. Ce dossier est maintenant clos.`);
    } 
    
    // 🔴 SCENARIO 2: ADMIN WINS FOR BUYER (Force Refund)
    else if (resolution === "REFUND_BUYER") {
      await initiatePawaPayPayout(actionId, tx.base_amount, tx.buyer_phone);
      
      await supabase.from("transactions").update({ status: "REFUNDED" }).eq("id", tx.id);
      
      await sendWhatsAppText(tx.buyer_phone, `⚖️ *Résolution de Litige*\n\nAprès vérification, Clairtus a tranché en votre faveur.\n✅ Un remboursement intégral de ${tx.base_amount} $ a été envoyé sur votre compte.`);
      await sendWhatsAppText(tx.seller_phone, `⚖️ *Résolution de Litige*\n\nAprès vérification, l'annulation a été confirmée et l'acheteur a été remboursé. Ce dossier est maintenant clos.`);
    }

    // Clean up both sessions to ensure they aren't stuck
    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.buyer_phone);
    await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);

    return new Response(JSON.stringify({ success: true, message: `Dispute resolved: ${resolution}` }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error("🚨 Admin Console Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});