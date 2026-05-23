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

        // 🟢 ACTION: FORCE_RELEASE 
        if (action === "FORCE_RELEASE") {
            if (tx.status !== "FUNDED" && tx.status !== "DISPUTED") {
                return new Response("Invalid transaction status", { status: 400, headers: corsHeaders });
            }

            const feePercentage = tx.applied_fee_percentage ?? 2.5; 
            const feeMultiplier = feePercentage / 100;
            
            let primaryGross = tx.base_amount;
            let secondaryGross = 0;

            if (tx.secondary_vendor_phone && tx.secondary_vendor_amount) {
                secondaryGross = Number(tx.secondary_vendor_amount);
                primaryGross = tx.base_amount - secondaryGross;
            }

            const secondaryFee = Math.round(secondaryGross * feeMultiplier);
            const totalFee = Math.round(tx.base_amount * feeMultiplier);
            const primaryFee = totalFee - secondaryFee; 

            const primaryNet = primaryGross - primaryFee;
            const secondaryNet = secondaryGross - secondaryFee;

            // 🚀 THE FIX: True UUID generation for PawaPay
            const primaryPayoutId = crypto.randomUUID();
            const secondaryPayoutId = crypto.randomUUID();

            const updatePayload: any = {
                status: "PROCESSING_PAYOUTS",
                admin_note: `Force release initiated by admin: ${admin_note}`,
                primary_payout_status: "PROCESSING",
                primary_payout_id: primaryPayoutId
            };

            if (tx.secondary_vendor_phone) {
                updatePayload.secondary_payout_status = "PROCESSING";
                updatePayload.secondary_payout_id = secondaryPayoutId;
            }

            const { error: updateError } = await supabase
                .from("transactions")
                .update(updatePayload)
                .eq("id", tx.id);

            if (updateError) throw updateError;

            const payoutPromises = [];
            payoutPromises.push(initiatePawaPayPayout(primaryPayoutId, tx.seller_phone, primaryNet, tx.currency));

            if (tx.secondary_vendor_phone && secondaryNet > 0) {
                payoutPromises.push(initiatePawaPayPayout(secondaryPayoutId, tx.secondary_vendor_phone, secondaryNet, tx.currency));
            }

            await Promise.allSettled(payoutPromises);

            await sendWhatsAppText(tx.seller_phone, `✅ *Fonds en cours de libération*\n\nSuite à l'examen de votre dossier, Clairtus a validé la transaction ${tx.reference}. Votre paiement est en cours de traitement vers votre compte.`);
            
            if (tx.secondary_vendor_phone) {
                await sendWhatsAppText(tx.secondary_vendor_phone, `✅ *Fonds en cours de libération*\n\nClairtus a validé une transaction incluant votre part. Votre paiement est en cours de traitement.`);
            }

            await sendWhatsAppText(tx.buyer_phone, `⚖️ *Décision Arbitrage*\n\nLa transaction ${tx.reference} a été clôturée par un administrateur. Les paiements ont été initiés.`);

            return new Response(JSON.stringify({ success: true, message: "Payouts initiated successfully" }), { 
                status: 200, 
                headers: { ...corsHeaders, "Content-Type": "application/json" } 
            });
        }

        // 🔴 ACTION: FORCE_REFUND (Admin returns money to Buyer - UNTOUCHED)
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
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }
});