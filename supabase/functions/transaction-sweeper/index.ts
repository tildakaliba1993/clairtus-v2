// supabase/functions/transaction-sweeper/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { sendWhatsAppText, sendWhatsAppButtons } from "../_shared/whatsappClient.ts";
import { checkPawaPayDepositStatus } from "../_shared/pawapayClient.ts";
import { getNetworkInfo } from "../_shared/stateMachine.ts"; // Import our new helper!

Deno.serve(async (req: Request) => {
  console.log("🧹 [CLAIRTUS SWEEPER] Initializing cleanup protocol...");

  try {
    const authHeader = req.headers.get('Authorization');
    const EXPECTED_SECRET = Deno.env.get("ADMIN_SECRET");
    
    if (authHeader !== `Bearer ${EXPECTED_SECRET}` && authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = getSupabaseClient();
    const now = Date.now();
    
    // --- PHASE 1: THE GHOST HUNT (2+ Minutes) ---
    const twoMinutesAgo = new Date(now - 2 * 60 * 1000).toISOString();
    
    const { data: ghostTxs, error: ghostError } = await supabase
      .from("transactions")
      .select("*")
      .eq("status", "PENDING_FUNDING")
      .not("pawapay_deposit_id", "is", null)
      .lt("updated_at", twoMinutesAgo);

    if (ghostError) throw ghostError;

    if (ghostTxs && ghostTxs.length > 0) {
      console.log(`👻 [CLAIRTUS SWEEPER] Found ${ghostTxs.length} Ghost Transactions. Pinging PawaPay...`);
      
      for (const tx of ghostTxs) {
        try {
          const pawapayData = await checkPawaPayDepositStatus(tx.pawapay_deposit_id);
          
          if (pawapayData.status === "FAILED") {
            console.log(`❌ [CLAIRTUS SWEEPER] PawaPay confirmed failure for TX: ${tx.reference}`);
            
            // 🔧 CIRCUIT BREAKER COUNTER LOGIC
            const attempts = (tx.payment_attempts || 0) + 1;
            
            if (attempts >= 3) {
                // Trigger Circuit Breaker Menu
                const { current, alternative } = getNetworkInfo(tx.buyer_phone);
                const circuitBreakerMsg = `⚠️ *Oups ! Il semble que le réseau ${current} rencontre des perturbations techniques nationales en ce moment.*\n\nPour ne pas perdre votre transaction, que souhaitez-vous faire ?`;
                
                await supabase.from("transactions").update({ status: "AWAITING_PAYMENT", payment_attempts: attempts }).eq("id", tx.id);
                await supabase.from("sessions").update({ current_state: "CIRCUIT_BREAKER_MENU" }).eq("phone_number", tx.buyer_phone);
                
                await sendWhatsAppButtons(tx.buyer_phone, circuitBreakerMsg, [
                    { id: "CMD_SWITCH_MNO", title: `1️⃣ Avec ${alternative}` },
                    { id: "CMD_PAUSE", title: "2️⃣ Attendre" },
                    { id: "CMD_CANCEL", title: "3️⃣ Annuler" }
                ]);
            } else {
                // Normal Retry
                await supabase.from("transactions").update({ status: "AWAITING_PAYMENT", payment_attempts: attempts }).eq("id", tx.id);
                await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", tx.buyer_phone);
                
                const retryMessage = `⏳ *Délai d'attente dépassé*\n\nVotre opérateur mobile n'a pas validé la transaction à temps. Vos fonds n'ont pas été déduits.\n\nTapez *RÉESSAYER* pour relancer le paiement.`;
                await sendWhatsAppText(tx.buyer_phone, retryMessage);
            }
          }
        } catch (innerError) {
          console.error(`❌ [CLAIRTUS SWEEPER] Failed to check Ghost TX ${tx.reference}:`, innerError);
        }
      }
    }

    // --- PHASE 2: DEEP CLEAN (24+ Hours) ---
    // (Keep your existing Phase 2 logic here exactly as it was)
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: abandonedTxs, error: abandonError } = await supabase
      .from("transactions")
      .select("*")
      .in("status", ["DRAFT", "INITIATED", "PENDING_FUNDING"])
      .lt("created_at", twentyFourHoursAgo);

    if (abandonError) throw abandonError;

    if (abandonedTxs && abandonedTxs.length > 0) {
      for (const tx of abandonedTxs) {
        try {
          await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", tx.id);
          const alertMessage = `🚫 *Expiration du délai*\n\nLa transaction ${tx.reference} a expiré (plus de 24h sans action). Le dossier a été automatiquement fermé.\n\nTapez BONJOUR pour revenir au menu.`;

          if (tx.seller_phone) {
            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);
            await sendWhatsAppText(tx.seller_phone, alertMessage);
          }
          if (tx.buyer_phone && tx.buyer_phone !== tx.seller_phone) {
            await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.buyer_phone);
            await sendWhatsAppText(tx.buyer_phone, alertMessage);
          }
        } catch (innerError) {}
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
  }
});