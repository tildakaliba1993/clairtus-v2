// supabase/functions/pawapay-webhook/index.ts
import { getSupabaseClient } from "../_shared/supabaseClient.ts";
import { sendWhatsAppText } from "../_shared/whatsappClient.ts";
import { MESSAGES } from "../_shared/whatsappMessaging.ts";
import { notifyAdmin } from "../_shared/adminAlerts.ts";

function getNetworkName(phone: string) {
    const clean = phone.replace(/\+/g, '').replace(/\s/g, '');
    if (clean.startsWith("24399") || clean.startsWith("24397")) return "Airtel";
    if (clean.startsWith("24384") || clean.startsWith("24385") || clean.startsWith("24389")) return "Orange";
    return "M-Pesa";
}

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
        const body = await req.json();
        console.log(`💰 [PAWAPAY WEBHOOK RECEIVED]:`, JSON.stringify(body));

        const supabase = getSupabaseClient();
        const status = body.status;

        // 🟢 SCENARIO 1: IT IS A DEPOSIT WEBHOOK (Buyer funding escrow - UNTOUCHED)
        if (body.depositId) {
            const depositId = body.depositId;
            const { data: tx, error: txError } = await supabase.from("transactions").select("*").eq("pawapay_deposit_id", depositId).single();
            if (txError || !tx) return new Response("Transaction Not Found", { status: 404 });

            if (tx.status === "FUNDED" || tx.status === "COMPLETED" || tx.status === "DISPUTED" || tx.status === "REFUNDED") {
                console.log(`🛡️ [IDEMPOTENCY] Deposit ${depositId} already processed (Status is ${tx.status}). Ignoring duplicate webhook.`);
                return new Response("Already Processed", { status: 200 });
            }

            if (tx.status === "CANCELLED" && status === "COMPLETED") {
                console.warn(`🧟 [ZOMBIE PAYMENT] Payment arrived for CANCELLED transaction ${tx.reference}. Moving to DISPUTED.`);
                const { error: zombieError } = await supabase.from("transactions").update({ status: "DISPUTED" }).eq("id", tx.id);
                if (zombieError) return new Response("Internal Error", { status: 500 });
                return new Response("Zombie Payment Flagged", { status: 200 });
            }

            if (status === "COMPLETED") {
                console.log(`✅ Deposit COMPLETED for TX: ${tx.reference}. Committing to Database...`);
                const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
                
                const { data: updatedTx, error: updateError } = await supabase
                    .from("transactions")
                    .update({ status: "FUNDED", pin_code: generatedPin })
                    .eq("id", tx.id)
                    .select()
                    .single();

                if (updateError || !updatedTx) return new Response("Internal Database Error", { status: 500 });

                await supabase.from("sessions").update({ current_state: "AWAITING_DELIVERY_BUYER" }).eq("phone_number", tx.buyer_phone);
                await sendWhatsAppText(tx.buyer_phone, MESSAGES.PAYMENT_SUCCESS_BUYER(tx.base_amount, tx.currency, generatedPin));
                await supabase.from("sessions").update({ current_state: "AWAITING_DELIVERY_SELLER" }).eq("phone_number", tx.seller_phone);
                await sendWhatsAppText(tx.seller_phone, MESSAGES.PAYMENT_SUCCESS_SELLER(tx.base_amount, tx.currency));
                
                await notifyAdmin("SUCCESS_DEPOSIT", `Un dépôt de ${tx.base_amount} ${tx.currency} a été sécurisé !`, tx.buyer_phone, tx.id);
                
            } else if (status === "FAILED" || status === "REJECTED") {
                console.log(`❌ Deposit FAILED for TX: ${tx.reference}`);
                await supabase.from("network_events").insert({ network: getNetworkName(tx.buyer_phone), event_type: "DEPOSIT_FAILED" });
                await supabase.from("sessions").update({ current_state: "AWAITING_PAYMENT_BUYER" }).eq("phone_number", tx.buyer_phone);
                await sendWhatsAppText(tx.buyer_phone, MESSAGES.PAYMENT_FAILED_BUYER);
            }
            return new Response("Deposit Webhook Processed", { status: 200 });
        }

        // 🟢 SCENARIO 2: IT IS A PAYOUT WEBHOOK (Vendor receiving funds - UPDATED FOR SPLIT PAYOUTS)
        else if (body.payoutId) {
            const payoutId = body.payoutId;
            
            // Search for transaction via ANY of the possible payout ID columns
            const { data: tx, error: txError } = await supabase
                .from("transactions")
                .select("*")
                .or(`primary_payout_id.eq.${payoutId},secondary_payout_id.eq.${payoutId},pawapay_payout_id.eq.${payoutId},pawapay_refund_id.eq.${payoutId}`)
                .single();

            if (txError || !tx) return new Response("Transaction Not Found", { status: 404 });

            // Detect exactly which leg of the payment this webhook corresponds to
            const isRefund = tx.pawapay_refund_id === payoutId;
            const isPrimary = tx.primary_payout_id === payoutId || tx.pawapay_payout_id === payoutId;
            const isSecondary = tx.secondary_payout_id === payoutId;

            // Handle Refunds
            if (isRefund) {
                if (tx.status === "REFUNDED") return new Response("Already Processed", { status: 200 });
                if (status === "COMPLETED") {
                    await supabase.from("transactions").update({ status: "REFUNDED" }).eq("id", tx.id);
                }
                return new Response("Refund Webhook Processed", { status: 200 });
            }

            // Fetch the current saved statuses from the database, fallback to PENDING
            let currentPrimaryStatus = tx.primary_payout_status || 'PENDING';
            let currentSecondaryStatus = tx.secondary_payout_status || 'PENDING';

            // Update the specific leg that just arrived
            if (isPrimary) {
                if (currentPrimaryStatus === "COMPLETED") return new Response("Already Processed", { status: 200 });
                currentPrimaryStatus = (status === "COMPLETED") ? "COMPLETED" : "FAILED";
                await supabase.from("transactions").update({ primary_payout_status: currentPrimaryStatus }).eq("id", tx.id);
            } else if (isSecondary) {
                if (currentSecondaryStatus === "COMPLETED") return new Response("Already Processed", { status: 200 });
                currentSecondaryStatus = (status === "COMPLETED") ? "COMPLETED" : "FAILED";
                await supabase.from("transactions").update({ secondary_payout_status: currentSecondaryStatus }).eq("id", tx.id);
            }

            // EVALUATE OVERALL TRANSACTION SETTLEMENT
            let isFullySettled = false;
            let isPartiallySettled = false;
            let isFullyFailed = false;

            if (tx.secondary_vendor_phone) {
                if (currentPrimaryStatus === "COMPLETED" && currentSecondaryStatus === "COMPLETED") {
                    isFullySettled = true;
                } else if (currentPrimaryStatus === "FAILED" && currentSecondaryStatus === "FAILED") {
                    isFullyFailed = true;
                } else if ((currentPrimaryStatus === "COMPLETED" && currentSecondaryStatus === "FAILED") || 
                           (currentPrimaryStatus === "FAILED" && currentSecondaryStatus === "COMPLETED")) {
                    isPartiallySettled = true;
                }
            } else {
                // Standard Single Vendor transaction
                if (currentPrimaryStatus === "COMPLETED") isFullySettled = true;
                if (currentPrimaryStatus === "FAILED") isFullyFailed = true;
            }

            // OVERALL SETTLEMENT ROUTING
            if (isFullySettled) {
                console.log(`✅ ALL PAYOUTS COMPLETED for TX: ${tx.reference}`);
                await supabase.from("transactions").update({ status: "COMPLETED" }).eq("id", tx.id);

                // Re-calculate the Net Fees for the Transparency Receipt
                const feePercentage = tx.applied_fee_percentage ?? 2.5; 
                const feeMultiplier = feePercentage / 100;
                let secondaryGross = tx.secondary_vendor_amount ? Number(tx.secondary_vendor_amount) : 0;
                let primaryGross = tx.base_amount - secondaryGross;

                const secondaryFee = Math.round(secondaryGross * feeMultiplier);
                const totalFee = Math.round(tx.base_amount * feeMultiplier);
                const primaryFee = totalFee - secondaryFee; 

                const primaryNet = primaryGross - primaryFee;
                const secondaryNet = secondaryGross - secondaryFee;

                // 🧾 Send The Transparency Receipt to Buyer
                let receiptText = `🎉 *Paiement confirmé et fonds libérés !*\n\nMerci d'avoir utilisé Clairtus. Votre transaction de ${tx.base_amount}${tx.currency} est terminée.\n\n🧾 *Bordereau de Transparence :*\nPour votre sécurité absolue, voici les montants nets exacts qui ont été déposés sur les comptes des vendeurs (après déduction de nos frais de plateforme) :\n\n• *${primaryNet.toFixed(2)} ${tx.currency}* envoyés au Vendeur Principal\n`;
                
                if (tx.secondary_vendor_phone) {
                    receiptText += `• *${secondaryNet.toFixed(2)} ${tx.currency}* envoyés au Vendeur Secondaire (${tx.secondary_vendor_phone})\n\n`;
                } else {
                    receiptText += "\n";
                }
                receiptText += `*Frais totaux de transaction : ${totalFee.toFixed(2)} ${tx.currency}*\n*Clairtus certifie que ces transferts ont été exécutés. Vous ne devez plus rien à personne.*`;

                await sendWhatsAppText(tx.buyer_phone, receiptText);

                // Increment Trust Scores
                try {
                    await supabase.rpc('increment_trust_score', { phone_number_to_update: tx.seller_phone });
                    await supabase.rpc('increment_trust_score', { phone_number_to_update: tx.buyer_phone });
                } catch (scoreError) {
                    console.error("Failed to update trust scores:", scoreError);
                }

                await notifyAdmin("SUCCESS_PAYOUT", `La transaction de ${tx.base_amount} ${tx.currency} est 100% terminée. Le vendeur a reçu ses fonds.`, tx.seller_phone, tx.id);

            } else if (isPartiallySettled) {
                console.warn(`⚠️ [PARTIAL PAYOUT] TX ${tx.reference} is partially settled. Awaiting CRON retry.`);
                await supabase.from("transactions").update({ status: "PARTIAL_PAYOUT" }).eq("id", tx.id);
                // System logs it and waits for self-healing CRON to retry the failed leg
                
            } else if (isFullyFailed) {
                console.log(`❌ ALL PAYOUTS FAILED for TX: ${tx.reference}`);
                await supabase.from("network_events").insert({ network: getNetworkName(tx.seller_phone), event_type: "PAYOUT_FAILED" });
                
                await supabase.from("transactions").update({ 
                    status: "PAYOUT_FAILED", 
                    primary_payout_id: null, 
                    secondary_payout_id: null 
                }).eq("id", tx.id);
                
                await supabase.from("sessions").upsert({ phone_number: tx.seller_phone, current_state: "AWAITING_NEW_PAYOUT_NUMBER", draft_transaction_id: tx.id }, { onConflict: 'phone_number' });
                await sendWhatsAppText(tx.seller_phone, `⚠️ *Échec du Transfert*\n\nL'opérateur a rejeté l'envoi de vos fonds. Raison possible: limite de solde atteinte ou compte inactif.\n\nVeuillez envoyer un **nouveau numéro Mobile Money** (ex: 243...) pour recevoir votre argent.`);
                
                await notifyAdmin("PAYOUT_FAILED", `Le réseau a rejeté l'envoi des fonds au vendeur.`, tx.seller_phone, tx.id);
            }

            return new Response("Payout Webhook Processed", { status: 200 });
        }

        return new Response("Invalid Payload Type", { status: 400 });
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
});