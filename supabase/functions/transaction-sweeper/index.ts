// supabase/functions/transaction-sweeper/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";

Deno.serve(async (req: Request) => {
  console.log("🧹 [CLAIRTUS SWEEPER] Initializing cleanup protocol...");

  try {
    const authHeader = req.headers.get('Authorization');
    const EXPECTED_SECRET = Deno.env.get("ADMIN_SECRET");
    
    // Allow invocation via Admin Secret or Supabase internal service role
    if (authHeader !== `Bearer ${EXPECTED_SECRET}` && authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = getSupabaseClient();
    
    // Calculate the timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find all abandoned transactions
    const { data: abandonedTxs, error } = await supabase
      .from("transactions")
      .select("*")
      .in("status", ["DRAFT", "INITIATED", "PENDING_FUNDING"])
      .lt("created_at", twentyFourHoursAgo);

    if (error) throw error;

    if (!abandonedTxs || abandonedTxs.length === 0) {
      console.log("✨ [CLAIRTUS SWEEPER] Database is clean. No abandoned transactions found.");
      return new Response(JSON.stringify({ success: true, message: "No cleanup needed." }), { status: 200 });
    }

    console.log(`⚠️ [CLAIRTUS SWEEPER] Found ${abandonedTxs.length} abandoned transactions. Cleaning up...`);

    for (const tx of abandonedTxs) {
      // 🛡️ INNER TRY/CATCH: Ensures one failed row doesn't break the entire sweep
      try {
        // 1. Mark transaction as cancelled
        await supabase.from("transactions").update({ status: "CANCELLED" }).eq("id", tx.id);

        const alertMessage = `🚫 *Expiration du délai*\n\nLa transaction ${tx.reference} a expiré (plus de 24h sans action). Le dossier a été automatiquement fermé.\n\nTapez BONJOUR pour revenir au menu.`;

        // 2. Free the Seller's session and notify them
        if (tx.seller_phone) {
          await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.seller_phone);
          await sendWhatsAppText(tx.seller_phone, alertMessage);
        }

        // 3. Free the Buyer's session and notify them
        if (tx.buyer_phone && tx.buyer_phone !== tx.seller_phone) {
          await supabase.from("sessions").update({ current_state: "MAIN_MENU", draft_transaction_id: null }).eq("phone_number", tx.buyer_phone);
          await sendWhatsAppText(tx.buyer_phone, alertMessage);
        }

        console.log(`✅ [CLAIRTUS SWEEPER] Successfully cancelled and cleared TX: ${tx.reference}`);
      } catch (innerError) {
        console.error(`❌ [CLAIRTUS SWEEPER] Failed to process TX ${tx.reference}:`, innerError);
      }
    }

    console.log("✅ [CLAIRTUS SWEEPER] Cleanup complete.");
    return new Response(JSON.stringify({ success: true, cleaned: abandonedTxs.length }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (error) {
    console.error("🚨 [CLAIRTUS SWEEPER] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});