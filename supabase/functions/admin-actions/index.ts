// supabase/functions/admin-actions/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { initiatePawaPayPayout } from "../_shared/pawapayClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";

// 🛡️ STANDARD CORS HEADERS FOR BROWSER ACCESS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
    // 🛡️ HANDLE BROWSER PREFLIGHT (OPTIONS) REQUEST
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // 🛡️ SECURITY CHECK: Only Admins can hit this
    const authHeader = req.headers.get('Authorization');
    const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
    
    if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    try {
        const { action, transaction_id, admin_note } = await req.json();
        const supabase = getSupabaseClient();

        console.log(`🕹️ [ADMIN ACTION] Request: ${action} for TX: ${transaction_id}`);

        // 1. Fetch the transaction
        const { data: tx, error: fetchError } = await supabase
            .from("transactions")
            .select("*")
            .eq("id", transaction_id)
            .single();

        if (fetchError || !tx) return new Response("Transaction Not Found", { status: 404, headers: corsHeaders });

        // 🟢 ACTION: FORCE_RELEASE (Admin overrides Buyer)
        if (action === "FORCE_RELEASE") {
            if (tx.status !== "FUNDED" && tx.status !== "DISPUTED") {
                return new Response("Invalid transaction status", { status: 400, headers: corsHeaders });
            }

            const payoutAmount = Number((tx.base_amount * 0.975).toFixed(2));
            const payoutId = crypto.randomUUID();
            
            await initiatePawaPayPayout(payoutId, tx.seller_phone, payoutAmount, tx.currency);

            const { error: updateError } = await supabase.from("transactions").update({ 
                status: "COMPLETED", 
                pawapay_payout_id: payoutId,
                admin_note: `Force released by admin: ${admin_note}` 
            }).eq("id", tx.id);

            if (updateError) throw updateError;

            await sendWhatsAppText(tx.seller_phone, `✅ *Fonds Libérés par l'Administration*\n\nSuite à l'examen de votre dossier, Clairtus a validé la transaction ${tx.reference}. Votre paiement est en route.`);
            await sendWhatsAppText(tx.buyer_phone, `⚖️ *Décision Arbitrage*\n\nLa transaction ${tx.reference} a été clôturée par un administrateur après vérification de la livraison.`);

            return new Response(JSON.stringify({ success: true, message: "Fonds libérés avec succès" }), { 
                status: 200, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });
        }

        // 🔴 ACTION: FORCE_REFUND (Admin returns money to Buyer)
        if (action === "FORCE_REFUND") {
            if (tx.status !== "FUNDED" && tx.status !== "DISPUTED") {
                return new Response("Invalid transaction status", { status: 400, headers: corsHeaders });
            }

            const refundId = crypto.randomUUID();
            await initiatePawaPayPayout(refundId, tx.buyer_phone, tx.base_amount, tx.currency);

            const { error: updateError } = await supabase.from("transactions").update({ 
                status: "REFUNDED", 
                pawapay_refund_id: refundId,
                admin_note: `Refunded by admin: ${admin_note}` 
            }).eq("id", tx.id);

            if (updateError) throw updateError;

            await sendWhatsAppText(tx.buyer_phone, `✅ *Remboursement Validé*\n\nL'administration Clairtus a validé votre remboursement pour la transaction ${tx.reference}.`);
            await sendWhatsAppText(tx.seller_phone, `🚫 *Transaction Annulée*\n\nL'administration a annulé la transaction ${tx.reference} et remboursé l'acheteur.`);

            return new Response(JSON.stringify({ success: true, message: "Acheteur remboursé avec succès" }), { 
                status: 200, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });
        }

        return new Response("Invalid Action", { status: 400, headers: corsHeaders });

    } catch (error) {
        console.error("🚨 [ADMIN ERROR]:", error);
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }
});